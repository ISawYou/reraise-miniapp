import { pgTable, uuid, integer, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { players } from "./players";
import { tournaments } from "./tournaments";
import { seasons } from "./seasons";

export const results = pgTable("results", {
  id: uuid().primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),

  // Denormalized from tournaments.season_id for leaderboard queries that
  // filter results directly by season without joining tournaments — kept
  // (see docs/POSTGRES_MIGRATION_AUDIT.md section 8), but now FK-enforced,
  // which the old Supabase schema never did (column + index existed with
  // zero referential integrity behind them).
  seasonId: uuid("season_id").references(() => seasons.id, { onDelete: "set null" }),

  place: integer().notNull(),
  reentries: integer().notNull().default(0),
  knockouts: integer().notNull().default(0),

  // Boss Bounty format: count of Boss knockouts, separate from regular
  // knockouts above (sql/boss_bounty.sql — same column, ported into schema.ts
  // as the source of truth instead of staying an out-of-band raw-SQL patch).
  bossKnockouts: integer("boss_knockouts").notNull().default(0),

  // Mystery Bounty format: sum of physical envelope values a player drew
  // (sql/mystery_bounty.sql). Frozen the same way as ratingPoints below —
  // "current value", not a running total; complete-free overwrites it via
  // the same delete-then-insert as every other result column.
  mysteryBountyPoints: integer("mystery_bounty_points").notNull().default(0),

  // Frozen snapshot computed once at tournament completion
  // (features/rating.ts::calculateRatingPoints) — depends on that specific
  // tournament's field size, never recalculated retroactively if the
  // formula changes later. Deliberate denormalization, not a cache to
  // invalidate.
  ratingPoints: integer("rating_points").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("results_place_check", sql`${table.place} > 0`),
  check("results_rating_points_check", sql`${table.ratingPoints} >= 0`),

  uniqueIndex("results_tournament_id_player_id_key").on(table.tournamentId, table.playerId),
  uniqueIndex("results_tournament_id_place_key").on(table.tournamentId, table.place),

  // Duplicate pairs collapsed (idx_results_player_id/results_player_id_idx,
  // idx_results_tournament_id/results_tournament_id_idx — see audit
  // section 5). tournament_id is also covered by the two uniques above via
  // leftmost-column, but kept as its own index since results are looked up
  // by tournament_id alone far more often than by the composite keys.
  index("results_player_id_idx").on(table.playerId),
  index("results_tournament_id_idx").on(table.tournamentId),
  index("results_season_id_idx").on(table.seasonId),
]);
