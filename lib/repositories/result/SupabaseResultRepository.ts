import "server-only";

import { getSupabaseServer } from "@/lib/database";
import type { TournamentResult } from "@/types/domain";
import type {
  ResultRepository,
  ResultInsert,
  RatingPointsRow,
  ResultHistoryRow,
} from "./ResultRepository";

function flattenEmbedded<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

// Current, active implementation — wraps the exact same Supabase queries
// that were previously spread across features/tournaments.ts,
// features/achievements.ts, features/admin.ts (cascading delete) and
// app/api/leaderboard/route.ts. No new behavior.
export class SupabaseResultRepository implements ResultRepository {
  async countByPlayerId(playerId: string): Promise<number> {
    const supabase = getSupabaseServer();
    const { count, error } = await supabase
      .from("results")
      .select("*", { count: "exact", head: true })
      .eq("player_id", playerId);

    if (error) {
      throw new Error(error.message);
    }

    return count ?? 0;
  }

  async findWinIdsByPlayerId(playerId: string): Promise<{ id: string }[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("results")
      .select("id")
      .eq("player_id", playerId)
      .eq("place", 1);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as { id: string }[];
  }

  async findRatingPointsByPlayerId(playerId: string): Promise<RatingPointsRow[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("results")
      .select("rating_points")
      .eq("player_id", playerId);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: any) => ({
      player_id: playerId,
      rating_points: row.rating_points,
    }));
  }

  async findRatingPointsByTournamentId(tournamentId: string): Promise<RatingPointsRow[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("results")
      .select("player_id, rating_points")
      .eq("tournament_id", tournamentId);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as RatingPointsRow[];
  }

  async findRatingPointsBySeasonId(seasonId: string): Promise<RatingPointsRow[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("results")
      .select("player_id, rating_points")
      .eq("season_id", seasonId);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as RatingPointsRow[];
  }

  async findByTournamentIdWithPlayer(tournamentId: string): Promise<TournamentResult[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("results")
      .select(
        `
        player_id,
        place,
        knockouts,
        boss_knockouts,
        reentries,
        rating_points,
        players (
          username,
          display_name
        )
      `
      )
      .eq("tournament_id", tournamentId)
      .order("place", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: any) => {
      const player = flattenEmbedded(row.players);

      return {
        player_id: row.player_id,
        place: row.place,
        knockouts: row.knockouts,
        boss_knockouts: row.boss_knockouts ?? 0,
        reentries: row.reentries,
        rating_points: row.rating_points,
        username: player?.username ?? null,
        display_name: player?.display_name ?? "Игрок",
      };
    });
  }

  async findWithPlayerBySeasonId(seasonId: string) {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("results")
      .select(
        `
        player_id,
        rating_points,
        players (
          username,
          display_name,
          telegram_avatar_url,
          custom_avatar_url
        )
      `
      )
      .eq("season_id", seasonId);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: any) => {
      const player = flattenEmbedded(row.players);

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
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("results")
      .select(
        `
        player_id,
        tournament_id,
        place,
        knockouts,
        boss_knockouts,
        reentries,
        rating_points,
        tournament:tournaments (*)
      `
      )
      .eq("player_id", playerId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: any) => ({
      player_id: row.player_id,
      tournament_id: row.tournament_id,
      place: row.place,
      knockouts: row.knockouts,
      boss_knockouts: row.boss_knockouts ?? 0,
      reentries: row.reentries,
      rating_points: row.rating_points,
      tournament: flattenEmbedded(row.tournament),
    }));
  }

  async deleteByTournamentId(tournamentId: string): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase
      .from("results")
      .delete()
      .eq("tournament_id", tournamentId);

    if (error) {
      throw new Error(error.message);
    }
  }

  async deleteByPlayerId(playerId: string): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase
      .from("results")
      .delete()
      .eq("player_id", playerId);

    if (error) {
      throw new Error(`Ошибка удаления results: ${error.message}`);
    }
  }

  async insertMany(rows: ResultInsert[]): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase.from("results").insert(rows);

    if (error) {
      throw new Error(error.message);
    }
  }
}
