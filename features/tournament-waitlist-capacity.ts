import "server-only";

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  players,
  registrations,
  tournamentAttendance,
  tournamentLateRegistration,
  tournamentPlayerEliminations,
  tournaments,
} from "@/lib/db/schema";
import { lockTournamentRow, type Executor } from "@/features/tournament-row-lock";
import { dispatchWaitlistPromotionNotifications } from "@/features/tournament-promotion-notification";
import { TournamentNotFoundError } from "@/lib/tournament-errors";
import type { Registration, RegistrationStatus } from "@/types/domain";

// Tournament seat capacity + waitlist reconciliation -- the ONE canonical
// place that decides "is there a free seat in this tournament right now".
//
// CAPACITY MODEL
// --------------
// `tournaments.max_players` is a SIMULTANEOUS-SEAT cap, not a lifetime
// registration cap:
//
//   seatLoad = registrations with status IN ('registered','attended')
//              whose player is NOT currently eliminated
//              (tournament_player_eliminations.eliminated = true)
//
// Waitlist rows never consume a seat. `tournament_attendance.arrived` is
// deliberately NOT part of this formula -- a registered player who hasn't
// been marked as arrived yet still reserves their seat (arrived only feeds
// field size / rating, which this module never touches). A tournament can
// therefore have far more lifetime entrants than max_players (eliminated
// players free their seat for the next waitlisted player) while never
// seating more than max_players at once.
//
// Promotion (waitlist -> registered, FIFO by created_at) only happens while
// Late Registration is still OPEN, i.e. while no tournament_late_registration
// snapshot row exists for the tournament (that row is created exactly when
// late reg closes -- see features/late-registration.ts, which this module
// only reads and never writes).
//
// CONCURRENCY
// -----------
// Every capacity-affecting decision (waitlist promotion, a new entrant's
// registered-vs-waitlist decision, un-elimination's capacity check) runs in
// a single db.transaction that first takes `SELECT ... FOR UPDATE` on the
// tournament row. That row lock is the per-tournament serialization point:
// two concurrent decisions for the same tournament run one after another,
// and the second one always computes seatLoad from the first one's
// committed state. Under Postgres's default READ COMMITTED isolation each
// statement after the lock is acquired sees every transaction committed
// before it, so the reads that follow the lock are never stale -- no
// SERIALIZABLE retry loop needed. Same "lock the parent row first"
// precedent as features/teams.ts. Writes that can only DECREASE seatLoad
// (an elimination, a cancellation, an admin removal) do not need the lock
// for their own write; they call reconcileTournamentWaitlistCapacity
// afterwards, which takes it.
//
// The lock itself (features/tournament-row-lock.ts) is also taken by
// features/late-registration.ts before it creates the
// tournament_late_registration snapshot -- see that module's doc comment.
// Sharing the exact same lock is what prevents a promotion from this
// module committing after the official Late Registration closing boundary
// (or vice versa): whichever side acquires the lock first runs to
// completion before the other even reads whether a snapshot exists.
//
// NO-SHOW WAITLIST POLICY
// -----------------------
// players.online_registration_restricted_at (set by the explicit admin
// "Не пришёл" action, see markRegistrationNoShowWithinCapacity below) means
// "this player may self-register, but only into the WAITLIST". The ONE
// reconciler in this file therefore SKIPS restricted waitlist candidates
// when filling free seats: a restricted row stays `waitlist`, consumes zero
// seats, keeps its created_at (queue position) untouched, and never blocks
// an eligible player behind it -- FIFO is strict AMONG ELIGIBLE candidates
// only. A restricted player only ever gets a seat through staff
// "Допустить в игру" (admitWaitlistedRegistrationWithinCapacity), which is
// a deliberate, documented exception to FIFO for a physically present
// player. No automatic no-show inference exists anywhere.
//
// NO-SHOW QUARANTINE (per registration): a waitlist row whose OWN
// registrations.no_show_at IS NOT NULL is a quarantined "Не пришли" row and
// is NEVER automatically promoted -- independently of the player's global
// restriction. Staff may later lift the global restriction ("Разрешить
// обычную запись", future-registration policy only), and that must not make
// this tournament's old no-show row suddenly auto-promote. Canonical
// automatic eligibility is therefore:
//
//   status = 'waitlist' AND no_show_at IS NULL AND player not restricted
//
// The seat formula (computeSeatLoad) is untouched -- a quarantined row was
// never seat-consuming. It is skipped exactly like a restricted row (FIFO
// among eligible candidates, never blocks anyone behind it) and only ever
// leaves quarantine through staff "Допустить в игру", which clears THIS
// registration's no_show_at.
//
// PROMOTION NOTIFICATION
// ----------------------
// Every real waitlist -> registered transition made here (auto-promotion
// or manual admission) claims registrations.
// waitlist_promotion_notification_claimed_at inside the same transaction
// (only if it is still NULL), and the claimed ids are dispatched AFTER the
// transaction commits (features/tournament-promotion-notification.ts) --
// at most one message per registration, ever.
//
// Postgres-only by design (same precedent as lib/player-merge.ts): this
// needs real row locks inside one transaction, which the dual-provider
// repository abstraction can't express, so it talks to Postgres directly via
// `db`/`schema` and fails closed under any other DATABASE_PROVIDER.

