import { PostgresFeaturedAchievementRepository } from "./PostgresFeaturedAchievementRepository";
import type { FeaturedAchievementRepository } from "./FeaturedAchievementRepository";

export type { FeaturedAchievementRepository } from "./FeaturedAchievementRepository";
export const featuredAchievementRepository: FeaturedAchievementRepository =
  new PostgresFeaturedAchievementRepository();
