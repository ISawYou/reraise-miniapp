"use server";

import { eq } from "drizzle-orm";
import {
  tournamentLateRegistrationRepository,
  tournamentLiveStateRepository,
  tournamentRepository,
} from "@/lib/repositories";
import { db } from "@/lib/db";
import { tournamentLateRegistration, tournamentMysteryBounty } from "@/lib/db/schema";
import { lockTournamentRow, type Executor } from "@/features/tournament-row-lock";
import { calculateRatingPlaceStructureForTournament } from "@/features/rating-v2";
import { PARTICIPATION_POINTS } from "@/features/rating";
import { isRatingEligibleTournament } from "@/lib/tournament-helpers";
import {
  buildMysteryBountyInsertValues,
  getMysteryBountySnapshot,
  mapMysteryBountyDrizzleRow,
} from "@/features/mystery-bounty";
import { TournamentNotFoundError } from "@/lib/tournament-errors";
import type {
  MysteryBountySnapshot,
  Tournament,
  TournamentLateRegistrationSnapshot,
} from "@/types/domain";

// Closing Late Registration needs the SAME tournament-row lock as
// features/tournament-waitlist-capacity.ts -- see
// features/tournament-row-lock.ts's doc comment for why: without it, a
// waitlist promotion decided just before this snapshot is created could
// still commit just after it, letting a promotion cross the official
// closing boundary. This module is therefore Postgres-only for the actual
// close, same precedent as lib/player-merge.ts and
// tournament-waitlist-capacity.ts.
// Not exported -- see features/mystery-bounty.ts's mapMysteryBountyDrizzleRow
// comment: a "use server" file's top-level exports must all be async
// functions (Next.js Server Actions convention), so this stays internal.
class LateRegistrationCloseUnavailableError extends Error {
  constructor() {
    super("Closing Late Registration requires DATABASE_PROVIDER=postgres");
    this.name = "LateRegistrationCloseUnavailableError";
  }
}

function assertPostgresModeForClose() {
  if (process.env.DATABASE_PROVIDER !== "postgres") {
    throw new LateRegistrationCloseUnavailableError();
  }
}

function mapLateRegistrationRow(
  row: typeof tournamentLateRegistration.$inferSelect
): TournamentLateRegistrationSnapshot {
  return {
    tournament_id: row.tournamentId,
    arrived_players_count: row.arrivedPlayersCount,
    initial_stacks_count: row.initialStacksCount,
    total_entries_count: row.totalEntriesCount,
    rebuys_count: row.rebuysCount,
    addons_count: row.addonsCount,
    tournament_type: row.tournamentType as TournamentLateRegistrationSnapshot["tournament_type"],
    rating_formula_version:
      row.ratingFormulaVersion as TournamentLateRegistrationSnapshot["rating_formula_version"],
    rating_guarantee: row.ratingGuarantee,
    rating_places: row.ratingPlaces,
    closed_at: row.closedAt.toISOString(),
  };
}

export type AuthoritativeLateRegistrationRow = {
  player_id: string;
  arrived: true;
  rebuys: number;
  addons: number;
};

async function findTournament(tournamentId: string): Promise<Tournament> {
  try {
    return await tournamentRepository.findById(tournamentId);
  } catch {
    throw new TournamentNotFoundError(tournamentId);
  }
}

function assertFreeTournament(tournament: Tournament) {
  if (tournament.kind !== "free") {
    throw new Error("Late Registration snapshot поддерживается только для рейтинговых free-турниров");
  }
}

export async function getAuthoritativeLateRegistrationRows(
  tournamentId: string
): Promise<AuthoritativeLateRegistrationRow[]> {
  const [attendedRows, rebuyState] = await Promise.all([
    tournamentLiveStateRepository.findAttendedPlayersWithDetails(tournamentId),
    tournamentLiveStateRepository.findRebuyStateByTournamentId(tournamentId),
  ]);

  return attendedRows.map((row) => ({
    player_id: row.player_id,
    arrived: true,
    rebuys: rebuyState.get(row.player_id)?.rebuys ?? 0,
    addons: rebuyState.get(row.player_id)?.addons ?? 0,
  }));
}

export async function getTournamentLateRegistrationSnapshot(
  tournamentId: string
): Promise<TournamentLateRegistrationSnapshot | null> {
  return tournamentLateRegistrationRepository.findByTournamentId(tournamentId);
}

