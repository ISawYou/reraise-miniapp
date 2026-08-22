import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { playerFeaturedAchievements } from "@/lib/db/schema";
import type { FeaturedAchievementRepository } from "./FeaturedAchievementRepository";

export class PostgresFeaturedAchievementRepository implements FeaturedAchievementRepository {
  async findKeysByPlayerId(playerId: string): Promise<string[]> {
    const [row] = await db.select({ keys: playerFeaturedAchievements.achievementKeys })
      .from(playerFeaturedAchievements)
      .where(eq(playerFeaturedAchievements.playerId, playerId))
      .limit(1);
    return row?.keys ?? [];
  }

  async saveKeys(playerId: string, keys: string[]): Promise<void> {
    await db.insert(playerFeaturedAchievements).values({
      playerId,
      achievementKeys: keys,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: playerFeaturedAchievements.playerId,
      set: { achievementKeys: keys, updatedAt: new Date() },
    });
  }
}
