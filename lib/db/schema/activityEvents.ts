import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { players } from "./players";

// event_type stays free-form text, not a CHECK enum — same reasoning as
// achievements.achievementCode: the canonical list lives in application
// code and grows without a schema migration each time.
export const activityEvents = pgTable("activity_events", {
  id: uuid().primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  eventLabel: text("event_label"),
  // Shape depends on event_type — genuinely polymorphic, kept loose
  // ($type<Record<string, unknown>>) rather than a fixed interface, same
  // criterion Poker Clock applied to its own variable-shape jsonb columns.
  metadata: jsonb().$type<Record<string, unknown>>(),
  platform: text().notNull().default("unknown"),
  sessionId: text("session_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // All three indexes serve genuinely different access patterns already in
  // use (ActivityRepository.findByPlayerId, .findSince, and an
  // all-recent-events-of-one-type shape) — no duplication to collapse here.
  index("activity_events_created_idx").on(table.createdAt.desc()),
  index("activity_events_player_created_idx").on(table.playerId, table.createdAt.desc()),
  index("activity_events_type_created_idx").on(table.eventType, table.createdAt.desc()),
]);