// Builds (or returns the already-existing) generic snapshot, ASSUMING the
// tournament-row lock is already held by the caller's transaction and
// `rows` was already read under that same lock. Shared by
// closeTournamentLateRegistration (which reads the lock+rows itself) and
// closeTournamentLateRegistrationOperation's Mystery-aware path (which
// reads them once and reuses them for BOTH the Mystery and generic
// snapshots) -- one locked critical section, one authoritative read,
// never two independent lock acquisitions for a single logical close.
async function closeGenericSnapshotLocked(
  tx: Executor,
  tournamentId: string,
  tournament: Tournament,
  rows: AuthoritativeLateRegistrationRow[]
): Promise<TournamentLateRegistrationSnapshot> {
  const [existingRow] = await tx
    .select()
    .from(tournamentLateRegistration)
    .where(eq(tournamentLateRegistration.tournamentId, tournamentId))
    .limit(1);
  if (existingRow) {
    return mapLateRegistrationRow(existingRow);
  }

  if (rows.length === 0) {
    throw new Error("Нельзя закрыть позднюю регистрацию: нет игроков с отметкой «Пришёл»");
  }

  const ratingPlaces = calculateRatingPlaceStructureForTournament(
    rows.map((row) => ({ entries: row.rebuys, addons: row.addons })),
    tournament.tournament_type,
    tournament.rating_formula_version,
    {
      ratingGuarantee: tournament.rating_guarantee,
      // Boost is frozen INTO rating_places here; completion never re-boosts.
      placementPointsMultiplier: tournament.placement_points_multiplier,
    },
    isRatingEligibleTournament(tournament)
  );

  const initialStacksCount = rows.filter((row) => row.rebuys >= 1).length;
  const totalEntriesCount = rows.reduce((sum, row) => sum + row.rebuys, 0);
  const rebuysCount = rows.reduce((sum, row) => sum + Math.max(row.rebuys - 1, 0), 0);
  const addonsCount = rows.reduce((sum, row) => sum + row.addons, 0);

  const [inserted] = await tx
    .insert(tournamentLateRegistration)
    .values({
      tournamentId,
      arrivedPlayersCount: rows.length,
      initialStacksCount,
      totalEntriesCount,
      rebuysCount,
      addonsCount,
      tournamentType: tournament.tournament_type,
      ratingFormulaVersion: tournament.rating_formula_version,
      ratingGuarantee: tournament.rating_guarantee,
      ratingPlaces,
    })
    // Defensive only -- the lock above already makes a true concurrent
    // insert here impossible, but this keeps the same insert-once
    // backstop the repository's own insertIfAbsent had.
    .onConflictDoNothing({ target: tournamentLateRegistration.tournamentId })
    .returning();

  if (inserted) {
    return mapLateRegistrationRow(inserted);
  }

  const [fallback] = await tx
    .select()
    .from(tournamentLateRegistration)
    .where(eq(tournamentLateRegistration.tournamentId, tournamentId))
    .limit(1);
  if (!fallback) {
    throw new Error("Failed to close Late Registration: snapshot was not returned");
  }
  return mapLateRegistrationRow(fallback);
}

export async function closeTournamentLateRegistration(
  tournamentId: string
): Promise<TournamentLateRegistrationSnapshot> {
  const tournament = await findTournament(tournamentId);
  assertFreeTournament(tournament);

  // Cheap pre-check outside the lock -- an already-closed tournament (the
  // overwhelmingly common repeat-call case) returns immediately without
  // ever taking the lock. The lock-protected re-check below is what's
  // actually authoritative; this is purely an optimization.
  const existing = await tournamentLateRegistrationRepository.findByTournamentId(tournamentId);
  if (existing) return existing;

  if (tournament.status === "completed") {
    throw new Error("Турнир уже завершён — позднюю регистрацию закрыть нельзя");
  }

  assertPostgresModeForClose();

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Executor;

    // Tournament-row lock FIRST -- see features/tournament-row-lock.ts.
    // This serializes against reconcileTournamentWaitlistCapacity's own
    // lock on the SAME row: whichever side gets here first runs to
    // completion (promotion, or this snapshot insert) before the other
    // even reads whether a snapshot exists.
    const locked = await lockTournamentRow(tx, tournamentId);
    if (!locked) {
      throw new TournamentNotFoundError(tournamentId);
    }

    // Reads the CURRENT (post-any-promotion-that-already-committed)
    // attendance/rebuy state -- if a waitlist promotion won the lock first,
    // it already committed and released the lock before we got here, so
    // this read sees that promoted player as part of the field, and the
    // resulting snapshot correctly reflects the post-promotion reality.
    const rows = await getAuthoritativeLateRegistrationRows(tournamentId);
    return closeGenericSnapshotLocked(tx, tournamentId, tournament, rows);
  });
}

