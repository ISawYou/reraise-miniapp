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
  // See lib/db/schema/results.ts's freeReentries doc comment. Optional here
  // for the same type-level-flexibility reason as addons/boss_knockouts;
  // every real write path (features/tournaments.ts) provides it explicitly.
  free_reentries?: number;
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

// One row per result, mirroring RatingPointsRow's shape — the caller sums
// these itself (see features/achievements.ts's rating_points handling),
// not a SQL-side aggregate.
export type KnockoutsRow = {
  player_id: string;
  knockouts: number;
};

// Boss knockouts only (results.boss_knockouts) -- a separate, non-overlapping
// counter from ordinary knockouts (see supportsTournamentBossKnockouts /
// Rating Engine, which already treat these as two distinct input fields, not
// a subset relationship). Same per-row, caller-sums shape as KnockoutsRow.
export type BossKnockoutsRow = {
  player_id: string;
  boss_knockouts: number;
};

// Marco Reus ("bubble"): the player's own place plus the arrived field
// size of that SAME tournament, for every tournament they attended.
// Deliberately data-only — field_size is a plain count (arrived = true
// rows for that tournament_id), not the rating-zone size itself. Turning
// field_size into a rating-zone boundary is business logic
// (getExpectedPrizePlaces, lib/tournament-helpers.ts) and stays in
// features/achievements.ts, not here — this type only carries the raw
// inputs that formula needs.
export type ArrivedPlacementRow = {
  tournament_id: string;
  place: number;
  field_size: number;
};

export function isEffectiveArrivedResult(row: {
  arrived: boolean | null;
  rating_points: number;
}): boolean {
  return row.arrived === true || (row.arrived === null && row.rating_points > 0);
}

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
  // ITM ("in the money") is defined exclusively as itm_points > 0 (see
  // docs/RATING_BREAKDOWN_ANALYSIS.md) -- a plain count, not row-fetching,
  // since callers (features/achievements.ts) only ever need the number.
  // itm_points = 0 and itm_points IS NULL (not yet backfilled) both
  // correctly fall outside "> 0" by ordinary SQL comparison semantics, no
  // extra NULL-handling needed at the call site.
  countItmFinishesByPlayerId(playerId: string): Promise<number>;
  // Mirrors getPlayerAchievementStats' "wins" query: select("id") where
  // place=1, returned as-is so the caller keeps doing `.length` exactly
  // like before (not converted to a count query — that would be a
  // different query, not just a thinner wrapper).
  findWinIdsByPlayerId(playerId: string): Promise<{ id: string }[]>;
  findRatingPointsByPlayerId(playerId: string): Promise<RatingPointsRow[]>;
  findRatingPointsByTournamentId(tournamentId: string): Promise<RatingPointsRow[]>;
  findRatingPointsBySeasonId(seasonId: string): Promise<RatingPointsRow[]>;
  findKnockoutsByPlayerId(playerId: string): Promise<KnockoutsRow[]>;
  findBossKnockoutsByPlayerId(playerId: string): Promise<BossKnockoutsRow[]>;
  // Tournament Streak: which completed tournaments this player actually
  // arrived to (arrived = true, per Rating Breakdown -- see
  // docs/RATING_BREAKDOWN_ANALYSIS.md), as a flat id list. The caller
  // (features/achievements.ts) cross-references this against
  // tournamentRepository.listCompleted()'s chronological order -- this
  // method only answers "did this player attend tournament X", not
  // ordering, which is TournamentRepository's job.
  findArrivedTournamentIdsByPlayerId(playerId: string): Promise<{ tournament_id: string }[]>;
  // Marco Reus — see ArrivedPlacementRow above.
  findArrivedPlacementsByPlayerId(playerId: string): Promise<ArrivedPlacementRow[]>;

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