export class TournamentCapacityUnavailableError extends Error {
  constructor() {
    super("Tournament capacity management requires DATABASE_PROVIDER=postgres");
    this.name = "TournamentCapacityUnavailableError";
  }
}

export const RETURN_TO_GAME_NO_SEAT_MESSAGE =
  "Невозможно вернуть игрока в игру — турнир заполнен (нет свободных мест)";

// Thrown (fail closed) when un-eliminating a player would push seatLoad
// above max_players. A distinct type so the GS poller can skip just that
// one row instead of aborting the whole tournament's sync pass.
export class TournamentSeatUnavailableError extends Error {
  constructor(message = RETURN_TO_GAME_NO_SEAT_MESSAGE) {
    super(message);
    this.name = "TournamentSeatUnavailableError";
  }
}

function assertPostgresMode() {
  if (process.env.DATABASE_PROVIDER !== "postgres") {
    throw new TournamentCapacityUnavailableError();
  }
}

const SEAT_CONSUMING_STATUSES: RegistrationStatus[] = ["registered", "attended"];

export type WaitlistReconciliationResult = {
  promotedRegistrationIds: string[];
  promotedPlayerIds: string[];
};

type TournamentRegistrationState = {
  id: string;
  playerId: string;
  status: string;
  createdAt: Date;
  // NULL/undefined until the first waitlist -> registered transition of
  // this registration claims its one promotion notification.
  waitlistPromotionNotificationClaimedAt?: Date | null;
  // THIS registration's "Не пришёл" mark. Non-null on a waitlist row =
  // quarantined: never auto-promoted (see NO-SHOW QUARANTINE above).
  noShowAt?: Date | null;
};

type CapacityState = {
  maxPlayers: number;
  lateRegistrationClosed: boolean;
  registrations: TournamentRegistrationState[];
  eliminatedPlayerIds: Set<string>;
  // Waitlisted players whose online registration is restricted after a
  // no-show -- skipped by automatic promotion (never removed/reordered).
  restrictedPlayerIds: Set<string>;
};

// THE capacity formula -- pure, so it can be unit-tested directly. Every
// capacity decision in this module goes through it; nothing else in the
// codebase re-implements it.
export function computeSeatLoad(
  registrationRows: { playerId: string; status: string }[],
  eliminatedPlayerIds: ReadonlySet<string>
): number {
  return registrationRows.filter(
    (row) =>
      (SEAT_CONSUMING_STATUSES as string[]).includes(row.status) &&
      !eliminatedPlayerIds.has(row.playerId)
  ).length;
}