// One UI operation for Mystery Bounty, now running Mystery's envelope
// snapshot AND the generic snapshot inside ONE transaction, under ONE
// tournament-row lock (see features/tournament-row-lock.ts) -- NOT the
// old two-sequential-calls shape (Mystery close, then a SEPARATE call to
// closeTournamentLateRegistration that took its own, later lock). That
// older shape had a real gap: Mystery's roster read was not lock-protected
// against a concurrent waitlist promotion, so Mystery's snapshot and the
// generic snapshot could end up frozen from two DIFFERENT roster states if
// a promotion landed between them. With one lock held for the whole
// operation, no capacity-affecting transaction (promotion, new admission,
// un-elimination) can commit between Mystery's roster read and the
// generic snapshot's insert -- both are built from exactly the same locked
// read. No nested db.transaction: this uses the SAME `tx` for every read
// and write below. Retry/idempotency is unchanged: a fully-closed
// tournament short-circuits before the lock; a historical partial state
// (Mystery exists, generic doesn't -- the one documented recoverable gap)
// is detected under the lock and only the missing generic snapshot is
// created, reusing the existing Mystery row untouched.
export async function closeTournamentLateRegistrationOperation(
  tournamentId: string
): Promise<{
  snapshot: TournamentLateRegistrationSnapshot;
  mysteryBountySnapshot: MysteryBountySnapshot | null;
}> {
  const tournament = await findTournament(tournamentId);
  assertFreeTournament(tournament);

  // Cheap pre-check outside the lock, mirroring closeTournamentLateRegistration's
  // own fast path: the overwhelmingly common "already fully closed" repeat
  // call returns immediately without ever taking the lock.
  const existingGeneric = await tournamentLateRegistrationRepository.findByTournamentId(tournamentId);
  if (existingGeneric) {
    const existingMystery =
      tournament.tournament_type === "mystery_bounty"
        ? await getMysteryBountySnapshot(tournamentId)
        : null;
    return { snapshot: existingGeneric, mysteryBountySnapshot: existingMystery };
  }

  if (tournament.status === "completed") {
    throw new Error("Турнир уже завершён — позднюю регистрацию закрыть нельзя");
  }

  assertPostgresModeForClose();

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Executor;

    // ONE lock covers BOTH snapshots. Whichever side -- this close, or a
    // concurrent waitlist promotion -- acquires it first runs fully to
    // completion before the other even reads tournament_late_registration/
    // tournament_mystery_bounty, so there is never a window in which one
    // snapshot could be built from a different roster state than the
    // other.
    const locked = await lockTournamentRow(tx, tournamentId);
    if (!locked) {
      throw new TournamentNotFoundError(tournamentId);
    }

    const [existingGenericRow] = await tx
      .select()
      .from(tournamentLateRegistration)
      .where(eq(tournamentLateRegistration.tournamentId, tournamentId))
      .limit(1);

    let mysteryBountySnapshot: MysteryBountySnapshot | null = null;
    if (tournament.tournament_type === "mystery_bounty") {
      const [existingMysteryRow] = await tx
        .select()
        .from(tournamentMysteryBounty)
        .where(eq(tournamentMysteryBounty.tournamentId, tournamentId))
        .limit(1);

      if (existingMysteryRow) {
        // Historical partial-close recovery: Mystery's envelope snapshot
        // already exists (from an earlier attempt whose generic step
        // failed) -- reused byte-for-byte, never recomputed/overwritten.
        mysteryBountySnapshot = await mapMysteryBountyDrizzleRow(existingMysteryRow);
      } else if (existingGenericRow) {
        // Not reachable via this function in ordinary operation (Mystery
        // is always created before the generic snapshot below) -- fail
        // loudly rather than silently fabricate a Mystery snapshot against
        // a roster the generic snapshot may have already moved past.
        throw new Error(
          "Mystery Bounty снимок отсутствует, хотя общая Late Registration уже закрыта — требуется ручная проверка"
        );
      } else {
        // Fresh close: ONE authoritative read, under the lock, reused for
        // BOTH Mystery's envelope math and the generic snapshot below.
        const rows = await getAuthoritativeLateRegistrationRows(tournamentId);
        const insertValues = await buildMysteryBountyInsertValues(
          tournamentId,
          rows,
          tournament.rating_formula_version
        );

        const [insertedMystery] = await tx
          .insert(tournamentMysteryBounty)
          .values({
            tournamentId,
            status: insertValues.status,
            playersCount: insertValues.players_count,
            totalEntriesCount: insertValues.total_entries_count,
            rebuysCount: insertValues.rebuys_count,
            addonsCount: insertValues.addons_count,
            activePlayersCount: insertValues.active_players_count,
            mysteryPool: insertValues.mystery_pool,
            envelopeCount: insertValues.envelope_count,
            smallCount: insertValues.small_count,
            smallValue: insertValues.small_value,
            mediumCount: insertValues.medium_count,
            mediumValue: insertValues.medium_value,
            jackpotValue: insertValues.jackpot_value,
          })
          // Defensive only -- the lock already makes a true concurrent
          // insert here impossible.
          .onConflictDoNothing({ target: tournamentMysteryBounty.tournamentId })
          .returning();

        if (insertedMystery) {
          mysteryBountySnapshot = await mapMysteryBountyDrizzleRow(insertedMystery);
        } else {
          const [fallbackMystery] = await tx
            .select()
            .from(tournamentMysteryBounty)
            .where(eq(tournamentMysteryBounty.tournamentId, tournamentId))
            .limit(1);
          if (!fallbackMystery) {
            throw new Error("Failed to close Mystery Bounty: snapshot was not returned");
          }
          mysteryBountySnapshot = await mapMysteryBountyDrizzleRow(fallbackMystery);
        }

        // Same locked `rows` read above, reused here -- NOT a second
        // roster read, so there is no window for the two snapshots to
        // diverge.
        const snapshot = await closeGenericSnapshotLocked(tx, tournamentId, tournament, rows);
        return { snapshot, mysteryBountySnapshot };
      }
    }

    // Reached only for a non-Mystery tournament, or a Mystery tournament
    // whose envelope snapshot already existed above (recovery path) --
    // the fresh-Mystery-close branch above already built and returned the
    // generic snapshot itself, reusing its own locked roster read.
    // closeGenericSnapshotLocked re-checks `existingGenericRow` itself
    // under the same lock, so it's always safe to call unconditionally
    // here even though we already peeked at it.
    const rows = await getAuthoritativeLateRegistrationRows(tournamentId);
    const snapshot = await closeGenericSnapshotLocked(tx, tournamentId, tournament, rows);

    return { snapshot, mysteryBountySnapshot };
  });
}

