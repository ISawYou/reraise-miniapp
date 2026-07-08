import { SupabaseAchievementRepository } from "./SupabaseAchievementRepository";
import { PostgresAchievementRepository } from "./PostgresAchievementRepository";
import type { AchievementRepository } from "./AchievementRepository";

export type {
  AchievementRepository,
  AchievementSummary,
  AchievementUpsert,
} from "./AchievementRepository";

const usePostgres = process.env.DATABASE_PROVIDER === "postgres";

export const achievementRepository: AchievementRepository = usePostgres
  ? new PostgresAchievementRepository()
  : new SupabaseAchievementRepository();
