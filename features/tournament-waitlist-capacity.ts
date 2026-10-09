import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  registrations,
  tournamentLateRegistration,
  tournamentPlayerEliminations,
  tournaments,
} from "@/lib/db/schema";
import { lockTournamentRow, type Executor } from "@/features/tournament-row-lock";
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
};

type CapacityState = {
  maxPlayers: number;
  lateRegistrationClosed: boolean;
  registrations: TournamentRegistrationState[];
  eliminatedPlayerIds: Set<string>;
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

  return {
    maxPlayers,
    lateRegistrationClosed: lateRegRows.length > 0,
    registrations: registrationRows,
    eliminatedPlayerIds: new Set(
      eliminationRows.filter((row) => row.eliminated).map((row) => row.playerId)
    ),
  };
}

function freeSlots(state: CapacityState): number {
  return Math.max(
    0,
    state.maxPlayers - computeSeatLoad(state.registrations, state.eliminatedPlayerIds)
  );
}

// Promotes the oldest waitlisted registrations into currently-free seats.
// Mutates `state` in place so a caller in the same transaction (e.g. a new
// entrant's decision) sees the post-promotion state without a re-read.
async function promoteWithinLock(
  tx: Executor,
  state: CapacityState
): Promise<WaitlistReconciliationResult> {
  const result: WaitlistReconciliationResult = {
    promotedRegistrationIds: [],
    promotedPlayerIds: [],
  };

  // Late Registration closed => no new entrants are seated, ever, even if
  // eliminations freed seats.
  if (state.lateRegistrationClosed) {
    return result;
  }

  const slots = freeSlots(state);
  if (slots === 0) {
    return result;
  }

  const toPromote = oldestWaitlisted(state).slice(0, slots);
  if (toPromote.length === 0) {
    return result;
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

  return result;
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

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Executor;
    const tournament = await lockTournamentRow(tx, tournamentId);
    if (!tournament) {
      // Deleted concurrently (registrations cascade with it) -- nothing to
      // reconcile.
      return { promotedRegistrationIds: [], promotedPlayerIds: [] };
    }

    const state = await readCapacityState(tx, tournamentId, tournament.maxPlayers);
    return promoteWithinLock(tx, state);
  });
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
//                                seat is free and nobody is already waiting
//                                ahead of them (FIFO -- a newcomer never
//                                jumps the queue), otherwise `waitlist`.
export async function admitPlayerToTournament(
  tournamentId: string,
  playerId: string
): Promise<Registration> {
  assertPostgresMode();

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Executor;
    const tournament = await lockTournamentRow(tx, tournamentId);
    if (!tournament) {
      throw new TournamentNotFoundError(tournamentId);
    }

    const state = await readCapacityState(tx, tournamentId, tournament.maxPlayers);
    await promoteWithinLock(tx, state);

    // (player_id, tournament_id) is unique -- at most one row.
    const existing = state.registrations.find((row) => row.playerId === playerId);

    if (existing && existing.status !== "cancelled") {
      return toRegistration(tournamentId, existing);
    }

    const nextStatus: RegistrationStatus =
      freeSlots(state) > 0 && oldestWaitlisted(state).length === 0 ? "registered" : "waitlist";

    if (existing) {
      await tx
        .update(registrations)
        .set({ status: nextStatus })
        .where(eq(registrations.id, existing.id));
      existing.status = nextStatus;
      return toRegistration(tournamentId, existing);
    }

    const [created] = await tx
      .insert(registrations)
      .values({ playerId, tournamentId, status: nextStatus })
      .returning();
    if (!created) {
      throw new Error("Failed to create registration: no rows returned");
    }
    return toRegistration(tournamentId, {
      id: created.id,
      playerId: created.playerId,
      status: created.status,
      createdAt: created.createdAt,
    });
  });
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
