import { pgTable, uuid, text, integer, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { players } from "./players";

// achievement_code is deliberately free-form text, not a CHECK-constrained
// enum — the canonical list (ACHIEVEMENT_TARGETS) lives in
// features/achievements.ts and grows with new achievements; constraining it
// here would mean a schema migration every time one ships. Same reasoning
// Poker Clock applied to tournament_events.event_type.
export const playerAchievements = pgTable("player_achievements", {
  id: uuid().primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  achievementCode: text("achievement_code").notNull(),
  currentValue: integer("current_value").notNull().default(0),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  check("player_achievements_current_value_check", sql`${table.currentValue} >= 0`),

  uniqueIndex("player_achievements_player_id_achievement_code_key").on(table.playerId, table.achievementCode),
  index("player_achievements_code_idx").on(table.achievementCode),

  // player_achievements_player_id_idx dropped — redundant with the unique
  // composite above (leftmost column already serves "all achievements for
  // one player"; see audit section 5).
]);
