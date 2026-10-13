import "server-only";

import { and, asc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  tournaments,
  players,
  registrations,
  results,
  tournamentLiveEntries,
  tournamentPlayerEliminations,
  tournamentAttendance,
  tournamentRebuyState,
  activityEvents,
  playerMergeIntents,
  dealerProfiles,
  dealerShifts,
  teams,
  teamMemberships,
  teamInvitations,
  teamJoinRequests,
  follows,
} from "@/lib/db/schema";
import { syncPlayerAchievements } from "@/features/achievements";
import { intervalsOverlap } from "@/lib/team-scoring";
import { ROLE_LABELS, isKnownRole } from "@/lib/roles";
import { playerMergeIntentRepository } from "@/lib/repositories";
import type { PlayerMergeIntentRow } from "@/lib/repositories";

// Account merging -- ported from Sterling/spb-poker (commit 770ce78d,
// feat(account-merge): self-service Telegram<->email account merging, plus
// its follow-up fixes cc0864f/9c11688/e320af2/6da8d84). Same semantics,
// adapted to Re-Raise's schema: Re-Raise has no player_referrals,
// player_deposit_transactions, or orders tables (so none of Sterling's
// referral-attribution/deposit/order reconciliation applies here), and adds
// two tournament-state tables Sterling doesn't have (tournament_attendance,
// tournament_rebuy_state) to the overlap check and the history move below.
//
// Thrown by assertPostgresMode() below -- a distinct, typed error (not a
// bare Error) so callers can distinguish "merge subsystem unsupported under
// this provider" from every other failure mode and respond accordingly:
// app/api/auth/email/verify-code/route.ts catches this specifically and
// falls back to the SAME "canMerge: false, contact admin" response shape
// already used for a genuine eligibility conflict -- so the client-side UI
// (app/page.tsx) never shows an "Объединить аккаунты" button that is
// guaranteed to fail, without either side needing to know DATABASE_PROVIDER
// itself. app/api/auth/email/merge/route.ts catches it too, returning a
// distinct 503 rather than the generic "failed to merge" 500.
export class AccountMergeUnavailableError extends Error {
  constructor() {
    super("Account merging requires DATABASE_PROVIDER=postgres");
    this.name = "AccountMergeUnavailableError";
  }
}

// Account merging is a Postgres-only feature -- every entry point here
// checks this explicitly, before any read or write, rather than letting a
// Supabase-mode call silently no-op, partially mutate, or hit the wrong
// tables (there is no SupabasePlayerMergeIntentRepository at all -- see
// lib/repositories/player-merge-intent/index.ts). Production Re-Raise runs
// DATABASE_PROVIDER=postgres exclusively (enforced by
// .github/workflows/production-migrations.yml's own preflight check), so
// this is defense-in-depth against a misconfigured or legacy-provider
// deployment, not an expected runtime path.
function assertPostgresMode() {
  if (process.env.DATABASE_PROVIDER !== "postgres") {
    throw new AccountMergeUnavailableError();
  }
}

const INTENT_TTL_MS = 15 * 60 * 1000;

export type TournamentOverlapResult = {
  sourceTournamentIds: Set<string>;
  targetTournamentIds: Set<string>;
  overlappingTournamentIds: string[];
};

// The six tables that record "this player participated in this tournament"
// -- audited directly against the current schema for this feature.
// tournament_mystery_bounty is tournament-scoped only (no player_id column
// at all), so it is deliberately not queried here, same reasoning Sterling
// applied.
async function collectTournamentIds(
  executor: typeof db,
  playerId: string
): Promise<Set<string>> {
  const [regRows, resultRows, liveRows, elimRows, attendanceRows, rebuyRows] = await Promise.all([
    executor
      .select({ tournamentId: registrations.tournamentId })
      .from(registrations)
      .where(eq(registrations.playerId, playerId)),
    executor
      .select({ tournamentId: results.tournamentId })
      .from(results)
      .where(eq(results.playerId, playerId)),
    executor
      .select({ tournamentId: tournamentLiveEntries.tournamentId })
      .from(tournamentLiveEntries)
      .where(eq(tournamentLiveEntries.playerId, playerId)),
    executor
      .select({ tournamentId: tournamentPlayerEliminations.tournamentId })
      .from(tournamentPlayerEliminations)
      .where(eq(tournamentPlayerEliminations.playerId, playerId)),
    executor
      .select({ tournamentId: tournamentAttendance.tournamentId })
      .from(tournamentAttendance)
      .where(eq(tournamentAttendance.playerId, playerId)),
    executor
      .select({ tournamentId: tournamentRebuyState.tournamentId })
      .from(tournamentRebuyState)
      .where(eq(tournamentRebuyState.playerId, playerId)),
  ]);

  const ids = new Set<string>();
  for (const row of [...regRows, ...resultRows, ...liveRows, ...elimRows, ...attendanceRows, ...rebuyRows]) {
    ids.add(row.tournamentId);
  }
  return ids;
}

export async function computeTournamentOverlap(
  targetPlayerId: string,
  sourcePlayerId: string,
  executor: typeof db = db
): Promise<TournamentOverlapResult> {
  const [targetTournamentIds, sourceTournamentIds] = await Promise.all([
    collectTournamentIds(executor, targetPlayerId),
    collectTournamentIds(executor, sourcePlayerId),
  ]);

  const overlappingTournamentIds = [...sourceTournamentIds].filter((id) =>
    targetTournamentIds.has(id)
  );

  return { sourceTournamentIds, targetTournamentIds, overlappingTournamentIds };
}

type PlayerRow = typeof players.$inferSelect;

// ---------------------------------------------------------------------------
// Shared merge primitives -- used by BOTH the self-service intent wrapper
// (executeMerge) and the Super-Admin wrapper (previewAdminMerge /
// executeAdminMerge) below. There is exactly one implementation of each
// blocker, each history move, and each counter/flag reconciliation rule.
// ---------------------------------------------------------------------------

export const SOURCE_BLOCKED_REASON =
  "Присоединяемый аккаунт заблокирован, а основной — нет. Объединение сняло бы блокировку — сначала разберитесь с блокировкой.";

export const DEALER_OPEN_SHIFT_CONFLICT_REASON =
  "Оба аккаунта имеют открытую смену дилера — объединение невозможно, сначала завершите одну из смен";

export const TEAM_HISTORY_CONFLICT_REASON =
  "team_membership_history_conflict: пересекающаяся история командного участия — объединение невозможно, требуется ручное разрешение конфликта";

// is_blocked is target-wins like every other moderation/admin field: a
// blocked source absorbed into an unblocked target would silently lift the
// block. A blocked TARGET is fine (it simply stays blocked).
function sourceBlockedIntoUnblockedTarget(
  target: Pick<PlayerRow, "isBlocked">,
  source: Pick<PlayerRow, "isBlocked">
): boolean {
  return Boolean(source.isBlocked) && !target.isBlocked;
}

// No-show waitlist policy (features/tournament-no-show.ts). The restriction
// must survive a merge in whichever direction it is run -- otherwise merging
// accounts would be a way to escape it. neither -> null, exactly one -> that
// one, both -> the more recent timestamp.
export function mergeOnlineRegistrationRestriction(
  targetRestrictedAt: Date | null | undefined,
  sourceRestrictedAt: Date | null | undefined
): Date | null {
  const target = targetRestrictedAt ?? null;
  const source = sourceRestrictedAt ?? null;
  if (!target) return source;
  if (!source) return target;
  return source.getTime() > target.getTime() ? source : target;
}

// referral_count/free_reentries_balance summed, yandex_review_bonus_claimed
// OR'd (pre-existing rules), plus the no-show restriction rule above. The
// restriction key is only included when it actually changes target's value,
// so a merge where neither side is restricted writes exactly what it always
// wrote.
function reconcileMergedCounters(targetRow: PlayerRow, sourceRow: PlayerRow): Partial<typeof players.$inferInsert> {
  const patch: Partial<typeof players.$inferInsert> = {
    referralCount: targetRow.referralCount + sourceRow.referralCount,
    freeReentriesBalance: targetRow.freeReentriesBalance + sourceRow.freeReentriesBalance,
    yandexReviewBonusClaimed: targetRow.yandexReviewBonusClaimed || sourceRow.yandexReviewBonusClaimed,
  };

  const restrictedAt = mergeOnlineRegistrationRestriction(
    targetRow.onlineRegistrationRestrictedAt,
    sourceRow.onlineRegistrationRestrictedAt
  );
  const currentTarget = targetRow.onlineRegistrationRestrictedAt ?? null;
  if ((restrictedAt?.getTime() ?? null) !== (currentTarget?.getTime() ?? null)) {
    patch.onlineRegistrationRestrictedAt = restrictedAt;
  }

  return patch;
}

