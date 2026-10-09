import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { registrations, results, tournaments } from "@/lib/db/schema";
import type { Executor } from "@/features/tournament-row-lock";
import type { ResultInsert } from "@/lib/repositories/result/ResultRepository";
import {
  TournamentAlreadyCompletedError,
  TournamentCompletionUnavailableError,
  TournamentNotFoundError,
} from "@/lib/tournament-errors";

// The locked DB-mutation tail shared by BOTH tournament completion paths
// (features/tournaments.ts::saveTournamentResults -- complete-free -- and
// ::completeTournamentFromLiveEntries -- complete-live).
//
// WHY
// ---
// Completion is delete-all-results -> reinsert -> mark attended -> status
// "completed". Without a guard, a second call (double click, second tab, a
// slow request racing a fast one, or a deliberate re-run) would silently
// overwrite results of an ALREADY-completed tournament -- including places
// already fixed through the Super-Admin place correction
// (features/completed-tournament-place-correction.ts). Re-running full
// completion is no longer a supported correction mechanism: it must fail
// closed with zero writes.
//
// CONCURRENCY
// -----------
// Same Postgres-only transactional precedent as lib/player-merge.ts /
// features/tournament-waitlist-capacity.ts /
// features/completed-tournament-place-correction.ts: the tournament row is
// locked FOR UPDATE as the FIRST statement (the shared per-tournament
// serialization point, see features/tournament-row-lock.ts), its status is
// re-read under that lock, and the whole mutation tail -- results delete,
// results insert, registrations attended, tournament status -- runs in the
// SAME transaction while still holding the lock. A concurrent completion
// (or place correction) therefore only reads the row after this one has
// committed, and sees status "completed".
//
// Everything upstream (Google Sheets reads/reconciliation, rating math,
// club-discount resolution, validation) stays OUTSIDE this transaction --
// no lock is ever held across external network IO. Post-commit side effects
// (winner Activity event, achievements, Sheets export, Poker Clock finish)
// stay with the callers and only run after this returns.

function assertPostgresMode() {
  if (process.env.DATABASE_PROVIDER !== "postgres") {
    throw new TournamentCompletionUnavailableError();
  }
}

// Mirrors PostgresRegistrationRepository.markAttendedBulk's call sites in
// both completion paths exactly.
const ATTENDED_FROM_STATUSES = ["registered", "attended"] as const;

export async function commitTournamentCompletion(input: {
  tournamentId: string;
  results: ResultInsert[];
  attendedPlayerIds: string[];
}): Promise<void> {
  const { tournamentId, results: rows, attendedPlayerIds } = input;
  assertPostgresMode();

  await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Executor;

    // FIRST statement: lock the tournament row, then decide under the lock.
    const [locked] = await tx
      .select({ id: tournaments.id, status: tournaments.status })
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .for("update");
    if (!locked) {
      throw new TournamentNotFoundError(tournamentId);
    }
    if (locked.status === "completed") {
      // Nothing written yet -- the transaction rolls back with zero writes.
      throw new TournamentAlreadyCompletedError();
    }

    // Same statements, same values as PostgresResultRepository's
    // deleteByTournamentId + insertMany and
    // PostgresRegistrationRepository.markAttendedBulk +
    // PostgresTournamentRepository.patch -- only now under the lock.
    await tx.delete(results).where(eq(results.tournamentId, tournamentId));

    if (rows.length > 0) {
      await tx.insert(results).values(
        rows.map((row) => ({
          tournamentId: row.tournament_id,
          playerId: row.player_id,
          seasonId: row.season_id,
          place: row.place,
          reentries: row.reentries,
          knockouts: row.knockouts,
          bossKnockouts: row.boss_knockouts ?? 0,
          mysteryBountyPoints: row.mystery_bounty_points ?? 0,
          addons: row.addons ?? 0,
          freeReentries: row.free_reentries ?? 0,
          ratingPoints: row.rating_points,
          arrived: row.arrived ?? null,
          participationPoints: row.participation_points ?? null,
          knockoutPoints: row.knockout_points ?? null,
          bossBountyPoints: row.boss_bounty_points ?? null,
          itmPoints: row.itm_points ?? null,
          clubDiscountPercent: row.club_discount_percent ?? 0,
        }))
      );
    }

    if (attendedPlayerIds.length > 0) {
      await tx
        .update(registrations)
        .set({ status: "attended" })
        .where(
          and(
            eq(registrations.tournamentId, tournamentId),
            inArray(registrations.playerId, attendedPlayerIds),
            inArray(registrations.status, [...ATTENDED_FROM_STATUSES])
          )
        );
    }

    await tx
      .update(tournaments)
      .set({ status: "completed" })
      .where(eq(tournaments.id, tournamentId));
  });
}
