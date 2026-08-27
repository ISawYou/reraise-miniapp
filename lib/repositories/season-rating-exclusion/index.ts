import { PostgresSeasonRatingExclusionRepository } from "./PostgresSeasonRatingExclusionRepository";
import type { SeasonRatingExclusionRepository } from "./SeasonRatingExclusionRepository";

export type {
  SeasonRatingExclusionRepository,
  SeasonRatingExclusionRow,
  SeasonRatingExclusionInsert,
} from "./SeasonRatingExclusionRepository";

// Postgres-only -- see PostgresSeasonRatingExclusionRepository.ts's doc
// comment. No Supabase implementation exists.
export const seasonRatingExclusionRepository: SeasonRatingExclusionRepository =
  new PostgresSeasonRatingExclusionRepository();