// The one place both player rows are locked. Fixed id-sorted order (never
// caller order) so two merges touching the same pair in opposite
// directions -- self-service or admin -- can never deadlock each other.
async function lockPlayerPair(
  tx: typeof db,
  targetId: string,
  sourceId: string
): Promise<{ targetRow: PlayerRow | undefined; sourceRow: PlayerRow | undefined }> {
  const [firstId, secondId] = [targetId, sourceId].sort();

  const [firstRow] = await tx.select().from(players).where(eq(players.id, firstId)).for("update");
  const [secondRow] = await tx.select().from(players).where(eq(players.id, secondId)).for("update");
  const targetRow = firstId === targetId ? firstRow : secondRow;
  const sourceRow = firstId === sourceId ? firstRow : secondRow;

  return { targetRow, sourceRow };
}

type DealerProfileRow = typeof dealerProfiles.$inferSelect;

// Dealer/Staff conflict check. If both accounts currently have an open
// dealer shift, merging them would either collapse two open shifts onto one
// dealer_player_id (violating dealer_shifts_one_open_per_dealer) or silently
// discard one of them -- neither is acceptable, so callers fail closed with
// DEALER_OPEN_SHIFT_CONFLICT_REASON. Ported from Sterling's own port of
// Re-Raise's Dealer Payroll feature -- same table/column shapes on both
// sides. Also returns both dealer profiles, which moveMergeHistory needs.
async function loadDealerMergeState(
  tx: typeof db,
  targetId: string,
  sourceId: string
): Promise<{ bothHaveOpenDealerShift: boolean; dealerProfileRows: DealerProfileRow[] }> {
  const [openDealerShiftRows, dealerProfileRows] = await Promise.all([
    tx
      .select({ dealerPlayerId: dealerShifts.dealerPlayerId })
      .from(dealerShifts)
      .where(and(inArray(dealerShifts.dealerPlayerId, [targetId, sourceId]), isNull(dealerShifts.endedAt))),
    tx.select().from(dealerProfiles).where(inArray(dealerProfiles.playerId, [targetId, sourceId])),
  ]);

  const targetHasOpenDealerShift = openDealerShiftRows.some((row) => row.dealerPlayerId === targetId);
  const sourceHasOpenDealerShift = openDealerShiftRows.some((row) => row.dealerPlayerId === sourceId);

  return {
    bothHaveOpenDealerShift: targetHasOpenDealerShift && sourceHasOpenDealerShift,
    dealerProfileRows,
  };
}

// Teams v1 conflict check. Reassigning source's team_memberships rows onto
// target's id is only safe if the two players' FULL histories (not just
// their current active row) never overlap in time -- an active-only check is
// necessary but NOT sufficient: two already-closed intervals from different
// (or even the same) teams can still overlap, and if they did, the
// canonical player would appear to have belonged to two teams at once,
// which lib/team-scoring.ts's temporal attribution correctly treats as
// corrupted/ambiguous data (AmbiguousTeamMembershipError) rather than
// silently picking one. So this loads EVERY membership row either player
// ever had (not filtered by left_at) and checks every source-interval/
// target-interval pair with the exact same half-open-interval overlap rule
// scoring uses (lib/team-scoring.ts::intervalsOverlap) -- including two
// intervals on the very same team, which is deliberately NOT auto-collapsed
// in v1 (membership history is the scoring/audit source of truth; a merge
// must never silently rewrite it). Callers fail closed with a categorical
// reason rather than choosing a team, truncating history, or moving points.
async function hasTeamMembershipHistoryOverlap(
  tx: typeof db,
  targetId: string,
  sourceId: string
): Promise<boolean> {
  const allTeamMembershipRows = await tx
    .select({
      id: teamMemberships.id,
      teamId: teamMemberships.teamId,
      playerId: teamMemberships.playerId,
      joinedAt: teamMemberships.joinedAt,
      leftAt: teamMemberships.leftAt,
    })
    .from(teamMemberships)
    .where(inArray(teamMemberships.playerId, [targetId, sourceId]));

  const targetMembershipIntervals = allTeamMembershipRows.filter((row) => row.playerId === targetId);
  const sourceMembershipIntervals = allTeamMembershipRows.filter((row) => row.playerId === sourceId);

  return targetMembershipIntervals.some((targetInterval) =>
    sourceMembershipIntervals.some((sourceInterval) =>
      intervalsOverlap(
        { joined_at: targetInterval.joinedAt.toISOString(), left_at: targetInterval.leftAt?.toISOString() ?? null },
        { joined_at: sourceInterval.joinedAt.toISOString(), left_at: sourceInterval.leftAt?.toISOString() ?? null }
      )
    )
  );
}

// Player following (follows table) -- moves every edge attached to source
// onto target, inside the same merge transaction as the rest of the history
// (called from moveMergeHistory, so BOTH the self-service executeMerge and the
// Super-Admin executeAdminMerge get it).
//
// follows has two structural constraints a blind `UPDATE ... SET player_id`
// would trip over, both checked per statement (not deferrable):
//   - follows_follower_followed_key: one row per directed (follower, followed)
//     pair. A source edge whose target-equivalent already exists would collide.
//   - follows_no_self_follow: follower <> followed. A direct source<->target
//     edge would become target -> target.
// So collisions are resolved deliberately BEFORE any reassignment, never by
// catching a violation afterwards. Existing TARGET rows always win a
// collision: the target's own edge (with its own id/created_at) is kept and
// the source duplicate is deleted; no timestamps are merged. Rows that are
// merely reassigned keep their id and created_at untouched.
//
// Uses the transaction `tx` and the schema directly (not followRepository,
// which runs on the global connection and would escape this transaction).
async function moveFollows(tx: typeof db, targetId: string, sourceId: string): Promise<void> {
  // 1. Direct source <-> target edges: both directions would become
  //    target -> target. Dropped (merging two accounts of one person makes
  //    them following themselves meaningless).
  await tx
    .delete(follows)
    .where(
      or(
        and(eq(follows.followerPlayerId, sourceId), eq(follows.followedPlayerId, targetId)),
        and(eq(follows.followerPlayerId, targetId), eq(follows.followedPlayerId, sourceId))
      )
    );

  // 2. Outgoing collisions: source -> X where target -> X already exists.
  await tx
    .delete(follows)
    .where(
      and(
        eq(follows.followerPlayerId, sourceId),
        sql`${follows.followedPlayerId} IN (
          SELECT existing.followed_player_id FROM follows AS existing
          WHERE existing.follower_player_id = ${targetId}
        )`
      )
    );

  // 3. Incoming collisions: X -> source where X -> target already exists.
  await tx
    .delete(follows)
    .where(
      and(
        eq(follows.followedPlayerId, sourceId),
        sql`${follows.followerPlayerId} IN (
          SELECT existing.follower_player_id FROM follows AS existing
          WHERE existing.followed_player_id = ${targetId}
        )`
      )
    );

  // 4./5. Whatever is left cannot collide or self-reference: reassign.
  await tx.update(follows).set({ followerPlayerId: targetId }).where(eq(follows.followerPlayerId, sourceId));
  await tx.update(follows).set({ followedPlayerId: targetId }).where(eq(follows.followedPlayerId, sourceId));
}