function oldestWaitlisted(state: CapacityState): TournamentRegistrationState[] {
  return state.registrations
    .filter((row) => row.status === "waitlist")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

// The FIFO queue automatic promotion actually draws from: every waitlisted
// row in created_at order, MINUS quarantined no-show rows (this
// registration's no_show_at IS NOT NULL) and MINUS restricted players.
// Skipping (not removing) such a row is what lets eligible players behind
// it promote around it while its own position stays untouched. The
// no_show_at check is deliberately independent of the restriction: lifting
// a player's global restriction never re-enables an old no-show row.
function isAutoPromotionEligible(state: CapacityState, row: TournamentRegistrationState): boolean {
  return row.noShowAt == null && !state.restrictedPlayerIds.has(row.playerId);
}

function eligibleWaitlisted(state: CapacityState): TournamentRegistrationState[] {
  return oldestWaitlisted(state).filter((row) => isAutoPromotionEligible(state, row));
}

// Restriction state for a set of players, read inside the caller's
// transaction. Filters in application code as well as in SQL so the
// result is exact regardless of the executor.
async function readRestrictedPlayerIds(tx: Executor, playerIds: string[]): Promise<Set<string>> {
  if (playerIds.length === 0) {
    return new Set();
  }
  const wanted = new Set(playerIds);
  const rows = await tx
    .select({ id: players.id, restrictedAt: players.onlineRegistrationRestrictedAt })
    .from(players)
    .where(and(inArray(players.id, playerIds), isNotNull(players.onlineRegistrationRestrictedAt)));
  return new Set(
    rows.filter((row) => row.restrictedAt != null && wanted.has(row.id)).map((row) => row.id)
  );
}

// Reads everything the capacity formula needs. Only meaningful when called
// AFTER lockTournamentRow inside the same transaction (or, for the
// advisory pre-check below, knowingly without the lock).
async function readCapacityState(
  tx: Executor,
  tournamentId: string,
  maxPlayers: number
): Promise<CapacityState> {
  // Sequential, not Promise.all: one transaction = one connection.
  const lateRegRows = await tx
    .select({ tournamentId: tournamentLateRegistration.tournamentId })
    .from(tournamentLateRegistration)
    .where(eq(tournamentLateRegistration.tournamentId, tournamentId))
    .limit(1);
  const registrationRows = await tx
    .select({
      id: registrations.id,
      playerId: registrations.playerId,
      status: registrations.status,
      createdAt: registrations.createdAt,
      waitlistPromotionNotificationClaimedAt: registrations.waitlistPromotionNotificationClaimedAt,
      noShowAt: registrations.noShowAt,
    })
    .from(registrations)
    .where(eq(registrations.tournamentId, tournamentId));
  const eliminationRows = await tx
    .select({
      playerId: tournamentPlayerEliminations.playerId,
      eliminated: tournamentPlayerEliminations.eliminated,
    })
    .from(tournamentPlayerEliminations)
    .where(eq(tournamentPlayerEliminations.tournamentId, tournamentId));

  // Final Month (is_final) composition is admin-curated and outside the
  // no-show policy entirely -- nobody is skipped there. Only read when
  // there is a waitlist at all (the common full-table case without a
  // waitlist pays nothing extra).
  const waitlistedPlayerIds = registrationRows
    .filter((row) => row.status === "waitlist")
    .map((row) => row.playerId);
  const restrictedPlayerIds =
    waitlistedPlayerIds.length > 0 && !(await isFinalTournament(tx, tournamentId))
      ? await readRestrictedPlayerIds(tx, waitlistedPlayerIds)
      : new Set<string>();

  return {
    maxPlayers,
    lateRegistrationClosed: lateRegRows.length > 0,
    registrations: registrationRows,
    eliminatedPlayerIds: new Set(
      eliminationRows.filter((row) => row.eliminated).map((row) => row.playerId)
    ),
    restrictedPlayerIds,
  };
}

function freeSlots(state: CapacityState): number {
  return Math.max(
    0,
    state.maxPlayers - computeSeatLoad(state.registrations, state.eliminatedPlayerIds)
  );
}

// Claims the one-time promotion notification for registrations that have
// JUST transitioned waitlist -> registered in this transaction. Only rows
// whose claim is still NULL are claimed (decided under the tournament-row
// lock, which every writer of this column holds, and re-asserted in SQL via
// IS NULL); returns exactly the ids claimed now -- the only ids that may
// ever be dispatched for these transitions.
async function claimPromotionNotificationsWithinLock(
  tx: Executor,
  rows: TournamentRegistrationState[]
): Promise<string[]> {
  const unclaimed = rows.filter((row) => row.waitlistPromotionNotificationClaimedAt == null);
  if (unclaimed.length === 0) {
    return [];
  }
  const now = new Date();
  const ids = unclaimed.map((row) => row.id);
  await tx
    .update(registrations)
    .set({ waitlistPromotionNotificationClaimedAt: now })
    .where(
      and(
        inArray(registrations.id, ids),
        isNull(registrations.waitlistPromotionNotificationClaimedAt)
      )
    );
  for (const row of unclaimed) {
    row.waitlistPromotionNotificationClaimedAt = now;
  }
  return ids;
}

type PromotionOutcome = {
  result: WaitlistReconciliationResult;
  claimedNotificationRegistrationIds: string[];
};

// Promotes the oldest ELIGIBLE (non-restricted) waitlisted registrations
// into currently-free seats. Mutates `state` in place so a caller in the
// same transaction (e.g. a new entrant's decision) sees the post-promotion
// state without a re-read.
async function promoteWithinLock(tx: Executor, state: CapacityState): Promise<PromotionOutcome> {
  const result: WaitlistReconciliationResult = {
    promotedRegistrationIds: [],
    promotedPlayerIds: [],
  };
  const outcome: PromotionOutcome = { result, claimedNotificationRegistrationIds: [] };

  // Late Registration closed => no new entrants are seated, ever, even if
  // eliminations freed seats.
  if (state.lateRegistrationClosed) {
    return outcome;
  }

  const slots = freeSlots(state);
  if (slots === 0) {
    return outcome;
  }

  const toPromote = eligibleWaitlisted(state).slice(0, slots);
  if (toPromote.length === 0) {
    return outcome;
  }

  const ids = toPromote.map((row) => row.id);
  await tx
    .update(registrations)
    .set({ status: "registered" })
    .where(and(inArray(registrations.id, ids), eq(registrations.status, "waitlist")));

  for (const row of toPromote) {
    row.status = "registered";
    result.promotedRegistrationIds.push(row.id);
    result.promotedPlayerIds.push(row.playerId);
  }

  outcome.claimedNotificationRegistrationIds = await claimPromotionNotificationsWithinLock(
    tx,
    toPromote
  );

  return outcome;
}

// The canonical reconciler: fills every currently-free seat from the
// waitlist (FIFO) while Late Registration is open. Idempotent -- a second
// call with no state change in between promotes nothing. Safe to call
// frequently (the GS poller calls it once per tournament per tick, and
// every elimination/cancellation/removal calls it after its own write).
export async function reconcileTournamentWaitlistCapacity(
  tournamentId: string
): Promise<WaitlistReconciliationResult> {
  assertPostgresMode();

  const outcome = await db.transaction(async (rawTx): Promise<PromotionOutcome> => {
    const tx = rawTx as unknown as Executor;
    const tournament = await lockTournamentRow(tx, tournamentId);
    if (!tournament) {
      // Deleted concurrently (registrations cascade with it) -- nothing to
      // reconcile.
      return {
        result: { promotedRegistrationIds: [], promotedPlayerIds: [] },
        claimedNotificationRegistrationIds: [],
      };
    }

    const state = await readCapacityState(tx, tournamentId, tournament.maxPlayers);
    return promoteWithinLock(tx, state);
  });

  // Committed -- only now, best-effort, never throws.
  await dispatchWaitlistPromotionNotifications(
    tournamentId,
    outcome.claimedNotificationRegistrationIds
  );
  return outcome.result;
}

function toRegistration(
  tournamentId: string,
  row: TournamentRegistrationState
): Registration {
  return {
    id: row.id,
    player_id: row.playerId,
    tournament_id: tournamentId,
    status: row.status as RegistrationStatus,
    created_at: row.createdAt.toISOString(),
  };
}

// A new entrant's registered-vs-waitlist decision (self-registration and the
// admin "add existing player" action), made and written under the
// tournament-row lock so two simultaneous entrants can never both take the
// last seat. Callers do their own policy checks first (is_final, blocked
// player, "already participated", ...); this re-reads the player's row
// inside the lock and acts on THAT, so a racing duplicate call can't create
// a second row:
//   - registered/attended row => returned unchanged (no capacity change);
//   - waitlist row            => returned AFTER reconciliation, so a player
//                                re-registering while a seat is free and
//                                they're first in line comes back registered
//                                (still `waitlist` if others are ahead);
//   - cancelled row / no row  => reactivated / created as `registered` iff a
//                                seat is free and no ELIGIBLE player is
//                                already waiting ahead of them (FIFO -- a
//                                newcomer never jumps the queue; a
//                                restricted waitlist row never blocks
//                                anyone), otherwise `waitlist`.
//
// NO-SHOW POLICY: if the entrant's players.online_registration_restricted_at
// is set, a NEW or REACTIVATED row is always `waitlist`, regardless of free
// capacity (even at 0/40) -- a restricted player never takes a guaranteed
// seat through this path; their seat is confirmed only by staff
// "Допустить в игру" when they are physically in the club. An
// already-registered row is returned untouched (never removed -- they may
// still cancel it normally); an already-waitlisted restricted row stays
// waitlisted (the reconciler skips it). This applies to self-registration
// (registerPlayerForTournament) and to the admin "add existing player"
// path alike -- EXCEPT on a Final Month (is_final) tournament, whose
// invite/admin-curated composition is never affected by this policy. When
// the rule applies, the returned registration carries
// `online_registration_restricted: true` so the player UI can explain the
// waitlist outcome (absent otherwise -- unrestricted results are unchanged).
export type AdmittedRegistration = Registration & { online_registration_restricted?: true };

export async function admitPlayerToTournament(
  tournamentId: string,
  playerId: string
): Promise<AdmittedRegistration> {
  assertPostgresMode();

  const outcome = await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Executor;
    const tournament = await lockTournamentRow(tx, tournamentId);
    if (!tournament) {
      throw new TournamentNotFoundError(tournamentId);
    }

    const state = await readCapacityState(tx, tournamentId, tournament.maxPlayers);
    const promotion = await promoteWithinLock(tx, state);
    const claimed = promotion.claimedNotificationRegistrationIds;

    const entrantRestricted =
      (await readRestrictedPlayerIds(tx, [playerId])).has(playerId) &&
      !(await isFinalTournament(tx, tournamentId));
    const withPolicy = (registration: Registration): AdmittedRegistration =>
      entrantRestricted ? { ...registration, online_registration_restricted: true } : registration;

    // (player_id, tournament_id) is unique -- at most one row.
    const existing = state.registrations.find((row) => row.playerId === playerId);

    if (existing && existing.status !== "cancelled") {
      return { registration: withPolicy(toRegistration(tournamentId, existing)), claimed };
    }

    // A cancelled row that still carries THIS tournament's no_show_at (the
    // player cancelled -- or staff "Удалить"-ed -- their quarantined
    // no-show row) is reactivated back INTO quarantine: always `waitlist`,
    // no_show_at kept (it is history), never auto-promoted. Cancelling and
    // re-registering must not be a way around the no-show quarantine, even
    // after the global restriction was lifted. Staff "Допустить в игру"
    // remains the only way in for this tournament.
    const reactivatingNoShow = existing != null && existing.noShowAt != null;
    const nextStatus: RegistrationStatus =
      !entrantRestricted &&
      !reactivatingNoShow &&
      freeSlots(state) > 0 &&
      eligibleWaitlisted(state).length === 0
        ? "registered"
        : "waitlist";

    if (existing) {
      await tx
        .update(registrations)
        .set({ status: nextStatus })
        .where(eq(registrations.id, existing.id));
      existing.status = nextStatus;
      return { registration: withPolicy(toRegistration(tournamentId, existing)), claimed };
    }

    const [created] = await tx
      .insert(registrations)
      .values({ playerId, tournamentId, status: nextStatus })
      .returning();
    if (!created) {
      throw new Error("Failed to create registration: no rows returned");
    }
    return {
      registration: withPolicy(
        toRegistration(tournamentId, {
          id: created.id,
          playerId: created.playerId,
          status: created.status,
          createdAt: created.createdAt,
        })
      ),
      claimed,
    };
  });

  await dispatchWaitlistPromotionNotifications(tournamentId, outcome.claimed);
  return outcome.registration;
}

