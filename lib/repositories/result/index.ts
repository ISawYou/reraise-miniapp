import { SupabaseResultRepository } from "./SupabaseResultRepository";
import type { ResultRepository } from "./ResultRepository";

export type {
  ResultRepository,
  ResultInsert,
  RatingPointsRow,
  ResultHistoryRow,
} from "./ResultRepository";

export const resultRepository: ResultRepository = new SupabaseResultRepository();