// `snapshot.rating_places[].points` is deliberately itm_points-only (see
// calculateRatingPlaceStructureForTournament in features/rating-v2.ts) --
// that's the shape tournament completion needs, since it re-adds
// participation/knockout/boss/mystery fresh from live per-player data and
// would double-count participation if the frozen snapshot already included
// it (app/api/admin/tournaments/[id]/complete-free/route.ts's `ratingPlaces`
// option). The live Poker Clock projection has no such merge step, so it
// must fold the same canonical PARTICIPATION_POINTS constant back in here
// -- every arrived player earns it regardless of place, so it belongs on
// every row. `snapshot.rating_places` itself (and what completion reads)
// stays untouched; only this response copy is adjusted.
export async function getTournamentStateForIntegration(tournamentId: string) {
  const tournament = await findTournament(tournamentId);
  assertFreeTournament(tournament);
  const snapshot = await getTournamentLateRegistrationSnapshot(tournamentId);

  // A championship (is_final) has no rating places or participation reward
  // to preview, regardless of what the frozen snapshot's rating_places
  // happen to contain (they're already zeroed by
  // calculateRatingPlaceStructureForTournament's ratingEligible=false path
  // above, but +PARTICIPATION_POINTS below is a flat addition outside that
  // calculator -- it must be gated here explicitly, not just rely on the
  // snapshot already being zero). lateRegistration status itself is an
  // operational concept, not a rating one, so it still reports normally.
  if (!isRatingEligibleTournament(tournament)) {
    return snapshot
      ? { lateRegistration: { status: "closed" as const, closedAt: snapshot.closed_at }, rating: null }
      : { lateRegistration: { status: "open" as const, closedAt: null }, rating: null };
  }

  return snapshot
    ? {
        lateRegistration: { status: "closed" as const, closedAt: snapshot.closed_at },
        rating: {
          places: snapshot.rating_places.map((entry) => ({
            place: entry.place,
            points: entry.points + PARTICIPATION_POINTS,
          })),
        },
      }
    : {
        lateRegistration: { status: "open" as const, closedAt: null },
        rating: null,
      };
}