// How many seats un-eliminating `playerId` would add: 1 only if they are
// currently eliminated AND hold a seat-consuming registration, else 0 (e.g.
// pull-sheet re-asserting eliminated=false for an already-active player).
function returnToGameSeatDelta(state: CapacityState, playerId: string): number {
  if (!state.eliminatedPlayerIds.has(playerId)) {
    return 0;
  }
  const holdsSeat = state.registrations.some(
    (row) =>
      row.playerId === playerId && (SEAT_CONSUMING_STATUSES as string[]).includes(row.status)
  );
  return holdsSeat ? 1 : 0;
}

function assertSeatForReturn(state: CapacityState, playerId: string) {
  const delta = returnToGameSeatDelta(state, playerId);
  if (delta === 0) {
    return;
  }
  const seatLoad = computeSeatLoad(state.registrations, state.eliminatedPlayerIds);
  if (seatLoad + delta > state.maxPlayers) {
    throw new TournamentSeatUnavailableError();
  }
}

// "Вернуть в игру" / un-elimination: capacity check AND the
// eliminated=false write happen under the same tournament-row lock, so a
// concurrent promotion or registration can't take the seat in between.
// Fails closed with TournamentSeatUnavailableError and changes nothing (no
// write, no side effect on any other player) when there's no free seat.
// Applies whether or not Late Registration is closed -- physical seats are
// physical seats.
export async function unEliminateTournamentPlayerWithinCapacity(
  tournamentId: string,
  playerId: string
): Promise<void> {
  assertPostgresMode();

  await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Executor;
    const tournament = await lockTournamentRow(tx, tournamentId);
    if (!tournament) {
      throw new TournamentNotFoundError(tournamentId);
    }

    const state = await readCapacityState(tx, tournamentId, tournament.maxPlayers);
    assertSeatForReturn(state, playerId);

    const now = new Date();
    await tx
      .insert(tournamentPlayerEliminations)
      .values({ tournamentId, playerId, eliminated: false, eliminatedAt: null, updatedAt: now })
      .onConflictDoUpdate({
        target: [tournamentPlayerEliminations.tournamentId, tournamentPlayerEliminations.playerId],
        set: { eliminated: false, eliminatedAt: null, updatedAt: now },
      });
  });
}

