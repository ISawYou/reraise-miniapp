import { pgTable, uuid, text, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { seasons } from "./seasons";

export const tournaments = pgTable("tournaments", {
  id: uuid().primaryKey().defaultRandom(),
  title: text().notNull(),
  description: text(),
  location: text(),
  googleSheetTabName: text("google_sheet_tab_name"),

  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  maxPlayers: integer("max_players").notNull(),

  status: text().notNull().default("draft"),
  kind: text().notNull().default("free"),
  tournamentType: text("tournament_type").notNull().default("classic"),

  seasonId: uuid("season_id").references(() => seasons.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("tournaments_title_length", sql`char_length(${table.title}) BETWEEN 1 AND 200`),
  check("tournaments_max_players_check", sql`${table.maxPlayers} > 0`),
  check("tournaments_status_check", sql`${table.status} IN ('draft', 'open', 'closed', 'completed')`),
  check("tournaments_kind_check", sql`${table.kind} IN ('free', 'paid', 'cash')`),
  check(
    "tournaments_tournament_type_check",
    sql`${table.tournamentType} IN ('classic', 'phoenix', 'deep_stack', 'bounty', 'boss_bounty', 'win_the_button', 'mystery_bounty')`,
  ),

  // One duplicate pair collapsed (idx_tournaments_status / tournaments_status_idx
  // were byte-identical in the old schema — see audit section 5). The other
  // three single-column indexes (start_at, season_id, kind, tournament_type)
  // carry over unchanged; each serves a distinct Repository query
  // (listOpen/listCompleted order by start_at, findSeasonIdById-adjacent
  // lookups by season_id, etc).
  index("tournaments_status_idx").on(table.status),
  index("tournaments_start_at_idx").on(table.startAt),
  index("tournaments_season_id_idx").on(table.seasonId),
  index("tournaments_kind_idx").on(table.kind),
  index("tournaments_tournament_type_idx").on(table.tournamentType),
]);
