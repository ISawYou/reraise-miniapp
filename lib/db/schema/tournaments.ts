import { pgTable, uuid, text, integer, boolean, timestamp, index, check } from "drizzle-orm/pg-core";
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

  // Rating Engine v2: which formula this tournament's results were/will be
  // computed with, frozen at completion time exactly like results.rating_points
  // itself. Defaults to "v2" for every tournament created from here on;
  // migration 0005 backfills every pre-existing row to "legacy" explicitly so
  // that re-opening/re-completing an old tournament keeps calling the
  // untouched legacy formula (features/rating.ts) instead of silently
  // picking up v2 math because the code changed underneath it.
  ratingFormulaVersion: text("rating_formula_version").notNull().default("v2"),

  // Phoenix Rating Guarantee (spec §15) -- admin-set target for the tournament's
  // TOTAL rating pool (participation + placement). null = no guarantee, the
  // natural pool applies unchanged. Only meaningful for tournament_type =
  // "phoenix", but not DB-constrained to it -- enforced at the application layer
  // like every other type-conditional field in this schema.
  ratingGuarantee: integer("rating_guarantee"),

  seasonId: uuid("season_id").references(() => seasons.id, { onDelete: "set null" }),

  // "Финал месяца" is a CREATE/EDIT UI preset, not a persisted
  // TournamentType -- it always writes tournament_type="classic" here,
  // with this flag as the one true signal for invite-only registration
  // (features/tournaments.ts) and the special Home/detail presentation.
  // Added by migration 0021_nifty_ironclad -- this column already exists
  // in production; this just brings the Drizzle schema in sync with it.
  isFinal: boolean("is_final").notNull().default(false),

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
  check(
    "tournaments_rating_formula_version_check",
    sql`${table.ratingFormulaVersion} IN ('legacy', 'v2')`,
  ),
  check(
    "tournaments_rating_guarantee_check",
    sql`${table.ratingGuarantee} IS NULL OR ${table.ratingGuarantee} >= 0`,
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