// History: reassign every row from source to target. Safe only after the
// caller has confirmed zero tournament overlap, no double-open dealer shift
// and no team-history overlap, so none of these updates can collide with an
// existing target row on any (tournament_id, player_id) unique/composite-PK
// constraint.
//
// Every statement below is a whole-row `UPDATE ... SET player_id = target`:
// every other column of the moved row (registrations.status, no_show_at,
// waitlist_promotion_notification_claimed_at, results.rating_points, ...)
// travels with it untouched.
async function moveMergeHistory(
  tx: typeof db,
  targetId: string,
  sourceId: string,
  dealerProfileRows: DealerProfileRow[]
): Promise<void> {
  await tx.update(registrations).set({ playerId: targetId }).where(eq(registrations.playerId, sourceId));
  await tx.update(results).set({ playerId: targetId }).where(eq(results.playerId, sourceId));
  await tx
    .update(tournamentLiveEntries)
    .set({ playerId: targetId })
    .where(eq(tournamentLiveEntries.playerId, sourceId));
  await tx
    .update(tournamentPlayerEliminations)
    .set({ playerId: targetId })
    .where(eq(tournamentPlayerEliminations.playerId, sourceId));
  await tx
    .update(tournamentAttendance)
    .set({ playerId: targetId })
    .where(eq(tournamentAttendance.playerId, sourceId));
  await tx
    .update(tournamentRebuyState)
    .set({ playerId: targetId })
    .where(eq(tournamentRebuyState.playerId, sourceId));
  await tx.update(activityEvents).set({ playerId: targetId }).where(eq(activityEvents.playerId, sourceId));

  // Player following: edges in both directions follow the player. See moveFollows.
  await moveFollows(tx, targetId, sourceId);

  // Teams v1 -- move EVERY team_memberships row (active or historical)
  // from source to target, unconditionally. This is required for
  // scoring correctness, not just tidiness: lib/team-scoring.ts
  // attributes a result to a team by finding the membership interval
  // for `results.player_id` that contains the tournament's start_at --
  // and results.player_id was just reassigned to targetId above. If a
  // membership interval source earned points under were left on
  // sourceId, that history would silently stop being attributable to
  // any team after the merge (an under-count), not merely "belong to
  // the wrong id". The conflict check guarantees at most one of
  // target/source has an ACTIVE row, so this can never produce two
  // simultaneous active memberships for target.
  await tx.update(teamMemberships).set({ playerId: targetId }).where(eq(teamMemberships.playerId, sourceId));

  // Captaincy follows the same reassignment -- a captain must always be
  // a CURRENT active member (features/teams.ts), so if source captained
  // a team, that team's active membership row (just reassigned above)
  // now has playerId = targetId, and captain_player_id must match.
  await tx.update(teams).set({ captainPlayerId: targetId }).where(eq(teams.captainPlayerId, sourceId));

  // team_invitations.invited_by_player_id is audit metadata only (no
  // uniqueness constraint depends on it) -- unconditional, same
  // reasoning as dealer_shifts' created_by/ended_by columns.
  await tx
    .update(teamInvitations)
    .set({ invitedByPlayerId: targetId })
    .where(eq(teamInvitations.invitedByPlayerId, sourceId));

  // team_invitations.invited_player_id CAN collide: if both target and
  // source independently held a pending invitation from the SAME team,
  // reassigning source's onto targetId would violate
  // team_invitations_one_pending_per_team_player_idx. Resolve exactly
  // like duplicate pending invitations are resolved everywhere else in
  // this feature (features/teams.ts::acceptInvitation) -- keep one,
  // cancel the other -- rather than deleting anything. Target's own
  // pending invitation (if any) always wins; source's colliding one is
  // marked cancelled (its invited_player_id is deliberately left as
  // sourceId, since it no longer needs to move -- the historical row
  // simply records that this now-merged-away identity was once invited).
  const sourcePendingInvitations = await tx
    .select({ id: teamInvitations.id, teamId: teamInvitations.teamId })
    .from(teamInvitations)
    .where(and(eq(teamInvitations.invitedPlayerId, sourceId), eq(teamInvitations.status, "pending")));

  if (sourcePendingInvitations.length > 0) {
    const targetPendingTeamIds = new Set(
      (
        await tx
          .select({ teamId: teamInvitations.teamId })
          .from(teamInvitations)
          .where(and(eq(teamInvitations.invitedPlayerId, targetId), eq(teamInvitations.status, "pending")))
      ).map((row) => row.teamId)
    );

    const collidingIds = sourcePendingInvitations
      .filter((row) => targetPendingTeamIds.has(row.teamId))
      .map((row) => row.id);
    const movableIds = sourcePendingInvitations
      .filter((row) => !targetPendingTeamIds.has(row.teamId))
      .map((row) => row.id);

    if (collidingIds.length > 0) {
      await tx
        .update(teamInvitations)
        .set({ status: "cancelled", respondedAt: new Date() })
        .where(inArray(teamInvitations.id, collidingIds));
    }
    if (movableIds.length > 0) {
      await tx
        .update(teamInvitations)
        .set({ invitedPlayerId: targetId })
        .where(inArray(teamInvitations.id, movableIds));
    }
  }

  // team_join_requests -- the mirror direction of team_invitations
  // above (player -> captain instead of captain -> player), same
  // reassignment + same pending-collision handling. Never creates a
  // team membership here (join requests never do, merge or otherwise)
  // and never touches the membership-history overlap blocker --
  // that check only ever concerns team_memberships, not requests.
  const sourcePendingJoinRequests = await tx
    .select({ id: teamJoinRequests.id, teamId: teamJoinRequests.teamId })
    .from(teamJoinRequests)
    .where(and(eq(teamJoinRequests.playerId, sourceId), eq(teamJoinRequests.status, "pending")));

  if (sourcePendingJoinRequests.length > 0) {
    const targetPendingRequestTeamIds = new Set(
      (
        await tx
          .select({ teamId: teamJoinRequests.teamId })
          .from(teamJoinRequests)
          .where(and(eq(teamJoinRequests.playerId, targetId), eq(teamJoinRequests.status, "pending")))
      ).map((row) => row.teamId)
    );

    const collidingRequestIds = sourcePendingJoinRequests
      .filter((row) => targetPendingRequestTeamIds.has(row.teamId))
      .map((row) => row.id);
    const movableRequestIds = sourcePendingJoinRequests
      .filter((row) => !targetPendingRequestTeamIds.has(row.teamId))
      .map((row) => row.id);

    if (collidingRequestIds.length > 0) {
      await tx
        .update(teamJoinRequests)
        .set({ status: "cancelled", respondedAt: new Date() })
        .where(inArray(teamJoinRequests.id, collidingRequestIds));
    }
    if (movableRequestIds.length > 0) {
      await tx
        .update(teamJoinRequests)
        .set({ playerId: targetId })
        .where(inArray(teamJoinRequests.id, movableRequestIds));
    }
  }

  // Dealer/Staff ownership transfer -- shift history always moves with
  // the player. Unconditional (a no-op update if source never had any
  // shifts): created_by_player_id/ended_by_player_id describe a
  // specific past admin action and are deliberately left untouched
  // here, same reasoning Sterling applied to its own admin-id columns.
  await tx
    .update(dealerShifts)
    .set({ dealerPlayerId: targetId })
    .where(eq(dealerShifts.dealerPlayerId, sourceId));

  // Dealer profile merge -- the open-shift conflict check already
  // guarantees at most one side has an open shift, so this can never
  // orphan an in-progress shift's payroll expectations.
  const targetDealerProfile = dealerProfileRows.find((row) => row.playerId === targetId);
  const sourceDealerProfile = dealerProfileRows.find((row) => row.playerId === sourceId);

  if (sourceDealerProfile && !targetDealerProfile) {
    // Target has no dealer profile of its own -- source's profile
    // (rate, is_active) becomes the target's. Its shifts already moved
    // above, so this simply reassigns the PK it was recorded under.
    await tx
      .update(dealerProfiles)
      .set({ playerId: targetId })
      .where(eq(dealerProfiles.playerId, sourceId));
  } else if (sourceDealerProfile && targetDealerProfile) {
    // Both sides were independently dealers -- target's own profile
    // wins (rate, is_active untouched, never overwritten by source's).
    // Source's shifts already moved to target above, so its now-empty
    // profile row is removed rather than left as an orphaned duplicate.
    await tx.delete(dealerProfiles).where(eq(dealerProfiles.playerId, sourceId));
  }
  // targetDealerProfile only, or neither -- nothing further to do.
}

