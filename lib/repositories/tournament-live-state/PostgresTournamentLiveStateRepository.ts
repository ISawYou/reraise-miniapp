import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  players,
  registrations,
  tournamentAttendance,
  tournamentLiveEntries,
  tournamentPlayerEliminations,
} from "@/lib/db/schema";
import type {
  TournamentLiveStateRepository,
  LiveEntryInsert,
  LiveEntryPatch,
  LiveEntryWithDetailsRow,
  EliminationStatus,
  EliminationUpsert,
  AttendanceStatus,
  AttendanceUpsert,
  AttendanceWriteResult,
  AttendedPlayerRow,
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

    const values = sql.join(
      rows.map((row) => sql`(
        ${row.tournament_id},
        ${row.player_id},
        ${row.registration_id},
        ${row.arrived},
        ${row.rebuys},
        ${row.addons},
        ${row.knockouts},
        ${row.boss_knockouts ?? 0},
        ${row.place}
      )`),
      sql`, `
    );

    await db.execute(sql`
      insert into "tournament_live_entries" (
        "tournament_id",
        "player_id",
        "registration_id",
        "arrived",
        "rebuys",
        "addons",
        "knockouts",
        "boss_knockouts",
        "place"
      )
      values ${values}
    `);
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
        boss_knockouts: sql<number>`coalesce(${sql.raw('"tournament_live_entries"."boss_knockouts"')}, 0)`,
        place: tournamentLiveEntries.place,
        sheet_row_number: tournamentLiveEntries.sheetRowNumber,
        registrations: {
          status: registrations.status,
        },
        players: {
          id: players.id,
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
    if (patch.sheet_row_number === undefined) {
      await db.execute(sql`
        update "tournament_live_entries"
        set
          "arrived" = ${patch.arrived},
          "rebuys" = ${patch.rebuys},
          "addons" = ${patch.addons},
          "knockouts" = ${patch.knockouts},
          "boss_knockouts" = ${patch.boss_knockouts ?? 0},
          "place" = ${patch.place},
          "updated_at" = ${new Date(patch.updated_at)}
        where
          "tournament_id" = ${tournamentId}
          and "player_id" = ${playerId}
      `);
      return;
    }

    await db.execute(sql`
      update "tournament_live_entries"
      set
        "arrived" = ${patch.arrived},
        "rebuys" = ${patch.rebuys},
        "addons" = ${patch.addons},
        "knockouts" = ${patch.knockouts},
        "boss_knockouts" = ${patch.boss_knockouts ?? 0},
        "place" = ${patch.place},
        "updated_at" = ${new Date(patch.updated_at)},
        "sheet_row_number" = ${patch.sheet_row_number}
      where
        "tournament_id" = ${tournamentId}
        and "player_id" = ${playerId}
    `);
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

  async findAttendanceByTournamentId(tournamentId: string): Promise<Map<string, AttendanceStatus>> {
    const rows = await db
      .select({
        player_id: tournamentAttendance.playerId,
        arrived: tournamentAttendance.arrived,
        arrived_at: tournamentAttendance.arrivedAt,
      })
      .from(tournamentAttendance)
      .where(eq(tournamentAttendance.tournamentId, tournamentId));

    return new Map(
      rows.map((row) => [
        row.player_id,
        {
          arrived: row.arrived,
          arrived_at: row.arrived_at ? row.arrived_at.toISOString() : null,
        },
      ])
    );
  }

  // Single atomic statement -- deliberately NOT a separate
  // read-existing-row-then-decide-then-write (that was the original
  // implementation, and the two-round-trip gap between its own read and
  // write is exactly where two concurrent calls could interleave and
  // produce a wrong arrived_at). No client-supplied ordering token is
  // trusted here -- see AttendanceUpsert's doc comment
  // (TournamentLiveStateRepository.ts) for why a client wall-clock value
  // was tried and reverted. `arrived` is unconditionally overwritten
  // (plain last-processed-wins); `arrived_at` is computed in the SAME
  // statement via COALESCE against the row's own current value (stamped
  // once on the first arrived=true write, preserved across every later
  // true/false toggle), so it stays race-free regardless of write
  // ordering. Same-tab click ordering is guaranteed upstream, entirely
  // client-side, by lib/attendance-write-queue.ts -- this method never
  // sees two competing writes from the same browser tab concurrently.
  async upsertAttendance(row: AttendanceUpsert): Promise<AttendanceWriteResult> {
    type UpsertAttendanceRow = {
      arrived: boolean;
      arrived_at: string | Date | null;
    };

    const rows = await db.execute<UpsertAttendanceRow>(sql`
      insert into "tournament_attendance" ("tournament_id", "player_id", "arrived", "arrived_at", "updated_at")
      values (
        ${row.tournament_id},
        ${row.player_id},
        ${row.arrived},
        case when ${row.arrived} then now() else null end,
        now()
      )
      on conflict ("tournament_id", "player_id") do update set
        "arrived" = excluded.arrived,
        "arrived_at" = case
          when excluded.arrived then coalesce("tournament_attendance"."arrived_at", excluded.arrived_at)
          else "tournament_attendance"."arrived_at"
        end,
        "updated_at" = excluded.updated_at
      returning "arrived", "arrived_at"
    `);

    const [result] = rows;

    if (!result) {
      throw new Error("upsertAttendance: no row returned");
    }

    return {
      arrived: result.arrived,
      arrived_at: result.arrived_at ? new Date(result.arrived_at).toISOString() : null,
    };
  }

  async findAttendedPlayersWithDetails(tournamentId: string): Promise<AttendedPlayerRow[]> {
    return db
      .select({
        player_id: tournamentAttendance.playerId,
        arrived_at: tournamentAttendance.arrivedAt,
        players: {
          display_name: players.displayName,
          admin_display_name: players.adminDisplayName,
          custom_avatar_url: players.customAvatarUrl,
          telegram_avatar_url: players.telegramAvatarUrl,
        },
      })
      .from(tournamentAttendance)
      .leftJoin(players, eq(tournamentAttendance.playerId, players.id))
      .where(
        and(
          eq(tournamentAttendance.tournamentId, tournamentId),
          eq(tournamentAttendance.arrived, true)
        )
      )
      .then((rows) =>
        rows.map((row) => ({
          player_id: row.player_id,
          arrived_at: row.arrived_at ? row.arrived_at.toISOString() : null,
          players: row.players,
        }))
      );
  }
}
