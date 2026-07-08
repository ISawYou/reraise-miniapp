import { SupabaseSeasonRepository } from "./SupabaseSeasonRepository";
import { PostgresSeasonRepository } from "./PostgresSeasonRepository";
import type { SeasonRepository } from "./SeasonRepository";

export type { SeasonRepository, SeasonRow } from "./SeasonRepository";

const usePostgres = process.env.DATABASE_PROVIDER === "postgres";

export const seasonRepository: SeasonRepository = usePostgres
  ? new PostgresSeasonRepository()
  : new SupabaseSeasonRepository();