// The two player-row writes, in the only safe order. players.telegram_id
// (plain UNIQUE) and players_email_unique_idx (UNIQUE on lower(email)) are
// both non-deferrable and checked per-statement, not at commit -- so the
// source row must release any identity it is handing over BEFORE the target
// row claims it, or the second UPDATE fails with a unique-violation.
async function writeMergedPlayerRows(
  tx: typeof db,
  params: {
    targetId: string;
    sourceId: string;
    sourceIdentityRelease: Partial<typeof players.$inferInsert>;
    targetPatch: Partial<typeof players.$inferInsert>;
  }
): Promise<void> {
  await tx
    .update(players)
    .set({
      ...params.sourceIdentityRelease,
      mergedIntoPlayerId: params.targetId,
      mergedAt: new Date(),
    })
    .where(eq(players.id, params.sourceId));

  await tx.update(players).set(params.targetPatch).where(eq(players.id, params.targetId));
}

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: string; overlappingTournamentIds?: string[] };

// Read-only -- used both to decide the initial intent status at
// verify-code time and to re-check inside the merge transaction (see
// executeMerge). The two checks must stay identical; this is the one place
// either of them is allowed to live.
export async function checkMergeEligibility(
  targetPlayerId: string,
  sourcePlayerId: string,
  executor: typeof db = db
): Promise<EligibilityResult> {
  const [target, source] = await Promise.all([
    executor.select().from(players).where(eq(players.id, targetPlayerId)).limit(1),
    executor.select().from(players).where(eq(players.id, sourcePlayerId)).limit(1),
  ]);

  if (!target[0] || !source[0]) {
    return { eligible: false, reason: "Игрок не найден" };
  }

  // Merging INTO an already-merged-away (non-canonical) player would create
  // a chain (A -> B -> C) that nothing in the app's own read paths is meant
  // to have to handle -- lib/canonical-player.ts's resolveCanonicalPlayer()
  // can follow such a chain defensively, but this is the one place that
  // should refuse to ever create one through the normal API. Rejected
  // explicitly rather than silently redirected to B's own target: an
  // identity-sensitive operation like this should fail loudly, not guess
  // which player the caller actually meant.
  if (target[0].mergedIntoPlayerId) {
    return {
      eligible: false,
      reason: "Целевой аккаунт уже был объединён с другим и не может быть целью нового объединения",
    };
  }

  if (source[0].mergedIntoPlayerId) {
    return { eligible: false, reason: "Этот аккаунт уже был объединён с другим" };
  }

  // Moderation-bypass guard, shared with the admin merge (see
  // sourceBlockedIntoUnblockedTarget below). Before the admin Merge Center
  // existed this check was MISSING here: a blocked email-only account could
  // be absorbed by a clean Telegram account through the self-service OTP
  // flow, and since target's own is_blocked always wins, the block simply
  // vanished. Routed to the admin conflict queue instead (an admin can
  // unblock first if the block was a mistake).
  if (sourceBlockedIntoUnblockedTarget(target[0], source[0])) {
    return { eligible: false, reason: SOURCE_BLOCKED_REASON };
  }

  // Source having its own Telegram identity means this is not "one person,
  // two accounts" -- proving email ownership does not prove the two
  // Telegram identities belong to the same person. Always routed to admin
  // review, regardless of tournament history.
  if (source[0].telegramId !== null) {
    return {
      eligible: false,
      reason: "У найденного аккаунта есть собственная Telegram-идентификация",
    };
  }

  const overlap = await computeTournamentOverlap(targetPlayerId, sourcePlayerId, executor);
  if (overlap.overlappingTournamentIds.length > 0) {
    return {
      eligible: false,
      reason: "Обнаружена пересекающаяся турнирная история",
      overlappingTournamentIds: overlap.overlappingTournamentIds,
    };
  }

  return { eligible: true };
}

export async function createMergeIntent(params: {
  targetPlayerId: string;
  sourcePlayerId: string;
  email: string;
  otpVerificationId: string | null;
}): Promise<PlayerMergeIntentRow> {
  assertPostgresMode();

  const eligibility = await checkMergeEligibility(params.targetPlayerId, params.sourcePlayerId);
  const expiresAt = new Date(Date.now() + INTENT_TTL_MS).toISOString();

  return playerMergeIntentRepository.create({
    target_player_id: params.targetPlayerId,
    source_player_id: params.sourcePlayerId,
    email: params.email,
    otp_verification_id: params.otpVerificationId,
    status: eligibility.eligible ? "pending" : "conflict",
    conflict_reason: eligibility.eligible ? null : eligibility.reason,
    expires_at: expiresAt,
  });
}

export class MergeIntentNotFoundError extends Error {
  constructor() {
    super("Merge intent not found");
    this.name = "MergeIntentNotFoundError";
  }
}

export class MergeIntentForbiddenError extends Error {
  constructor() {
    super("Этот запрос на объединение принадлежит другой сессии");
    this.name = "MergeIntentForbiddenError";
  }
}

export class MergeIntentNotPendingError extends Error {
  constructor(status: string) {
    super(`Merge intent is not pending (status: ${status})`);
    this.name = "MergeIntentNotPendingError";
  }
}

export class MergeIntentExpiredError extends Error {
  constructor() {
    super("Код подтверждения объединения истёк. Повторите привязку email.");
    this.name = "MergeIntentExpiredError";
  }
}

export type ExecuteMergeResult =
  | { merged: true }
  | { merged: false; conflict: true; reason: string };

// The one and only place account data actually moves between two players.
// Single Postgres transaction, SERIALIZABLE isolation (closes the TOCTOU
// window between the preview eligibility check and this one -- a concurrent
// write that would change the tournament-overlap answer forces Postgres to
// abort with a serialization failure, which callers should treat as
// "retry", not "merged"), row locks on both the intent and player rows
// (locked in a fixed id-sorted order to avoid deadlocking against a
// concurrent merge touching the same two rows the other way).
export async function executeMerge(params: {
  intentId: string;
  sessionPlayerId: string;
}): Promise<ExecuteMergeResult> {
  assertPostgresMode();

  return db.transaction(
    async (tx) => {
      const [intent] = await tx
        .select()
        .from(playerMergeIntents)
        .where(eq(playerMergeIntents.id, params.intentId))
        .for("update");

      if (!intent) {
        throw new MergeIntentNotFoundError();
      }

      // The client never supplies target/source ids -- target is always
      // re-derived from the caller's own verified session, and it must
      // match the session that originally created this intent. A different
      // logged-in player presenting someone else's intent id is rejected
      // here, before any row is touched.
      if (intent.targetPlayerId !== params.sessionPlayerId) {
        throw new MergeIntentForbiddenError();
      }

      if (intent.status !== "pending") {
        throw new MergeIntentNotPendingError(intent.status);
      }

      if (intent.expiresAt.getTime() <= Date.now()) {
        await tx
          .update(playerMergeIntents)
          .set({ status: "expired", resolvedAt: new Date() })
          .where(eq(playerMergeIntents.id, intent.id));
        throw new MergeIntentExpiredError();
      }

      const targetId = intent.targetPlayerId;
      const sourceId = intent.sourcePlayerId;

      const { targetRow, sourceRow } = await lockPlayerPair(tx as unknown as typeof db, targetId, sourceId);

      if (!targetRow || !sourceRow) {
        throw new Error("Player row missing at merge time");
      }

      // Re-check everything the preview checked, against the now-locked
      // snapshot -- this is the TOCTOU-safe re-verification, not a repeat
      // of the earlier read for convenience.
      const eligibility = await checkMergeEligibility(targetId, sourceId, tx as unknown as typeof db);

      if (!eligibility.eligible) {
        await tx
          .update(playerMergeIntents)
          .set({
            status: "conflict",
            conflictReason: eligibility.reason,
            resolvedAt: new Date(),
          })
          .where(eq(playerMergeIntents.id, intent.id));

        return { merged: false, conflict: true, reason: eligibility.reason };
      }

      // Dealer/Staff conflict check -- run BEFORE any row is touched, same
      // position as the eligibility re-check just above.
      const dealerState = await loadDealerMergeState(tx as unknown as typeof db, targetId, sourceId);

      if (dealerState.bothHaveOpenDealerShift) {
        const reason = DEALER_OPEN_SHIFT_CONFLICT_REASON;
        await tx
          .update(playerMergeIntents)
          .set({ status: "conflict", conflictReason: reason, resolvedAt: new Date() })
          .where(eq(playerMergeIntents.id, intent.id));

        return { merged: false, conflict: true, reason };
      }

      // Teams v1 conflict check -- run BEFORE any row is touched, same
      // position as the dealer-shift check above. An admin/the two players
      // resolve this out-of-band and merge can be retried after.
      if (await hasTeamMembershipHistoryOverlap(tx as unknown as typeof db, targetId, sourceId)) {
        const reason = TEAM_HISTORY_CONFLICT_REASON;
        await tx
          .update(playerMergeIntents)
          .set({ status: "conflict", conflictReason: reason, resolvedAt: new Date() })
          .where(eq(playerMergeIntents.id, intent.id));

        return { merged: false, conflict: true, reason };
      }

      await moveMergeHistory(tx as unknown as typeof db, targetId, sourceId, dealerState.dealerProfileRows);

      // Reconciliation policy. Everything not listed here (role, access
      // flags, display_name, avatar, terms/profile-completion state,
      // telegram_id, username, nickname_status, is_blocked) is deliberately
      // left untouched on target: target's own values always win, source's
      // are discarded, never escalated. player_achievements (a derived cache)
      // and player_featured_achievements (a display-only selection) are
      // likewise deliberately left untouched on source -- refreshed for
      // target below via finalizeMergeSideEffects, never reassigned or
      // deleted, same non-action Sterling takes on its own equivalent
      // derived-cache table.
      //
      // Counters/flags: see reconcileMergedCounters (sum referral_count and
      // free_reentries_balance, OR yandex_review_bonus_claimed, and keep any
      // no-show online-registration restriction). Re-Raise has no
      // player_referrals attribution table (referrals are just these two
      // counters), so unlike Sterling there is no separate referral-conflict
      // check or referrer/referred-player FK reassignment needed here.
      //
      // Self-service never moves a Telegram identity (checkMergeEligibility
      // rejects any source that has one), so only the email is handed over:
      // cleared on source first, then set on target (see
      // writeMergedPlayerRows for why the order matters).
      await writeMergedPlayerRows(tx as unknown as typeof db, {
        targetId,
        sourceId,
        sourceIdentityRelease: { email: null },
        targetPatch: {
          email: intent.email,
          ...reconcileMergedCounters(targetRow, sourceRow),
        },
      });

      await tx
        .update(playerMergeIntents)
        .set({ status: "completed", resolvedAt: new Date() })
        .where(eq(playerMergeIntents.id, intent.id));

      return { merged: true };
    },
    { isolationLevel: "serializable" }
  );
}

