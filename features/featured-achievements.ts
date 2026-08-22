import "server-only";
import { getPlayerAchievements } from "@/features/achievements";
import { featuredAchievementRepository } from "@/lib/repositories";
import { validateFeaturedAchievementKeys } from "@/lib/achievement-display";

export async function getFeaturedAchievementKeys(playerId: string): Promise<string[]> {
  return featuredAchievementRepository.findKeysByPlayerId(playerId);
}

export async function saveFeaturedAchievementKeys(
  playerId: string,
  requestedKeys: string[],
): Promise<string[]> {
  const rows = await getPlayerAchievements(playerId);
  const keys = validateFeaturedAchievementKeys(rows, requestedKeys);
  await featuredAchievementRepository.saveKeys(playerId, keys);
  return keys;
}
