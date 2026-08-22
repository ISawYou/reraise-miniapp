import { PostgresAchievementVisualRepository } from "./PostgresAchievementVisualRepository";

export type { AchievementVisualRepository } from "./AchievementVisualRepository";

export const achievementVisualRepository = new PostgresAchievementVisualRepository();
