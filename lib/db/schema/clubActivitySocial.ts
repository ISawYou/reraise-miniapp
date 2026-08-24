import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { clubActivityEvents } from "./clubActivityEvents";
import { players } from "./players";

export const clubActivityLikes = pgTable("club_activity_likes", {
  eventId: uuid("event_id").notNull().references(() => clubActivityEvents.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({
    name: "club_activity_likes_event_player_pk",
    columns: [table.eventId, table.playerId],
  }),
  index("club_activity_likes_player_idx").on(table.playerId),
]);

export const clubActivityComments = pgTable("club_activity_comments", {
  id: uuid().primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => clubActivityEvents.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  body: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check(
    "club_activity_comments_body_length",
    sql`char_length(${table.body}) BETWEEN 1 AND 1000`,
  ),
  index("club_activity_comments_event_created_idx").on(table.eventId, table.createdAt),
  index("club_activity_comments_player_idx").on(table.playerId),
]);
