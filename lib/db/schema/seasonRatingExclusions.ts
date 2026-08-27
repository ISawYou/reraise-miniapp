import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { players } from "./players";
import { seasons } from "./seasons";

// "Вне зачёта" -- a player who keeps earning rating_points normally but is
// excluded from OFFICIAL seasonal competitive standing (TOP-9 qualification,
// Number One). Deliberately season-scoped, not a global players.* flag: a
// player excluded this month may be eligible next month, and closing this
// season must never retroactively change a past season's standings. Absence
// of a row = eligible (the common case, no backfill needed). Never
// automatically derived from dealer_profiles or players.role -- this is
// always an explicit Super Admin decision (see features/rating-eligibility.ts).
export const seasonRatingExclusions = pgTable("season_rating_exclusions", {
  id: uuid().primaryKey().defaultRandom(),

  seasonId: uuid("season_id").notNull().references(() => seasons.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),

  // Who excluded them -- admin-only metadata, never shown to players.
  // Nullable/set-null: an already-deleted admin account must not block
  // reads or cascade-delete the exclusion itself.
  createdByPlayerId: uuid("created_by_player_id").references(() => players.id, { onDelete: "set null" }),
  reason: text("reason"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // One exclusion per (season, player) -- the presence/absence of this row
  // IS the eligibility flag, so a duplicate would be meaningless.
  uniqueIndex("season_rating_exclusions_season_player_idx").on(table.seasonId, table.playerId),
  index("season_rating_exclusions_season_id_idx").on(table.seasonId),
]);
