import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { players } from "./players";
import { tournaments } from "./tournaments";

export const clubActivityEvents = pgTable("club_activity_events", {
  id: uuid().primaryKey().defaultRandom(),
  eventType: text("event_type").notNull(),
  source: text().notNull(),
  status: text().notNull().default("draft"),
  title: text().notNull(),
  body: text().notNull(),
  imageUrl: text("image_url"),
  ctaLabel: text("cta_label"),
  ctaUrl: text("cta_url"),
  playerId: uuid("player_id").references(() => players.id, { onDelete: "set null" }),
  tournamentId: uuid("tournament_id").references(() => tournaments.id, { onDelete: "set null" }),
  achievementCode: text("achievement_code"),
  idempotencyKey: text("idempotency_key"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("club_activity_events_source_check", sql`${table.source} IN ('manual', 'automatic')`),
  check("club_activity_events_status_check", sql`${table.status} IN ('draft', 'published', 'archived')`),
  check("club_activity_events_title_length", sql`char_length(${table.title}) BETWEEN 1 AND 200`),
  check("club_activity_events_body_length", sql`char_length(${table.body}) BETWEEN 1 AND 5000`),
  check(
    "club_activity_events_published_at_check",
    sql`${table.status} <> 'published' OR ${table.publishedAt} IS NOT NULL`,
  ),
  check(
    "club_activity_events_idempotency_check",
    sql`(${table.source} = 'automatic' AND ${table.idempotencyKey} IS NOT NULL) OR (${table.source} = 'manual' AND ${table.idempotencyKey} IS NULL)`,
  ),
  uniqueIndex("club_activity_events_idempotency_key_idx")
    .on(table.idempotencyKey)
    .where(sql`${table.idempotencyKey} IS NOT NULL`),
  index("club_activity_events_feed_idx").on(table.status, table.publishedAt.desc()),
  index("club_activity_events_created_idx").on(table.createdAt.desc()),
  index("club_activity_events_player_idx").on(table.playerId),
  index("club_activity_events_tournament_idx").on(table.tournamentId),
]);