// Rating itself needs no recomputation call at all: getPlayerRating() and
// the leaderboard both aggregate results.rating_points live at read time --
// moving the results rows above already IS the entire mechanism, and
// double-counting is structurally impossible because results carries a
// UNIQUE(tournament_id, player_id) constraint the eligibility check's
// zero-overlap requirement guarantees can't collide.
//
// player_achievements is the one persisted value that genuinely needs a
// refresh: it is itself a derived cache (features/achievements.ts's
// syncPlayerAchievements reads playedCount/winIds/ratingTotal from results
// and *writes* player_achievements from that) -- not source data to move or
// reconcile field-by-field. Called after the transaction commits, not
// inside it: it's a derived-cache rebuild, not part of the atomic history
// transfer, and syncPlayerAchievements has its own upsert semantics that
// don't need transactional isolation from the move itself.
export async function finalizeMergeSideEffects(targetPlayerId: string): Promise<void> {
  await syncPlayerAchievements(targetPlayerId);
}

// ===========================================================================
// Super-Admin Merge Center (/admin/account-merges).
//
// Additive to the self-service flow above -- for pairs self-service can't
// reach (e.g. two accounts neither of which the admin is signed into, or a
// source that has its own Telegram identity). Same transaction discipline as
// executeMerge (SERIALIZABLE, id-sorted player locks, every blocker
// re-checked against the locked snapshot), same history move
// (moveMergeHistory), same counter/flag reconciliation
// (reconcileMergedCounters), same identity-release ordering
// (writeMergedPlayerRows). What differs:
//
// - The ADMIN chooses the direction (target = survives, source = absorbed);
//   there is no intent/OTP. An admin merge is an explicit Super-Admin
//   action, never a proof of email ownership -- it neither creates nor
//   consumes any OTP and never rewrites an intent's OTP metadata.
// - Identity union instead of "source must not have Telegram": at most one
//   email and one Telegram identity end up on target. Each identity moves
//   from source to target when target lacks it; two DIFFERENT values of the
//   same identity kind block the merge (the schema holds one of each, and a
//   valid login identity is never discarded).
// - Additional admin-only blockers: higher role on source.
//
// The client only ever supplies (targetPlayerId, sourcePlayerId,
// confirmation). Everything else -- identity plan, field precedence,
// blockers -- is recomputed server-side from the locked rows.
// ===========================================================================

export const ADMIN_MERGE_CONFIRMATION = "ОБЪЕДИНИТЬ";

export const ROLE_HIGHER_ON_SOURCE_REASON =
  "Присоединяемый аккаунт имеет более высокий уровень доступа.\nЕсли именно он должен остаться основным — поменяйте аккаунты местами.";

// player < operator < admin (lib/roles.ts's three-tier model).
const ROLE_RANK: Record<string, number> = { player: 0, operator: 1, admin: 2 };

function roleRank(role: string): number {
  return ROLE_RANK[role] ?? 0;
}

function roleLabel(role: string): string {
  return isKnownRole(role) ? ROLE_LABELS[role] : role;
}

export type AdminMergeBlockerCode =
  | "same_account"
  | "player_not_found"
  | "target_merged"
  | "source_merged"
  | "source_blocked"
  | "email_conflict"
  | "telegram_conflict"
  | "role_higher_on_source"
  | "tournament_overlap"
  | "dealer_open_shift_conflict"
  | "team_history_conflict";

export type AdminMergeTournamentConflict = {
  id: string;
  title: string;
  start_at: string | null;
};

export type AdminMergeBlocker = {
  code: AdminMergeBlockerCode;
  message: string;
  tournaments?: AdminMergeTournamentConflict[];
};

export type AdminMergeWarningCode =
  | "display_name_differs"
  | "admin_display_name_differs"
  | "custom_avatar_differs"
  | "access_flags_differ"
  | "club_discount_differs"
  | "profile_state_differs"
  | "nickname_state_differs"
  | "role_differs"
  | "target_blocked"
  | "telegram_username_kept"
  | "season_rating_exclusions_not_moved";

export type AdminMergeWarning = { code: AdminMergeWarningCode; message: string };

// Deliberately no raw telegram_id: "is Telegram linked" + @username is
// enough to disambiguate, and keeps the numeric id out of every new payload.
export type AdminMergePlayerSummary = {
  id: string;
  display_name: string;
  admin_display_name: string | null;
  username: string | null;
  email: string | null;
  telegram_linked: boolean;
  role: string;
  is_blocked: boolean;
  merged: boolean;
  can_access_free: boolean;
  can_access_paid: boolean;
  can_access_cash: boolean;
  club_discount_percent: number;
  online_registration_restricted: boolean;
  created_at: string;
};

export type AdminMergeFinalIdentity = {
  player_id: string;
  display_name: string;
  email: string | null;
  telegram_linked: boolean;
  telegram_username: string | null;
  role: string;
  is_blocked: boolean;
  online_registration_restricted: boolean;
};

export type AdminMergeHistoryCounts = {
  tournaments: number;
  registrations: number;
  results: number;
  no_shows: number;
  team_memberships: number;
  dealer_shifts: number;
  activity_events: number;
};

export type AdminMergePreview = {
  eligible: boolean;
  target: AdminMergePlayerSummary | null;
  source: AdminMergePlayerSummary | null;
  final_identity: AdminMergeFinalIdentity | null;
  blockers: AdminMergeBlocker[];
  warnings: AdminMergeWarning[];
  counts: { target: AdminMergeHistoryCounts; source: AdminMergeHistoryCounts } | null;
};

