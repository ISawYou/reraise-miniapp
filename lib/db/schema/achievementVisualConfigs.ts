import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const achievementVisualConfigs = pgTable(
  "achievement_visual_configs",
  {
    visualKey: text("visual_key").primaryKey(),
    assetUrl: text("asset_url").notNull(),
    scale: integer().notNull().default(100),
    offsetX: integer("offset_x").notNull().default(0),
    offsetY: integer("offset_y").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("achievement_visual_configs_scale_check", sql`${table.scale} BETWEEN 50 AND 200`),
    check("achievement_visual_configs_offset_x_check", sql`${table.offsetX} BETWEEN -100 AND 100`),
    check("achievement_visual_configs_offset_y_check", sql`${table.offsetY} BETWEEN -100 AND 100`),
  ],
);
