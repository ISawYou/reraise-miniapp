import { SupabaseResultRepository } from "./SupabaseResultRepository";
import { PostgresResultRepository } from "./PostgresResultRepository";
import type { ResultRepository } from "./ResultRepository";

export type {
  ResultRepository,
  ResultInsert,
  RatingPointsRow,
  KnockoutsRow,
  ResultHistoryRow,
} from "./ResultRepository";

const usePostgres = process.env.DATABASE_PROVIDER === "postgres";

export const resultRepository: ResultRepository = usePostgres
  ? new PostgresResultRepository()
  : new SupabaseResultRepository();
