import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
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
} from "@/lib/db/schema";
import { syncPlayerAchievements } from "@/features/achievements";
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
      const [firstId, secondId] = [targetId, sourceId].sort();

      const [firstRow] = await tx.select().from(players).where(eq(players.id, firstId)).for("update");
      const [secondRow] = await tx.select().from(players).where(eq(players.id, secondId)).for("update");
      const targetRow = firstId === targetId ? firstRow : secondRow;
      const sourceRow = firstId === sourceId ? firstRow : secondRow;

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
      // position as the eligibility re-check just above. If both accounts
      // currently have an open dealer shift, merging them would either
      // collapse two open shifts onto one dealer_player_id (violating
      // dealer_shifts_one_open_per_dealer) or silently discard one of them
      // -- neither is acceptable, so this fails closed with a clear domain
      // reason instead. Ported from Sterling's own port of Re-Raise's
      // Dealer Payroll feature -- same table/column shapes on both sides.
      const [openDealerShiftRows, dealerProfileRows] = await Promise.all([
        tx
          .select({ dealerPlayerId: dealerShifts.dealerPlayerId })
          .from(dealerShifts)
          .where(and(inArray(dealerShifts.dealerPlayerId, [targetId, sourceId]), isNull(dealerShifts.endedAt))),
        tx.select().from(dealerProfiles).where(inArray(dealerProfiles.playerId, [targetId, sourceId])),
      ]);

      const targetHasOpenDealerShift = openDealerShiftRows.some((row) => row.dealerPlayerId === targetId);
      const sourceHasOpenDealerShift = openDealerShiftRows.some((row) => row.dealerPlayerId === sourceId);

      if (targetHasOpenDealerShift && sourceHasOpenDealerShift) {
        const reason =
          "Оба аккаунта имеют открытую смену дилера — объединение невозможно, сначала завершите одну из смен";
        await tx
          .update(playerMergeIntents)
          .set({ status: "conflict", conflictReason: reason, resolvedAt: new Date() })
          .where(eq(playerMergeIntents.id, intent.id));

        return { merged: false, conflict: true, reason };
      }

      // Teams v1 conflict check -- run BEFORE any row is touched, same
      // position as the dealer-shift check above. If BOTH accounts
      // currently hold an active team_memberships row (whether the SAME
      // team or different teams), blindly reassigning source's row onto
      // target's id would give target two simultaneous active memberships,
      // violating team_memberships_one_active_per_player_idx -- and even
      // where that wouldn't literally violate the constraint (it always
      // would, since "both active" means two distinct rows), there is no
      // single correct choice of which team the merged human should end up
      // on. Fail closed with an explicit blocker rather than silently
      // picking one; an admin/the two players resolve this out-of-band
      // (one of them leaves their team) and merge can be retried after.
      const activeTeamMembershipRows = await tx
        .select({ playerId: teamMemberships.playerId })
        .from(teamMemberships)
        .where(and(inArray(teamMemberships.playerId, [targetId, sourceId]), isNull(teamMemberships.leftAt)));

      const targetHasActiveTeam = activeTeamMembershipRows.some((row) => row.playerId === targetId);
      const sourceHasActiveTeam = activeTeamMembershipRows.some((row) => row.playerId === sourceId);

      if (targetHasActiveTeam && sourceHasActiveTeam) {
        const reason =
          "Оба аккаунта состоят в активных командах — объединение невозможно, сначала покиньте одну из команд";
        await tx
          .update(playerMergeIntents)
          .set({ status: "conflict", conflictReason: reason, resolvedAt: new Date() })
          .where(eq(playerMergeIntents.id, intent.id));

        return { merged: false, conflict: true, reason };
      }

      // History: reassign every row -- safe only because eligibility above
      // just confirmed zero tournament overlap, so none of these updates
      // can collide with an existing target row on any (tournament_id,
      // player_id) unique/composite-PK constraint.
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

      // Teams v1 -- move EVERY team_memberships row (active or historical)
      // from source to target, unconditionally. This is required for
      // scoring correctness, not just tidiness: lib/team-scoring.ts
      // attributes a result to a team by finding the membership interval
      // for `results.player_id` that contains the tournament's start_at --
      // and results.player_id was just reassigned to targetId above. If a
      // membership interval source earned points under were left on
      // sourceId, that history would silently stop being attributable to
      // any team after the merge (an under-count), not merely "belong to
      // the wrong id". The conflict check above already guarantees at most
      // one of target/source has an ACTIVE row, so this can never produce
      // two simultaneous active memberships for target.
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

      // Dealer/Staff ownership transfer -- shift history always moves with
      // the player. Unconditional (a no-op update if source never had any
      // shifts): created_by_player_id/ended_by_player_id describe a
      // specific past admin action and are deliberately left untouched
      // here, same reasoning Sterling applied to its own admin-id columns.
      await tx
        .update(dealerShifts)
        .set({ dealerPlayerId: targetId })
        .where(eq(dealerShifts.dealerPlayerId, sourceId));

      // Dealer profile merge -- the open-shift conflict check above already
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

      // Reconciliation policy. Everything not listed here (role, access
      // flags, display_name, avatar, terms/profile-completion state,
      // telegram_id, username, nickname_status) is deliberately left
      // untouched on target: target's own values always win, source's are
      // discarded, never escalated. player_achievements (a derived cache)
      // and player_featured_achievements (a display-only selection) are
      // likewise deliberately left untouched on source -- refreshed for
      // target below via finalizeMergeSideEffects, never reassigned or
      // deleted, same non-action Sterling takes on its own equivalent
      // derived-cache table.
      //
      // referral_count/free_reentries_balance are summed (accumulate-only
      // ledgers, no other source of truth); yandex_review_bonus_claimed is
      // OR'd (one-time claim flag). Re-Raise has no player_referrals
      // attribution table (referrals are just these two counters), so
      // unlike Sterling there is no separate referral-conflict check or
      // referrer/referred-player FK reassignment needed here.
      //
      // Source's email MUST be cleared before target's is set to the same
      // value: players_email_unique_idx is a plain (non-deferrable) unique
      // index, checked per-statement, not at commit -- doing this in the
      // other order momentarily leaves both rows holding the identical
      // email and the second UPDATE fails with a unique-violation.
      await tx
        .update(players)
        .set({
          email: null,
          mergedIntoPlayerId: targetId,
          mergedAt: new Date(),
        })
        .where(eq(players.id, sourceId));

      await tx
        .update(players)
        .set({
          email: intent.email,
          referralCount: targetRow.referralCount + sourceRow.referralCount,
          freeReentriesBalance: targetRow.freeReentriesBalance + sourceRow.freeReentriesBalance,
          yandexReviewBonusClaimed: targetRow.yandexReviewBonusClaimed || sourceRow.yandexReviewBonusClaimed,
        })
        .where(eq(players.id, targetId));

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
