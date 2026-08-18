import type { TournamentResult } from "@/types/domain";
import type { TournamentRow } from "@/types/database";

// Data-access boundary for `results` — final, settled tournament outcomes.
// Deliberately a thin CRUD surface: rating-point calculation
// (features/rating.ts), leaderboard aggregation (summing/sorting by
// player), and achievement-threshold decisions all stay exactly where they
// are today (features/tournaments.ts, features/achievements.ts,
// app/api/leaderboard/route.ts).
//
// Several methods embed a Supabase join (`players (...)` / `tournament:
// tournaments (...)`) exactly as today's queries do — splitting those into
// two separate queries plus an app-level join would change the number of
// round-trips this table sees, which is exactly the kind of behavior
// change this migration avoids.
export type ResultInsert = {
  tournament_id: string;
  player_id: string;
  season_id: string | null;
  place: number;
  reentries: number;
  knockouts: number;
  boss_knockouts?: number;
  mystery_bounty_points?: number;
  addons?: number;
  rating_points: number;
  // Rating Breakdown (see lib/db/schema/results.ts) -- optional here for the
  // same reason boss_knockouts/mystery_bounty_points/addons are: every real
  // write path always provides all five explicitly (features/tournaments.ts),
  // this is just type-level flexibility matching the rest of this shape, not
  // a signal that omitting them is a normal case. Nullable columns, so a
  // caller that genuinely doesn't have a value yet can pass `null` rather
  // than a guessed number/boolean.
  arrived?: boolean | null;
  participation_points?: number | null;
  knockout_points?: number | null;
  boss_bounty_points?: number | null;
  itm_points?: number | null;
};

export type RatingPointsRow = {
  player_id: string;
  rating_points: number | null;
};

// Mirrors getMyTournamentHistory's exact embedded select — the raw
// TournamentRow embed, not yet mapped to the Tournament domain type (that
// mapping is Tournament's, done by the caller).
export type ResultHistoryRow = {
  player_id: string;
  tournament_id: string;
  place: number;
  knockouts: number;
  boss_knockouts?: number;
  reentries: number;
  rating_points: number;
  tournament: TournamentRow | null;
};

export interface ResultRepository {
  countByPlayerId(playerId: string): Promise<number>;
  // Mirrors getPlayerAchievementStats' "wins" query: select("id") where
  // place=1, returned as-is so the caller keeps doing `.length` exactly
  // like before (not converted to a count query — that would be a
  // different query, not just a thinner wrapper).
  findWinIdsByPlayerId(playerId: string): Promise<{ id: string }[]>;
  findRatingPointsByPlayerId(playerId: string): Promise<RatingPointsRow[]>;
  findRatingPointsByTournamentId(tournamentId: string): Promise<RatingPointsRow[]>;
  findRatingPointsBySeasonId(seasonId: string): Promise<RatingPointsRow[]>;

  findByTournamentIdWithPlayer(tournamentId: string): Promise<TournamentResult[]>;
  findWithPlayerBySeasonId(seasonId: string): Promise<
    Array<{
      player_id: string;
      rating_points: number | null;
      username: string | null;
      display_name: string;
      telegram_avatar_url: string | null;
      custom_avatar_url: string | null;
    }>
  >;
  findHistoryWithTournamentByPlayerId(playerId: string): Promise<ResultHistoryRow[]>;

  deleteByTournamentId(tournamentId: string): Promise<void>;
  deleteByPlayerId(playerId: string): Promise<void>;
  insertMany(rows: ResultInsert[]): Promise<void>;
}
