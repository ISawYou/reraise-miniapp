import { SupabaseAchievementRepository } from "./SupabaseAchievementRepository";
import type { AchievementRepository } from "./AchievementRepository";

export type {
  AchievementRepository,
  AchievementSummary,
  AchievementUpsert,
} from "./AchievementRepository";

export const achievementRepository: AchievementRepository =
  new SupabaseAchievementRepository();
