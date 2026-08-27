// Data-access boundary for `season_rating_exclusions` -- thin 1:1 wrapper,
// no eligibility/leaderboard logic here (that lives in
// features/rating-eligibility.ts and features/leaderboard.ts).
export type SeasonRatingExclusionRow = {
  id: string;
  season_id: string;
  player_id: string;
  created_by_player_id: string | null;
  reason: string | null;
  created_at: string;
};

export type SeasonRatingExclusionInsert = {
  season_id: string;
  player_id: string;
  created_by_player_id: string | null;
  reason: string | null;
};

export interface SeasonRatingExclusionRepository {
  listBySeasonId(seasonId: string): Promise<SeasonRatingExclusionRow[]>;
  findBySeasonAndPlayer(seasonId: string, playerId: string): Promise<SeasonRatingExclusionRow | null>;
  // Upsert on the (season_id, player_id) unique index -- calling this for
  // an already-excluded player is a harmless no-op-ish update (refreshes
  // reason/created_by_player_id), not a duplicate-row error.
  create(data: SeasonRatingExclusionInsert): Promise<SeasonRatingExclusionRow>;
  // No-op if no such exclusion exists -- "remove exclusion" and "player
  // was already eligible" are the same end state.
  remove(seasonId: string, playerId: string): Promise<void>;
}
