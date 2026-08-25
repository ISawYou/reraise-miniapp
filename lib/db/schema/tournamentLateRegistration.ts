import { check, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tournaments } from "./tournaments";
import type { RatingPlace } from "@/types/domain";

// Generic immutable-ish snapshot created when Late Registration closes for
// any kind='free' tournament. The rating-place array is the authoritative
// placement component used later by completion; live attendance/rebuy state
// may keep changing, but it never mutates this row implicitly.
export const tournamentLateRegistration = pgTable("tournament_late_registration", {
  tournamentId: uuid("tournament_id")
    .primaryKey()
    .references(() => tournaments.id, { onDelete: "cascade" }),
  arrivedPlayersCount: integer("arrived_players_count").notNull(),
  initialStacksCount: integer("initial_stacks_count").notNull(),
  totalEntriesCount: integer("total_entries_count").notNull(),
  rebuysCount: integer("rebuys_count").notNull(),
  addonsCount: integer("addons_count").notNull(),
  tournamentType: text("tournament_type").notNull(),
  ratingFormulaVersion: text("rating_formula_version").notNull(),
  ratingGuarantee: integer("rating_guarantee"),
  ratingPlaces: jsonb("rating_places").$type<RatingPlace[]>().notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check(
    "tournament_late_registration_arrived_players_check",
    sql`${table.arrivedPlayersCount} > 0`,
  ),
  check(
    "tournament_late_registration_initial_stacks_check",
    sql`${table.initialStacksCount} >= 0 AND ${table.initialStacksCount} <= ${table.arrivedPlayersCount}`,
  ),
  check(
    "tournament_late_registration_entries_check",
    sql`${table.totalEntriesCount} >= 0 AND ${table.rebuysCount} >= 0 AND ${table.addonsCount} >= 0`,
  ),
  check(
    "tournament_late_registration_formula_check",
    sql`${table.ratingFormulaVersion} IN ('legacy', 'v2')`,
  ),
  check(
    "tournament_late_registration_guarantee_check",
    sql`${table.ratingGuarantee} IS NULL OR ${table.ratingGuarantee} >= 0`,
  ),
  check(
    "tournament_late_registration_places_check",
    sql`jsonb_typeof(${table.ratingPlaces}) = 'array'`,
  ),
]);
