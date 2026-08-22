import { check, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { players } from "./players";

export const playerFeaturedAchievements = pgTable("player_featured_achievements", {
  playerId: uuid("player_id").primaryKey().references(() => players.id, { onDelete: "cascade" }),
  achievementKeys: jsonb("achievement_keys").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("player_featured_achievements_array_check", sql`jsonb_typeof(${table.achievementKeys}) = 'array'`),
  check("player_featured_achievements_limit_check", sql`jsonb_array_length(${table.achievementKeys}) <= 3`),
]);
