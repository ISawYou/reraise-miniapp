import "server-only";

import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { players, results, tournaments } from "@/lib/db/schema";
import type { TournamentResult } from "@/types/domain";
import type {
  ResultRepository,
  ResultInsert,
  RatingPointsRow,
  KnockoutsRow,
  BossKnockoutsRow,
  ArrivedPlacementRow,
  ResultHistoryRow,
} from "./ResultRepository";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Drizzle/Postgres counterpart of SupabaseResultRepository -- same
// contract, no new behavior. Compensations: timestamp columns converted to
// ISO strings, embedded Supabase joins (`players (...)`, `tournament:
// tournaments (...)`) replaced with Drizzle leftJoin + a nested-object
// select. Confirmed by reading drizzle-orm's own mapResultRow (utils.js):
// when a nested object's columns come from the *outer* side of a leftJoin
// and are all null, Drizzle already collapses that whole nested key to a
// bare `null` -- exactly flattenEmbedded's behavior -- so no extra
// null-coercion helper is needed. insertMany stays a plain bulk insert -- no
// onConflict added. Both real call sites (completeTournamentFromLiveEntries,
// saveTournamentResults) already call deleteByTournamentId immediately
// before insertMany, which is what avoids the
// results_tournament_id_player_id_key / results_tournament_id_place_key
// unique-constraint conflicts today; that ordering lives in
// features/tournaments.ts and is untouched here.
export class PostgresResultRepository implements ResultRepository {
  async countByPlayerId(playerId: string): Promise<number> {
    const rows = await db
      .select({ count: sql`count(*)`.mapWith(Number) })
      .from(results)
      .where(eq(results.playerId, playerId));
    return rows[0]?.count ?? 0;
  }

  async countItmFinishesByPlayerId(playerId: string): Promise<number> {
    const rows = await db
      .select({ count: sql`count(*)`.mapWith(Number) })
      .from(results)
      .where(and(eq(results.playerId, playerId), gt(results.itmPoints, 0)));
    return rows[0]?.count ?? 0;
  }

  async findWinIdsByPlayerId(playerId: string): Promise<{ id: string }[]> {
    return db
      .select({ id: results.id })
      .from(results)
      .where(and(eq(results.playerId, playerId), eq(results.place, 1)));
  }

  async findRatingPointsByPlayerId(playerId: string): Promise<RatingPointsRow[]> {
    const rows = await db
      .select({ rating_points: results.ratingPoints })
      .from(results)
      .where(eq(results.playerId, playerId));
    // Matches SupabaseResultRepository exactly: player_id comes from the
    // input parameter, not a selected column.
    return rows.map((row) => ({ player_id: playerId, rating_points: row.rating_points }));
  }

  async findKnockoutsByPlayerId(playerId: string): Promise<KnockoutsRow[]> {
    const rows = await db
      .select({ knockouts: results.knockouts })
      .from(results)
      .where(eq(results.playerId, playerId));
    // Matches findRatingPointsByPlayerId exactly: player_id comes from the
    // input parameter, not a selected column.
    return rows.map((row) => ({ player_id: playerId, knockouts: row.knockouts }));
  }

  async findBossKnockoutsByPlayerId(playerId: string): Promise<BossKnockoutsRow[]> {
    const rows = await db
      .select({ boss_knockouts: results.bossKnockouts })
      .from(results)
      .where(eq(results.playerId, playerId));
    return rows.map((row) => ({ player_id: playerId, boss_knockouts: row.boss_knockouts }));
  }

  async findArrivedTournamentIdsByPlayerId(playerId: string): Promise<{ tournament_id: string }[]> {
    return db
      .select({ tournament_id: results.tournamentId })
      .from(results)
      .where(and(eq(results.playerId, playerId), eq(results.arrived, true)));
  }

  async findArrivedPlacementsByPlayerId(playerId: string): Promise<ArrivedPlacementRow[]> {
    // Historical rows predate results.arrived. Their frozen positive rating
    // points are the established fallback proof that the player participated.
    // Keep the outer result alias explicit: the previous Drizzle correlated
    // select lost the correlation at runtime and returned no Bubble Boy
    // progress even though the same production rows matched directly.
    const rows = await db.execute<ArrivedPlacementRow>(sql`
      select
        r.tournament_id,
        r.place,
        (
          select count(*)::int
          from "results" as r2
          where r2.tournament_id = r.tournament_id
            and (r2.arrived = true or (r2.arrived is null and r2.rating_points > 0))
        ) as field_size
      from "results" as r
      where r.player_id = ${playerId}
        and (r.arrived = true or (r.arrived is null and r.rating_points > 0))
    `);

    return Array.from(rows);
  }

  async findRatingPointsByTournamentId(tournamentId: string): Promise<RatingPointsRow[]> {
    return db
      .select({ player_id: results.playerId, rating_points: results.ratingPoints })
      .from(results)
      .where(eq(results.tournamentId, tournamentId));
  }

  async findRatingPointsBySeasonId(seasonId: string): Promise<RatingPointsRow[]> {
    return db
      .select({ player_id: results.playerId, rating_points: results.ratingPoints })
      .from(results)
      .where(eq(results.seasonId, seasonId));
  }

