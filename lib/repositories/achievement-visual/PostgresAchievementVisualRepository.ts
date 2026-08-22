import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { achievementVisualConfigs } from "@/lib/db/schema";
import type { AchievementVisualConfig } from "@/config/achievement-visuals";
import type { AchievementVisualRepository } from "./AchievementVisualRepository";

export class PostgresAchievementVisualRepository implements AchievementVisualRepository {
  async list(): Promise<AchievementVisualConfig[]> {
    const rows = await db.select().from(achievementVisualConfigs);
    return rows.map((row) => ({
      visualKey: row.visualKey as AchievementVisualConfig["visualKey"],
      assetUrl: row.assetUrl,
      scale: row.scale,
      offsetX: row.offsetX,
      offsetY: row.offsetY,
    }));
  }

  async upsert(config: AchievementVisualConfig): Promise<void> {
    await db
      .insert(achievementVisualConfigs)
      .values({
        visualKey: config.visualKey,
        assetUrl: config.assetUrl,
        scale: config.scale,
        offsetX: config.offsetX,
        offsetY: config.offsetY,
      })
      .onConflictDoUpdate({
        target: achievementVisualConfigs.visualKey,
        set: {
          assetUrl: sql`excluded.asset_url`,
          scale: sql`excluded.scale`,
          offsetX: sql`excluded.offset_x`,
          offsetY: sql`excluded.offset_y`,
          updatedAt: new Date(),
        },
      });
  }
}
