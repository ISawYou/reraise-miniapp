import { sql } from "drizzle-orm";
import { pgTable, uuid, integer, text, jsonb, timestamp, primaryKey, uniqueIndex, check } from "drizzle-orm/pg-core";
import { tournaments } from "./tournaments";
import { players } from "./players";
import type { PkoEvent } from "@/lib/progressive-knockout-core";

// Append-only PKO ledger, scoped to one tournament. Sequence is assigned while
// holding SELECT ... FOR UPDATE on the tournaments row. This does NOT write ratings.
export const tournamentPkoEvents = pgTable("tournament_pko_events", {
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  eventId: text("event_id").notNull(),
  eventData: jsonb("event_data").$type<PkoEvent>().notNull(),
  actorId: uuid("actor_id").notNull().references(() => players.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.tournamentId, table.sequence], name: "tournament_pko_events_pk" }),
  uniqueIndex("tournament_pko_events_event_id_uk").on(table.tournamentId, table.eventId),
  check("tournament_pko_events_sequence_check", sql`${table.sequence} > 0`),
  check("tournament_pko_events_event_id_check", sql`char_length(${table.eventId}) BETWEEN 1 AND 128`),
  check("tournament_pko_events_payload_check", sql`jsonb_typeof(${table.eventData}) = 'object'
    AND ${table.eventData}->>'eventId' = ${table.eventId}
    AND ${table.eventData}->>'kind' IN ('entry', 'knockout', 'void_knockout', 'finish')`),
]);