// ADVISORY, lock-free version of the same check, for callers that must
// refuse BEFORE an external side effect they can't roll back (the Google
// Sheets write-through in setTournamentPlayerEliminationThroughSheet). Not a
// substitute for the locked check in unEliminateTournamentPlayerWithinCapacity,
// which remains authoritative.
export async function assertTournamentSeatAvailableForReturn(
  tournamentId: string,
  playerId: string
): Promise<void> {
  assertPostgresMode();

  const [row] = await db
    .select({ maxPlayers: tournaments.maxPlayers })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId));
  if (!row) {
    throw new TournamentNotFoundError(tournamentId);
  }

  const state = await readCapacityState(db, tournamentId, row.maxPlayers);
  assertSeatForReturn(state, playerId);
}

// ---------------------------------------------------------------------------
// No-show waitlist policy: "Не пришёл" / "Допустить в игру" / arrival.
// All three take the SAME tournament-row lock first (lockTournamentRow) and
// use the SAME capacity state/formula as everything above -- there is no
// second lock and no second promotion engine.
// ---------------------------------------------------------------------------

export const ADMISSION_NO_SEAT_MESSAGE = "Свободных мест нет — игрок остаётся в листе ожидания";

// An expected, user-facing rejection of a no-show/admission action (wrong
// state, no seat, ...). Server actions translate it into a returned
// { ok: false, error } so the exact Russian message reaches the admin UI
// (production Server Actions don't forward thrown error messages).
export class TournamentRosterActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TournamentRosterActionError";
  }
}

