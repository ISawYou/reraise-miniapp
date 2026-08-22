import { LocalAchievementAssetStorageRepository } from "./LocalAchievementAssetStorageRepository";

export type { AchievementAssetStorageRepository } from "./AchievementAssetStorageRepository";

export const achievementAssetStorageRepository =
  new LocalAchievementAssetStorageRepository();
