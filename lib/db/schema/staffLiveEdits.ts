import { sql } from "drizzle-orm";
import { bigint, check, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Transaction-scoped authorization and private audit for post-cutoff live
// Re-entry/Add-on edits. The DB trigger accepts an edit only while its exact
// pending row exists in the same transaction/backend.
export const staffTournamentLiveEdits = pgTable("staff_tournament_live_edits", {
  requestId: uuid("request_id").primaryKey(),
  tournamentId: uuid("tournament_id").notNull(),
  playerId: uuid("player_id").notNull(),
  actorId: uuid("actor_id"),
  source: text().notNull(),
  rebuys: integer().notNull(),
  addons: integer().notNull(),
  state: text().notNull().default("pending"),
  transactionId: bigint("transaction_id", { mode: "bigint" }).notNull(),
  backendPid: integer("backend_pid").notNull(),
  previousState: jsonb("previous_state"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("staff_live_edit_source", sql`${table.source} in ('staff','sheet_sync')`),
  check("staff_live_edit_state", sql`${table.state} in ('pending','succeeded')`),
  check("staff_live_edit_values", sql`${table.rebuys} >= 0 and ${table.addons} >= 0`),
]);