async function readTournamentMeta(tx: Executor, tournamentId: string) {
  const [row] = await tx
    .select({
      id: tournaments.id,
      maxPlayers: tournaments.maxPlayers,
      status: tournaments.status,
      startAt: tournaments.startAt,
      isFinal: tournaments.isFinal,
    })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId));
  if (!row) {
    throw new TournamentNotFoundError(tournamentId);
  }
  return row;
}

async function isFinalTournament(tx: Executor, tournamentId: string): Promise<boolean> {
  const rows = await tx
    .select({ isFinal: tournaments.isFinal })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId));
  return rows[0]?.isFinal === true;
}

async function isPlayerArrived(tx: Executor, tournamentId: string, playerId: string): Promise<boolean> {
  const rows = await tx
    .select({ playerId: tournamentAttendance.playerId, arrived: tournamentAttendance.arrived })
    .from(tournamentAttendance)
    .where(
      and(eq(tournamentAttendance.tournamentId, tournamentId), eq(tournamentAttendance.playerId, playerId))
    );
  return rows.some((row) => row.playerId === playerId && row.arrived === true);
}

export type NoShowResult = {
  registrationId: string;
  playerId: string;
  promoted: WaitlistReconciliationResult;
};

// "Не пришёл" -- an EXPLICIT admin action only (never inferred, never run
// at completion). Atomically, under the tournament-row lock:
//   1. tournament not completed, not a Final Month (v1: the behavioral
//      restriction doesn't apply to invite-only finals -- the action is
//      unavailable there), start_at already passed;
//   2. THIS registration is currently `registered` and the player is not
//      marked arrived;
//   3. registration registered -> waitlist, no_show_at = now (frees exactly
//      one seat; the row keeps its created_at);
//   4. players.online_registration_restricted_at = now;
//   5. the canonical promotion runs on the post-no-show state -- the freed
//      seat can go to the next ELIGIBLE waitlisted player; the no-show
//      row is quarantined by its own no_show_at, so it can never
//      auto-promote straight back -- not even if the player's global
//      restriction is lifted later.
export async function markRegistrationNoShowWithinCapacity(
  tournamentId: string,
  registrationId: string
): Promise<NoShowResult> {
  assertPostgresMode();

  const outcome = await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Executor;
    const locked = await lockTournamentRow(tx, tournamentId);
    if (!locked) {
      throw new TournamentNotFoundError(tournamentId);
    }

    const tournament = await readTournamentMeta(tx, tournamentId);
    const now = new Date();
    if (tournament.status === "completed") {
      throw new TournamentRosterActionError("Турнир уже завершён — изменить состав нельзя");
    }
    if (tournament.isFinal) {
      throw new TournamentRosterActionError("«Не пришёл» недоступно для Финала месяца");
    }
    if (new Date(tournament.startAt).getTime() > now.getTime()) {
      throw new TournamentRosterActionError(
        "Турнир ещё не начался — отметить «Не пришёл» можно после старта"
      );
    }

    const state = await readCapacityState(tx, tournamentId, locked.maxPlayers);
    const registration = state.registrations.find((row) => row.id === registrationId);
    if (!registration) {
      throw new TournamentRosterActionError("Регистрация не найдена в этом турнире");
    }
    if (registration.status !== "registered") {
      throw new TournamentRosterActionError(
        "«Не пришёл» можно отметить только для игрока из основной регистрации"
      );
    }
    if (await isPlayerArrived(tx, tournamentId, registration.playerId)) {
      throw new TournamentRosterActionError("Игрок уже отмечен как пришедший");
    }

    await tx
      .update(registrations)
      .set({ status: "waitlist", noShowAt: now })
      .where(and(eq(registrations.id, registration.id), eq(registrations.status, "registered")));
    await tx
      .update(players)
      .set({ onlineRegistrationRestrictedAt: now })
      .where(eq(players.id, registration.playerId));

    registration.status = "waitlist";
    registration.noShowAt = now;
    state.restrictedPlayerIds.add(registration.playerId);

    const promotion = await promoteWithinLock(tx, state);
    return { registration, promotion };
  });

  await dispatchWaitlistPromotionNotifications(
    tournamentId,
    outcome.promotion.claimedNotificationRegistrationIds
  );

  return {
    registrationId: outcome.registration.id,
    playerId: outcome.registration.playerId,
    promoted: outcome.promotion.result,
  };
}

