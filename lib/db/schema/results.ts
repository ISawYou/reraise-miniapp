import { pgTable, uuid, integer, boolean, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
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

  // Rating Engine v2: per-player add-on count, mirrors
  // tournament_live_entries.addons for free tournaments. Previously
  // collected by the admin UI and synced to Google Sheets but never
  // persisted here (features/rating.ts's legacy formula never reads it).
  // 0 for every pre-v2 row -- an honest placeholder, not a fabricated
  // historical fact, since the legacy formula never consulted this value.
  addons: integer().notNull().default(0),

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

  // Rating Breakdown: frozen components of ratingPoints above, computed by
  // the SAME calculator that produces ratingPoints
  // (features/rating.ts::calculateRatingPoints /
  // features/rating-v2.ts::calculateRatingPointsV2, via the shared
  // RatingPointsBreakdown shape) -- not a second, independently maintained
  // formula. See docs/RATING_BREAKDOWN_ANALYSIS.md.
  //
  // Deliberately nullable with no default, unlike addons/mysteryBountyPoints
  // above: every pre-existing row (750+ at the time this was added) has a
  // real historical rating_points value whose breakdown genuinely needs
  // reconstruction, not a value the old formula simply never consulted (that
  // was addons's case, where 0 is an honest fact, not a guess -- see that
  // column's comment). A blanket NOT NULL DEFAULT would make every
  // historical row look like "verified zero ITM/knockout/etc.", which is
  // false for rows where it isn't. New writes always populate all five
  // fields explicitly (see features/tournaments.ts); historical rows stay
  // NULL until a reviewed backfill (scripts/backfill-rating-breakdown.mjs,
  // dry-run only as of this migration) sets them from the reconstruction
  // proven safe in docs/RATING_BREAKDOWN_ANALYSIS.md. NOT NULL is added in
  // a later migration, only after backfill is approved and run.
  arrived: boolean("arrived"),
  participationPoints: integer("participation_points"),
  knockoutPoints: integer("knockout_points"),
  bossBountyPoints: integer("boss_bounty_points"),
  itmPoints: integer("itm_points"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("results_place_check", sql`${table.place} > 0`),
  check("results_rating_points_check", sql`${table.ratingPoints} >= 0`),

  // Non-negativity, same style as results_rating_points_check. NULL-tolerant
  // by ordinary SQL three-valued logic (a NULL operand makes the whole
  // comparison evaluate to NULL, which Postgres CHECK treats as satisfied,
  // not violated) -- so these do not block the nullable rows described
  // above, only ever reject a populated component that's actually negative.
  check("results_participation_points_check", sql`${table.participationPoints} >= 0`),
  check("results_knockout_points_check", sql`${table.knockoutPoints} >= 0`),
  check("results_boss_bounty_points_check", sql`${table.bossBountyPoints} >= 0`),
  check("results_itm_points_check", sql`${table.itmPoints} >= 0`),

  // The core invariant this whole feature exists to guarantee. Same NULL
  // tolerance as above: a row with any component still NULL (i.e. not yet
  // backfilled) satisfies this trivially; once all five are populated
  // (new write, edit, or backfill), Postgres enforces they sum to the
  // already-frozen rating_points on every future write.
  check(
    "results_rating_points_breakdown_check",
    sql`${table.ratingPoints} = ${table.participationPoints} + ${table.knockoutPoints} + ${table.bossBountyPoints} + ${table.mysteryBountyPoints} + ${table.itmPoints}`,
  ),

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