export type AdminMergeExecuteResult =
  | {
      merged: true;
      target_player_id: string;
      source_player_id: string;
      final_identity: AdminMergeFinalIdentity;
      transferred_tournament_count: number;
    }
  | { merged: false; blockers: AdminMergeBlocker[] };

export class AdminMergeConfirmationError extends Error {
  constructor() {
    super(`Для объединения введите слово ${ADMIN_MERGE_CONFIRMATION}`);
    this.name = "AdminMergeConfirmationError";
  }
}

// Thrown when a concurrent write keeps aborting the SERIALIZABLE transaction
// even after one retry -- nothing was committed; the caller should refresh
// the preview and try again.
export class AdminMergeConcurrentUpdateError extends Error {
  constructor() {
    super("Данные аккаунтов изменились во время объединения. Обновите предпросмотр и попробуйте снова.");
    this.name = "AdminMergeConcurrentUpdateError";
  }
}

function summarizeForAdminMerge(row: PlayerRow): AdminMergePlayerSummary {
  return {
    id: row.id,
    display_name: row.displayName,
    admin_display_name: row.adminDisplayName ?? null,
    username: row.username ?? null,
    email: row.email ?? null,
    telegram_linked: row.telegramId !== null && row.telegramId !== undefined,
    role: row.role,
    is_blocked: Boolean(row.isBlocked),
    merged: Boolean(row.mergedIntoPlayerId),
    can_access_free: row.canAccessFree,
    can_access_paid: row.canAccessPaid,
    can_access_cash: row.canAccessCash,
    club_discount_percent: row.clubDiscountPercent,
    online_registration_restricted: Boolean(row.onlineRegistrationRestrictedAt),
    created_at: row.createdAt.toISOString(),
  };
}

type IdentityUnionPlan = {
  emailConflict: boolean;
  telegramConflict: boolean;
  moveEmail: boolean;
  moveTelegram: boolean;
  finalEmail: string | null;
  finalTelegramId: number | null;
  finalUsername: string | null;
  finalTelegramAvatarUrl: string | null;
};

function planIdentityUnion(targetRow: PlayerRow, sourceRow: PlayerRow): IdentityUnionPlan {
  const targetEmail = targetRow.email ?? null;
  const sourceEmail = sourceRow.email ?? null;
  const targetTelegramId = targetRow.telegramId ?? null;
  const sourceTelegramId = sourceRow.telegramId ?? null;

  // Emails compare case-insensitively, matching players_email_unique_idx.
  const emailConflict =
    targetEmail !== null && sourceEmail !== null && targetEmail.toLowerCase() !== sourceEmail.toLowerCase();
  const telegramConflict =
    targetTelegramId !== null && sourceTelegramId !== null && targetTelegramId !== sourceTelegramId;

  const moveEmail = targetEmail === null && sourceEmail !== null;
  const moveTelegram = targetTelegramId === null && sourceTelegramId !== null;

  // The Telegram bundle: username / telegram_avatar_url travel with the
  // telegram_id only when target has none of its own (target wins).
  return {
    emailConflict,
    telegramConflict,
    moveEmail,
    moveTelegram,
    finalEmail: targetEmail ?? sourceEmail,
    finalTelegramId: targetTelegramId ?? sourceTelegramId,
    finalUsername: moveTelegram ? (targetRow.username ?? sourceRow.username ?? null) : (targetRow.username ?? null),
    finalTelegramAvatarUrl: moveTelegram
      ? (targetRow.telegramAvatarUrl ?? sourceRow.telegramAvatarUrl ?? null)
      : (targetRow.telegramAvatarUrl ?? null),
  };
}

const MOSCOW_DATE_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

async function describeOverlappingTournaments(
  executor: typeof db,
  tournamentIds: string[]
): Promise<AdminMergeTournamentConflict[]> {
  const rows = await executor
    .select({ id: tournaments.id, title: tournaments.title, startAt: tournaments.startAt })
    .from(tournaments)
    .where(inArray(tournaments.id, tournamentIds))
    .orderBy(asc(tournaments.startAt));

  const byId = new Map(rows.map((row) => [row.id, row]));
  return tournamentIds
    .map((id) => {
      const row = byId.get(id);
      return {
        id,
        title: row?.title ?? `Турнир ${id}`,
        start_at: row?.startAt ? row.startAt.toISOString() : null,
      };
    })
    .sort((a, b) => (a.start_at ?? "").localeCompare(b.start_at ?? ""));
}

function tournamentConflictLine(tournament: AdminMergeTournamentConflict): string {
  const date = tournament.start_at ? ` — ${MOSCOW_DATE_FORMAT.format(new Date(tournament.start_at))}` : "";
  return `Оба аккаунта имеют данные турнира ${tournament.title}${date}`;
}

function computeTargetWinsWarnings(
  targetRow: PlayerRow,
  sourceRow: PlayerRow,
  identity: IdentityUnionPlan
): AdminMergeWarning[] {
  const warnings: AdminMergeWarning[] = [];

  if (targetRow.displayName !== sourceRow.displayName) {
    warnings.push({
      code: "display_name_differs",
      message: `Имя профиля останется «${targetRow.displayName}» (у присоединяемого — «${sourceRow.displayName}»)`,
    });
  }

  if (sourceRow.adminDisplayName && sourceRow.adminDisplayName !== targetRow.adminDisplayName) {
    warnings.push({
      code: "admin_display_name_differs",
      message: `Админское имя останется ${targetRow.adminDisplayName ? `«${targetRow.adminDisplayName}»` : "пустым"} (у присоединяемого — «${sourceRow.adminDisplayName}»)`,
    });
  }

  if (sourceRow.customAvatarUrl && sourceRow.customAvatarUrl !== targetRow.customAvatarUrl) {
    warnings.push({
      code: "custom_avatar_differs",
      message: "Загруженный аватар присоединяемого аккаунта не переносится — останется аватар основного",
    });
  }

  const flagLabels: Array<[keyof PlayerRow, string]> = [
    ["canAccessFree", "бесплатные турниры"],
    ["canAccessPaid", "платные турниры"],
    ["canAccessCash", "кэш"],
  ];
  const differingFlags = flagLabels.filter(([key]) => targetRow[key] !== sourceRow[key]).map(([, label]) => label);
  if (differingFlags.length > 0) {
    warnings.push({
      code: "access_flags_differ",
      message: `Доступы различаются (${differingFlags.join(", ")}) — останутся доступы основного аккаунта, они не объединяются`,
    });
  }

  if (targetRow.clubDiscountPercent !== sourceRow.clubDiscountPercent) {
    warnings.push({
      code: "club_discount_differs",
      message: `Клубная скидка останется ${targetRow.clubDiscountPercent}% (у присоединяемого — ${sourceRow.clubDiscountPercent}%)`,
    });
  }

  if (
    (sourceRow.acceptedTermsAt && !targetRow.acceptedTermsAt) ||
    (sourceRow.profileCompletedAt && !targetRow.profileCompletedAt)
  ) {
    warnings.push({
      code: "profile_state_differs",
      message: "У присоединяемого аккаунта приняты правила/заполнен профиль, а у основного — нет. Останется состояние основного",
    });
  }

  if (sourceRow.pendingDisplayName || sourceRow.nicknameStatus === "pending") {
    warnings.push({
      code: "nickname_state_differs",
      message: "Ник присоединяемого аккаунта на модерации — эта заявка не переносится",
    });
  }

  // Only reachable with target's role >= source's (a higher source role is
  // a blocker) -- informational: no escalation, no downgrade of target.
  if (targetRow.role !== sourceRow.role) {
    warnings.push({
      code: "role_differs",
      message: `Роль останется «${roleLabel(targetRow.role)}» (у присоединяемого — «${roleLabel(sourceRow.role)}»)`,
    });
  }

  if (targetRow.isBlocked) {
    warnings.push({
      code: "target_blocked",
      message: "Основной аккаунт заблокирован и останется заблокированным",
    });
  }

  if (identity.moveTelegram && targetRow.username && sourceRow.username && targetRow.username !== sourceRow.username) {
    warnings.push({
      code: "telegram_username_kept",
      message: `Останется username @${targetRow.username} основного аккаунта (у присоединяемого — @${sourceRow.username})`,
    });
  }

  return warnings;
}