  async findByTournamentIdWithPlayer(tournamentId: string): Promise<TournamentResult[]> {
    const rows = await db
      .select({
        player_id: results.playerId,
        place: results.place,
        knockouts: results.knockouts,
        boss_knockouts: sql<number>`coalesce(${sql.raw('"results"."boss_knockouts"')}, 0)`,
        mystery_bounty_points: sql<number>`coalesce(${sql.raw('"results"."mystery_bounty_points"')}, 0)`,
        addons: results.addons,
        reentries: results.reentries,
        rating_points: results.ratingPoints,
        players: {
          id: players.id,
          username: players.username,
          display_name: players.displayName,
        },
      })
      .from(results)
      .leftJoin(players, eq(results.playerId, players.id))
      .where(eq(results.tournamentId, tournamentId))
      .orderBy(results.place);

    return rows.map((row) => {
      const player = row.players;
      return {
        player_id: row.player_id,
        place: row.place,
        knockouts: row.knockouts,
        boss_knockouts: row.boss_knockouts ?? 0,
        mystery_bounty_points: row.mystery_bounty_points ?? 0,
        addons: row.addons ?? 0,
        reentries: row.reentries,
        rating_points: row.rating_points,
        username: player?.username ?? null,
        display_name: player?.display_name ?? "Игрок",
      };
    });
  }

  async findWithPlayerBySeasonId(seasonId: string) {
    const rows = await db
      .select({
        player_id: results.playerId,
        rating_points: results.ratingPoints,
        players: {
          id: players.id,
          username: players.username,
          display_name: players.displayName,
          telegram_avatar_url: players.telegramAvatarUrl,
          custom_avatar_url: players.customAvatarUrl,
        },
      })
      .from(results)
      .leftJoin(players, eq(results.playerId, players.id))
      .where(eq(results.seasonId, seasonId));

    return rows.map((row) => {
      const player = row.players;
      return {
        player_id: row.player_id,
        rating_points: row.rating_points,
        username: player?.username ?? null,
        display_name: player?.display_name ?? "Игрок",
        telegram_avatar_url: player?.telegram_avatar_url ?? null,
        custom_avatar_url: player?.custom_avatar_url ?? null,
      };
    });
  }

  async findHistoryWithTournamentByPlayerId(playerId: string): Promise<ResultHistoryRow[]> {
    const rows = await db
      .select({
        player_id: results.playerId,
        tournament_id: results.tournamentId,
        place: results.place,
        knockouts: results.knockouts,
        boss_knockouts: sql<number>`coalesce(${sql.raw('"results"."boss_knockouts"')}, 0)`,
        reentries: results.reentries,
        rating_points: results.ratingPoints,
        tournament: {
          id: tournaments.id,
          title: tournaments.title,
          description: tournaments.description,
          location: tournaments.location,
          google_sheet_tab_name: tournaments.googleSheetTabName,
          start_at: tournaments.startAt,
          max_players: tournaments.maxPlayers,
          kind: tournaments.kind,
          tournament_type: tournaments.tournamentType,
          season_id: tournaments.seasonId,
          status: tournaments.status,
          created_at: tournaments.createdAt,
        },
      })
      .from(results)
      .leftJoin(tournaments, eq(results.tournamentId, tournaments.id))
      .where(eq(results.playerId, playerId))
      .orderBy(desc(results.createdAt));

    return rows.map((row) => ({
      player_id: row.player_id,
      tournament_id: row.tournament_id,
      place: row.place,
      knockouts: row.knockouts,
      boss_knockouts: row.boss_knockouts ?? 0,
      reentries: row.reentries,
      rating_points: row.rating_points,
      tournament: row.tournament
        ? {
            ...row.tournament,
            start_at: row.tournament.start_at.toISOString(),
            created_at: row.tournament.created_at.toISOString(),
          }
        : null,
    })) as ResultHistoryRow[];
  }

  async deleteByTournamentId(tournamentId: string): Promise<void> {
    await db.delete(results).where(eq(results.tournamentId, tournamentId));
  }

  async deleteByPlayerId(playerId: string): Promise<void> {
    try {
      await db.delete(results).where(eq(results.playerId, playerId));
    } catch (err) {
      throw new Error(`Ошибка удаления results: ${errorMessage(err)}`);
    }
  }

  async insertMany(rows: ResultInsert[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const values = sql.join(
      rows.map((row) => sql`(
        ${row.tournament_id},
        ${row.player_id},
        ${row.season_id},
        ${row.place},
        ${row.reentries},
        ${row.knockouts},
        ${row.boss_knockouts ?? 0},
        ${row.mystery_bounty_points ?? 0},
        ${row.addons ?? 0},
        ${row.rating_points},
        ${row.arrived ?? null},
        ${row.participation_points ?? null},
        ${row.knockout_points ?? null},
        ${row.boss_bounty_points ?? null},
        ${row.itm_points ?? null}
      )`),
      sql`, `
    );

    await db.execute(sql`
      insert into "results" (
        "tournament_id",
        "player_id",
        "season_id",
        "place",
        "reentries",
        "knockouts",
        "boss_knockouts",
        "mystery_bounty_points",
        "addons",
        "rating_points",
        "arrived",
        "participation_points",
        "knockout_points",
        "boss_bounty_points",
        "itm_points"
      )
      values ${values}
    `);
  }
}
