export interface FeaturedAchievementRepository {
  findKeysByPlayerId(playerId: string): Promise<string[]>;
  saveKeys(playerId: string, keys: string[]): Promise<void>;
}