type AdminMergePlanInternals = {
  blockers: AdminMergeBlocker[];
  warnings: AdminMergeWarning[];
  identity: IdentityUnionPlan | null;
  finalIdentity: AdminMergeFinalIdentity | null;
  dealerProfileRows: DealerProfileRow[];
  sourceTournamentCount: number;
  targetTournamentCount: number;
};

// THE admin eligibility computation -- the same function feeds the
// read-only preview AND runs again inside executeAdminMerge's transaction
// against the locked rows. Evaluates every blocker (not first-fail) so the
// preview can show all of them at once.
async function computeAdminMergePlan(
  executor: typeof db,
  targetId: string,
  sourceId: string,
  targetRow: PlayerRow | undefined,
  sourceRow: PlayerRow | undefined
): Promise<AdminMergePlanInternals> {
  const empty = {
    warnings: [],
    identity: null,
    finalIdentity: null,
    dealerProfileRows: [],
    sourceTournamentCount: 0,
    targetTournamentCount: 0,
  };

  if (targetId === sourceId) {
    return {
      ...empty,
      blockers: [{ code: "same_account", message: "Нельзя объединить аккаунт сам с собой" }],
    };
  }

  if (!targetRow || !sourceRow) {
    return { ...empty, blockers: [{ code: "player_not_found", message: "Игрок не найден" }] };
  }

  const blockers: AdminMergeBlocker[] = [];

  if (targetRow.mergedIntoPlayerId) {
    blockers.push({
      code: "target_merged",
      message: "Основной аккаунт уже был объединён с другим и не может быть целью нового объединения",
    });
  }
  if (sourceRow.mergedIntoPlayerId) {
    blockers.push({ code: "source_merged", message: "Присоединяемый аккаунт уже был объединён с другим" });
  }

  if (sourceBlockedIntoUnblockedTarget(targetRow, sourceRow)) {
    blockers.push({ code: "source_blocked", message: SOURCE_BLOCKED_REASON });
  }

  const identity = planIdentityUnion(targetRow, sourceRow);
  if (identity.emailConflict) {
    blockers.push({
      code: "email_conflict",
      message: "У обоих аккаунтов разные email — у игрока может быть только один email, объединение заблокировано",
    });
  }
  if (identity.telegramConflict) {
    blockers.push({
      code: "telegram_conflict",
      message: "У обоих аккаунтов разные Telegram-аккаунты — объединение заблокировано",
    });
  }

  if (roleRank(sourceRow.role) > roleRank(targetRow.role)) {
    blockers.push({ code: "role_higher_on_source", message: ROLE_HIGHER_ON_SOURCE_REASON });
  }

  const overlap = await computeTournamentOverlap(targetId, sourceId, executor);
  if (overlap.overlappingTournamentIds.length > 0) {
    const conflicts = await describeOverlappingTournaments(executor, overlap.overlappingTournamentIds);
    blockers.push({
      code: "tournament_overlap",
      message: conflicts.map(tournamentConflictLine).join("\n"),
      tournaments: conflicts,
    });
  }

  const dealerState = await loadDealerMergeState(executor, targetId, sourceId);
  if (dealerState.bothHaveOpenDealerShift) {
    blockers.push({ code: "dealer_open_shift_conflict", message: DEALER_OPEN_SHIFT_CONFLICT_REASON });
  }

  if (await hasTeamMembershipHistoryOverlap(executor, targetId, sourceId)) {
    blockers.push({ code: "team_history_conflict", message: TEAM_HISTORY_CONFLICT_REASON });
  }

  const restrictedAt = mergeOnlineRegistrationRestriction(
    targetRow.onlineRegistrationRestrictedAt,
    sourceRow.onlineRegistrationRestrictedAt
  );

  return {
    blockers,
    warnings: computeTargetWinsWarnings(targetRow, sourceRow, identity),
    identity,
    finalIdentity: {
      player_id: targetRow.id,
      display_name: targetRow.displayName,
      email: identity.emailConflict ? (targetRow.email ?? null) : identity.finalEmail,
      telegram_linked: identity.finalTelegramId !== null,
      telegram_username: identity.finalUsername,
      role: targetRow.role,
      is_blocked: Boolean(targetRow.isBlocked),
      online_registration_restricted: restrictedAt !== null,
    },
    dealerProfileRows: dealerState.dealerProfileRows,
    sourceTournamentCount: overlap.sourceTournamentIds.size,
    targetTournamentCount: overlap.targetTournamentIds.size,
  };
}

