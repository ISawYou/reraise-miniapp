import type { AchievementVisualConfig } from "@/config/achievement-visuals";

export interface AchievementVisualRepository {
  list(): Promise<AchievementVisualConfig[]>;
  upsert(config: AchievementVisualConfig): Promise<void>;
}