export type AdmissionResult = {
  registrationId: string;
  playerId: string;
};

// "Допустить в игру" -- staff confirms a PHYSICALLY PRESENT waitlisted
// player. Atomically, under the tournament-row lock:
//   1. tournament not completed;
//   2. THIS registration is currently `waitlist`;
//   3. Late Registration still open -- the SAME canonical check the
//      reconciler uses (no tournament_late_registration snapshot row);
//   4. a real free seat exists (same computeSeatLoad formula), else
//      ADMISSION_NO_SEAT_MESSAGE and NOTHING changes;
//   5. waitlist -> registered, this registration's no_show_at cleared (they
//      did show up for THIS tournament; no_show_at on other registrations
//      is never touched), tournament_attendance.arrived = true, and the
//      player's online_registration_restricted_at cleared.
//
// STAFF IN-PERSON OVERRIDE vs FIFO -- intentional, explicit exception:
// this deliberately does NOT run automatic promotion first. If it did, an
// unrelated remote waitlisted player with an older created_at could take
// the free seat a moment before the person standing at the desk is
// admitted. The SELECTED registration gets the seat even if someone older
// is waiting. Automatic promotion everywhere else stays strict FIFO among
// eligible players; max_players is still never exceeded.
export async function admitWaitlistedRegistrationWithinCapacity(
  tournamentId: string,
  registrationId: string
): Promise<AdmissionResult> {
  assertPostgresMode();

  const outcome = await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Executor;
    const locked = await lockTournamentRow(tx, tournamentId);
    if (!locked) {
      throw new TournamentNotFoundError(tournamentId);
    }

    const tournament = await readTournamentMeta(tx, tournamentId);
    if (tournament.status === "completed") {
      throw new TournamentRosterActionError("Турнир уже завершён — изменить состав нельзя");
    }

    const state = await readCapacityState(tx, tournamentId, locked.maxPlayers);
    const registration = state.registrations.find((row) => row.id === registrationId);
    if (!registration) {
      throw new TournamentRosterActionError("Регистрация не найдена в этом турнире");
    }
    if (registration.status !== "waitlist") {
      throw new TournamentRosterActionError("Игрок не находится в листе ожидания");
    }
    if (state.lateRegistrationClosed) {
      throw new TournamentRosterActionError(
        "Поздняя регистрация закрыта — допуск из листа ожидания невозможен"
      );
    }
    if (freeSlots(state) === 0) {
      throw new TournamentRosterActionError(ADMISSION_NO_SEAT_MESSAGE);
    }

    const now = new Date();
    await tx
      .update(registrations)
      .set({ status: "registered", noShowAt: null })
      .where(and(eq(registrations.id, registration.id), eq(registrations.status, "waitlist")));
    registration.status = "registered";
    registration.noShowAt = null;

    const claimed = await claimPromotionNotificationsWithinLock(tx, [registration]);

    await tx
      .insert(tournamentAttendance)
      .values({
        tournamentId,
        playerId: registration.playerId,
        arrived: true,
        arrivedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [tournamentAttendance.tournamentId, tournamentAttendance.playerId],
        // Same arrived_at preservation rule as upsertAttendance: keep the
        // first arrival time if one was already recorded.
        set: {
          arrived: true,
          arrivedAt: sql`coalesce(${tournamentAttendance.arrivedAt}, ${now.toISOString()}::timestamptz)`,
          updatedAt: now,
        },
      });

    await tx
      .update(players)
      .set({ onlineRegistrationRestrictedAt: null })
      .where(eq(players.id, registration.playerId));

    return { registration, claimed };
  });

  await dispatchWaitlistPromotionNotifications(tournamentId, outcome.claimed);

  return { registrationId: outcome.registration.id, playerId: outcome.registration.playerId };
}

