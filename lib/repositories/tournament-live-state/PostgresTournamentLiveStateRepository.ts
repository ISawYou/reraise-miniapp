import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { players, registrations, tournamentLiveEntries, tournamentPlayerEliminations } from "@/lib/db/schema";
import type {
  TournamentLiveStateRepository,
  LiveEntryInsert,
  LiveEntryPatch,
  LiveEntryWithDetailsRow,
  EliminationStatus,
  EliminationUpsert,
} from "./TournamentLiveStateRepository";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Drizzle/Postgres counterpart of SupabaseTournamentLiveStateRepository --
// same contract, no new behavior. Compensations: `.limit(1)` +
// array-destructure standing in for `.maybeSingle()`, timestamp columns
// converted to ISO strings, and the embedded Supabase joins
// (`registrations (status)`, `players (...)`) replaced with plain Drizzle
// leftJoin + a nested-object select -- no flattenEmbedded-style helper
// needed, since Drizzle's own mapResultRow already collapses an all-null
// outer-join match to a bare `null` for the whole nested key (confirmed
// while implementing Registration/Result).
export class PostgresTournamentLiveStateRepository implements TournamentLiveStateRepository {
  async findPlayerIdsWithLiveEntry(tournamentId: string): Promise<string[]> {
    const rows = await db
      .select({ player_id: tournamentLiveEntries.playerId })
      .from(tournamentLiveEntries)
      .where(eq(tournamentLiveEntries.tournamentId, tournamentId));
    return rows.map((row) => row.player_id);
  }

  async insertLiveEntries(rows: LiveEntryInsert[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await db.insert(tournamentLiveEntries).values(
      rows.map((row) => ({
        tournamentId: row.tournament_id,
        playerId: row.player_id,
        registrationId: row.registration_id,
        arrived: row.arrived,
        rebuys: row.rebuys,
        addons: row.addons,
        knockouts: row.knockouts,
        place: row.place,
      }))
    );
  }

  async findLiveEntriesWithDetails(tournamentId: string): Promise<LiveEntryWithDetailsRow[]> {
    return db
      .select({
        id: tournamentLiveEntries.id,
        tournament_id: tournamentLiveEntries.tournamentId,
        registration_id: tournamentLiveEntries.registrationId,
        player_id: tournamentLiveEntries.playerId,
        arrived: tournamentLiveEntries.arrived,
        rebuys: tournamentLiveEntries.rebuys,
        addons: tournamentLiveEntries.addons,
        knockouts: tournamentLiveEntries.knockouts,
        place: tournamentLiveEntries.place,
        sheet_row_number: tournamentLiveEntries.sheetRowNumber,
        registrations: {
          status: registrations.status,
        },
        players: {
          username: players.username,
          admin_display_name: players.adminDisplayName,
          display_name: players.displayName,
        },
      })
      .from(tournamentLiveEntries)
      .leftJoin(registrations, eq(tournamentLiveEntries.registrationId, registrations.id))
      .leftJoin(players, eq(tournamentLiveEntries.playerId, players.id))
      .where(eq(tournamentLiveEntries.tournamentId, tournamentId))
      .orderBy(asc(tournamentLiveEntries.createdAt));
  }

  async updateLiveEntry(tournamentId: string, playerId: string, patch: LiveEntryPatch): Promise<void> {
    await db
      .update(tournamentLiveEntries)
      .set({
        arrived: patch.arrived,
        rebuys: patch.rebuys,
        addons: patch.addons,
        knockouts: patch.knockouts,
        place: patch.place,
        updatedAt: new Date(patch.updated_at),
        ...(patch.sheet_row_number !== undefined ? { sheetRowNumber: patch.sheet_row_number } : {}),
      })
      .where(
        and(eq(tournamentLiveEntries.tournamentId, tournamentId), eq(tournamentLiveEntries.playerId, playerId))
      );
  }

  async deleteLiveEntriesByPlayerId(playerId: string): Promise<void> {
    try {
      await db.delete(tournamentLiveEntries).where(eq(tournamentLiveEntries.playerId, playerId));
    } catch (err) {
      throw new Error(`Ошибка удаления live-записей: ${errorMessage(err)}`);
    }
  }

  async findEliminationsByTournamentId(tournamentId: string): Promise<Map<string, EliminationStatus>> {
    const rows = await db
      .select({
        player_id: tournamentPlayerEliminations.playerId,
        eliminated: tournamentPlayerEliminations.eliminated,
        eliminated_at: tournamentPlayerEliminations.eliminatedAt,
      })
      .from(tournamentPlayerEliminations)
      .where(eq(tournamentPlayerEliminations.tournamentId, tournamentId));

    return new Map(
      rows.map((row) => [
        row.player_id,
        {
          eliminated: row.eliminated,
          eliminated_at: row.eliminated_at ? row.eliminated_at.toISOString() : null,
        },
      ])
    );
  }

  async findEliminatedAtByTournamentAndPlayer(
    tournamentId: string,
    playerId: string
  ): Promise<string | null> {
    const rows = await db
      .select({ eliminated_at: tournamentPlayerEliminations.eliminatedAt })
      .from(tournamentPlayerEliminations)
      .where(
        and(
          eq(tournamentPlayerEliminations.tournamentId, tournamentId),
          eq(tournamentPlayerEliminations.playerId, playerId)
        )
      )
      .limit(1);
    const [row] = rows;
    return row?.eliminated_at ? row.eliminated_at.toISOString() : null;
  }

  async upsertElimination(row: EliminationUpsert): Promise<void> {
    await db
      .insert(tournamentPlayerEliminations)
      .values({
        tournamentId: row.tournament_id,
        playerId: row.player_id,
        eliminated: row.eliminated,
        eliminatedAt: row.eliminated_at ? new Date(row.eliminated_at) : null,
        updatedAt: new Date(row.updated_at),
      })
      .onConflictDoUpdate({
        target: [tournamentPlayerEliminations.tournamentId, tournamentPlayerEliminations.playerId],
        set: {
          eliminated: sql`excluded.eliminated`,
          eliminatedAt: sql`excluded.eliminated_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}