// One aggregate round-trip per player (no N+1): the movement summary the
// preview shows. Read-only; never used to decide anything.
async function loadHistoryCounts(
  executor: typeof db,
  playerId: string,
  tournamentCount: number
): Promise<AdminMergeHistoryCounts & { season_rating_exclusions: number }> {
  const rows = await executor.execute<{
    registrations: number;
    no_shows: number;
    results: number;
    team_memberships: number;
    dealer_shifts: number;
    activity_events: number;
    season_rating_exclusions: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM registrations WHERE player_id = ${playerId}) AS registrations,
      (SELECT count(*)::int FROM registrations WHERE player_id = ${playerId} AND no_show_at IS NOT NULL) AS no_shows,
      (SELECT count(*)::int FROM results WHERE player_id = ${playerId}) AS results,
      (SELECT count(*)::int FROM team_memberships WHERE player_id = ${playerId}) AS team_memberships,
      (SELECT count(*)::int FROM dealer_shifts WHERE dealer_player_id = ${playerId}) AS dealer_shifts,
      (SELECT count(*)::int FROM activity_events WHERE player_id = ${playerId}) AS activity_events,
      (SELECT count(*)::int FROM season_rating_exclusions WHERE player_id = ${playerId}) AS season_rating_exclusions
  `);
  const row = (rows as unknown as Array<Record<string, number>>)[0] ?? {};
  return {
    tournaments: tournamentCount,
    registrations: Number(row.registrations ?? 0),
    results: Number(row.results ?? 0),
    no_shows: Number(row.no_shows ?? 0),
    team_memberships: Number(row.team_memberships ?? 0),
    dealer_shifts: Number(row.dealer_shifts ?? 0),
    activity_events: Number(row.activity_events ?? 0),
    season_rating_exclusions: Number(row.season_rating_exclusions ?? 0),
  };
}

async function loadPlayerRow(executor: typeof db, playerId: string): Promise<PlayerRow | undefined> {
  const [row] = await executor.select().from(players).where(eq(players.id, playerId)).limit(1);
  return row;
}

// Read-only, server-computed. Never trusted by executeAdminMerge -- it is
// recomputed there from scratch against locked rows.
export async function previewAdminMerge(params: {
  targetPlayerId: string;
  sourcePlayerId: string;
}): Promise<AdminMergePreview> {
  assertPostgresMode();

  const { targetPlayerId, sourcePlayerId } = params;
  const [targetRow, sourceRow] =
    targetPlayerId === sourcePlayerId
      ? [undefined, undefined]
      : await Promise.all([loadPlayerRow(db, targetPlayerId), loadPlayerRow(db, sourcePlayerId)]);

  const plan = await computeAdminMergePlan(db, targetPlayerId, sourcePlayerId, targetRow, sourceRow);

  let counts: AdminMergePreview["counts"] = null;
  const warnings = [...plan.warnings];
  if (targetRow && sourceRow && plan.identity) {
    const [targetCounts, sourceCounts] = await Promise.all([
      loadHistoryCounts(db, targetPlayerId, plan.targetTournamentCount),
      loadHistoryCounts(db, sourcePlayerId, plan.sourceTournamentCount),
    ]);
    const { season_rating_exclusions: sourceExclusions, ...sourceRest } = sourceCounts;
    const { season_rating_exclusions: _targetExclusions, ...targetRest } = targetCounts;
    void _targetExclusions;
    counts = { target: targetRest, source: sourceRest };

    // season_rating_exclusions is NOT part of the existing history move
    // (it is a per-season Super-Admin decision, not player history). Shown
    // so the admin can re-apply "вне зачёта" on target by hand if needed.
    if (sourceExclusions > 0) {
      warnings.push({
        code: "season_rating_exclusions_not_moved",
        message: `У присоединяемого аккаунта есть исключения из зачёта сезона (${sourceExclusions}) — они не переносятся, при необходимости назначьте их основному вручную`,
      });
    }
  }

  return {
    eligible: plan.blockers.length === 0,
    target: targetRow ? summarizeForAdminMerge(targetRow) : null,
    source: sourceRow ? summarizeForAdminMerge(sourceRow) : null,
    final_identity: plan.finalIdentity,
    blockers: plan.blockers,
    warnings,
    counts,
  };
}

const SERIALIZATION_FAILURE_SQLSTATE = "40001";

// Walks the error cause chain: drizzle's postgres-js adapter wraps
// query-level errors and puts the real Postgres error (with its SQLSTATE)
// on `.cause` (same reasoning as app/api/auth/email/merge/route.ts).
function isSerializationFailure(err: unknown): boolean {
  let current: unknown = err;
  for (let i = 0; i < 5 && current; i++) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: unknown }).code === SERIALIZATION_FAILURE_SQLSTATE
    ) {
      return true;
    }
    current = (current as { cause?: unknown })?.cause;
  }
  return false;
}

async function runAdminMergeTransaction(targetId: string, sourceId: string): Promise<AdminMergeExecuteResult> {
  return db.transaction(
    async (tx) => {
      const executor = tx as unknown as typeof db;

      // Lock order matches executeMerge (intent rows first, then the player
      // pair in id-sorted order), so an admin merge racing a self-service
      // confirmation of an intent for the same pair can't deadlock: the
      // loser waits, then fails its SERIALIZABLE check / sees the merged
      // state, and nothing is applied twice.
      const pairIntents = await tx
        .select({ id: playerMergeIntents.id, targetPlayerId: playerMergeIntents.targetPlayerId })
        .from(playerMergeIntents)
        .where(
          and(
            or(
              and(eq(playerMergeIntents.targetPlayerId, targetId), eq(playerMergeIntents.sourcePlayerId, sourceId)),
              and(eq(playerMergeIntents.targetPlayerId, sourceId), eq(playerMergeIntents.sourcePlayerId, targetId))
            ),
            inArray(playerMergeIntents.status, ["pending", "conflict"])
          )
        )
        .orderBy(asc(playerMergeIntents.id))
        .for("update");

      const { targetRow, sourceRow } = await lockPlayerPair(executor, targetId, sourceId);

      // Every blocker re-evaluated against the locked snapshot -- the
      // preview's answer is never trusted.
      const plan = await computeAdminMergePlan(executor, targetId, sourceId, targetRow, sourceRow);
      if (plan.blockers.length > 0 || !targetRow || !sourceRow || !plan.identity || !plan.finalIdentity) {
        return {
          merged: false,
          blockers:
            plan.blockers.length > 0 ? plan.blockers : [{ code: "player_not_found", message: "Игрок не найден" }],
        };
      }

      await moveMergeHistory(executor, targetId, sourceId, plan.dealerProfileRows);

      // Identity union. With both conflict blockers clear, every identity
      // source owns is either moved to target or (when target already has
      // the very same identity -- impossible under the unique indexes)
      // already present there, so releasing all of them on source never
      // drops a login identity.
      const { identity } = plan;
      const sourceIdentityRelease: Partial<typeof players.$inferInsert> = {};
      if (sourceRow.email !== null) {
        sourceIdentityRelease.email = null;
      }
      if (sourceRow.telegramId !== null) {
        sourceIdentityRelease.telegramId = null;
        sourceIdentityRelease.username = null;
        sourceIdentityRelease.telegramAvatarUrl = null;
      }

      const targetPatch: Partial<typeof players.$inferInsert> = {
        ...reconcileMergedCounters(targetRow, sourceRow),
      };
      if (identity.moveEmail) {
        targetPatch.email = identity.finalEmail;
      }
      if (identity.moveTelegram) {
        targetPatch.telegramId = identity.finalTelegramId;
        targetPatch.username = identity.finalUsername;
        targetPatch.telegramAvatarUrl = identity.finalTelegramAvatarUrl;
      }

      await writeMergedPlayerRows(executor, { targetId, sourceId, sourceIdentityRelease, targetPatch });

      // Stale self-service intents for this exact pair: same direction ->
      // completed (that merge has now happened); opposite direction ->
      // cancelled (moot -- the admin chose the other account to survive).
      // conflict_reason / otp_verification_id / email are left untouched.
      const now = new Date();
      const sameDirectionIds = pairIntents.filter((row) => row.targetPlayerId === targetId).map((row) => row.id);
      const reverseDirectionIds = pairIntents.filter((row) => row.targetPlayerId !== targetId).map((row) => row.id);
      if (sameDirectionIds.length > 0) {
        await tx
          .update(playerMergeIntents)
          .set({ status: "completed", resolvedAt: now })
          .where(inArray(playerMergeIntents.id, sameDirectionIds));
      }
      if (reverseDirectionIds.length > 0) {
        await tx
          .update(playerMergeIntents)
          .set({ status: "cancelled", resolvedAt: now })
          .where(inArray(playerMergeIntents.id, reverseDirectionIds));
      }

      return {
        merged: true,
        target_player_id: targetId,
        source_player_id: sourceId,
        final_identity: plan.finalIdentity,
        transferred_tournament_count: plan.sourceTournamentCount,
      };
    },
    { isolationLevel: "serializable" }
  );
}

// Destructive, Super-Admin-only (the route calls
// assertServerActorRole(["admin"]) before reaching here). Accepts only the
// two ids and the typed confirmation; everything else is recomputed.
// No network I/O inside the transaction; the achievement refresh runs after
// commit via finalizeMergeSideEffects (by the caller).
export async function executeAdminMerge(params: {
  targetPlayerId: string;
  sourcePlayerId: string;
  confirmation: string;
}): Promise<AdminMergeExecuteResult> {
  assertPostgresMode();

  if (params.confirmation !== ADMIN_MERGE_CONFIRMATION) {
    throw new AdminMergeConfirmationError();
  }

  if (params.targetPlayerId === params.sourcePlayerId) {
    return { merged: false, blockers: [{ code: "same_account", message: "Нельзя объединить аккаунт сам с собой" }] };
  }

  try {
    return await runAdminMergeTransaction(params.targetPlayerId, params.sourcePlayerId);
  } catch (err) {
    if (!isSerializationFailure(err)) throw err;
  }

  // One retry from scratch: almost always the competing transaction was a
  // concurrent merge of the same pair, and the retry now sees
  // source_merged and returns it as a blocker instead of merging twice.
  try {
    return await runAdminMergeTransaction(params.targetPlayerId, params.sourcePlayerId);
  } catch (err) {
    if (isSerializationFailure(err)) throw new AdminMergeConcurrentUpdateError();
    throw err;
  }
}

export type AdminMergeSearchResult = AdminMergePlayerSummary;

const SEARCH_RESULT_LIMIT = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// Server-side search for the Merge Center selectors: display/admin name,
// Telegram @username, email (substring, case-insensitive), exact Telegram
// ID, exact player UUID. Already-merged-away players are never returned, so
// they can't be picked as a candidate. Bounded result set; never loads the
// player table to the client.
export async function searchPlayersForAdminMerge(rawQuery: string): Promise<AdminMergeSearchResult[]> {
  assertPostgresMode();

  const query = rawQuery.trim();
  if (query.length < 2) {
    return [];
  }

  const textQuery = query.replace(/^@/, "");
  const pattern = `%${escapeLikePattern(textQuery)}%`;

  const conditions: SQL[] = [
    ilike(players.displayName, pattern),
    ilike(players.adminDisplayName, pattern),
    ilike(players.username, pattern),
    ilike(players.email, pattern),
  ];

  if (/^\d{1,15}$/.test(query)) {
    conditions.push(eq(players.telegramId, Number(query)));
  }
  if (UUID_PATTERN.test(query)) {
    conditions.push(eq(players.id, query.toLowerCase()));
  }

  const rows = await db
    .select()
    .from(players)
    .where(and(isNull(players.mergedIntoPlayerId), or(...conditions)))
    .orderBy(asc(players.displayName))
    .limit(SEARCH_RESULT_LIMIT);

  return rows.map(summarizeForAdminMerge);
}