// Confirmed physical attendance clears the online-registration restriction
// -- called by features/tournaments.ts::setTournamentPlayerAttendance (the
// ONE canonical attendance setter, shared by the admin UI route AND the
// Google Sheets live sync / pull-sheet) after it writes arrived=true.
// Rules:
//   - only ever CLEARS; arrived=false never reaches this and nothing here
//     can create/restore a restriction;
//   - only when THIS tournament's registration holds a seat
//     (registered/attended) -- a waitlist row's arrival never stands in for
//     admission ("Допустить в игру" is the only way in from the waitlist);
//   - never touches registrations.no_show_at (no-show history on other
//     tournaments stays intact).
// Under the tournament-row lock, so it serializes against a concurrent
// "Не пришёл" on the same tournament. A cheap lock-free pre-check skips
// the lock entirely in the common case (player not restricted). No-op
// outside DATABASE_PROVIDER=postgres (a restriction can only exist there).
export async function clearOnlineRegistrationRestrictionOnArrival(
  tournamentId: string,
  playerId: string
): Promise<boolean> {
  if (process.env.DATABASE_PROVIDER !== "postgres") {
    return false;
  }

  const preCheck = await readRestrictedPlayerIds(db, [playerId]);
  if (!preCheck.has(playerId)) {
    return false;
  }

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Executor;
    const locked = await lockTournamentRow(tx, tournamentId);
    if (!locked) {
      return false;
    }

    const regRows = await tx
      .select({ playerId: registrations.playerId, status: registrations.status })
      .from(registrations)
      .where(and(eq(registrations.tournamentId, tournamentId), eq(registrations.playerId, playerId)));
    const holdsSeat = regRows.some(
      (row) => row.playerId === playerId && (SEAT_CONSUMING_STATUSES as string[]).includes(row.status)
    );
    if (!holdsSeat) {
      return false;
    }
    if (!(await isPlayerArrived(tx, tournamentId, playerId))) {
      return false;
    }

    await tx
      .update(players)
      .set({ onlineRegistrationRestrictedAt: null })
      .where(eq(players.id, playerId));
    return true;
  });
}
