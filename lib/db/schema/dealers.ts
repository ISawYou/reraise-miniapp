import { pgTable, uuid, integer, boolean, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { players } from "./players";

// Dealer Payroll V1. A dealer is still an ordinary `players` row (see
// players.ts's `role` column, deliberately untouched -- 'player' | 'admin'
// only) -- this is an ADDITIONAL staff designation, not a third role.
// `dealer_profiles` records "this player is currently staff"; deactivating
// a dealer never deletes their row, only flips `is_active`, so `player_id`
// stays a stable, reusable anchor for all their historical shifts even
// after they stop dealing.
export const dealerProfiles = pgTable("dealer_profiles", {
  playerId: uuid("player_id").primaryKey().references(() => players.id, { onDelete: "cascade" }),

  isActive: boolean("is_active").notNull().default(true),

  // Snapshot-on-shift-start convention below (dealerShifts.hourlyRateRub)
  // is what actually prices a shift -- this column is only the CURRENT
  // rate offered to future shifts. Changing it here must never touch an
  // already-started/completed shift.
  hourlyRateRub: integer("hourly_rate_rub").notNull().default(500),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  check("dealer_profiles_hourly_rate_check", sql`${table.hourlyRateRub} >= 0`),
]);

// One payroll unit per worked shift. `hourlyRateRub` is snapshotted from
// dealerProfiles at shift-start time -- deliberately duplicated here (not
// a join) so a later rate change on the profile can never retroactively
// recalculate a historical shift's amount, matching the task's explicit
// "historical shifts must never recalculate" requirement.
//
// worked_minutes/paid_hours/amount_rub are nullable and stay null while
// the shift is open (ended_at IS NULL) -- they are computed and frozen
// server-side exactly once, at the moment the shift ends (or is later
// corrected via an admin edit to started_at/ended_at, which always
// recalculates from the timestamps, never accepts a client-submitted
// total). See features/dealers.ts's computeShiftPayroll.
export const dealerShifts = pgTable("dealer_shifts", {
  id: uuid().primaryKey().defaultRandom(),
  dealerPlayerId: uuid("dealer_player_id").notNull().references(() => players.id, { onDelete: "cascade" }),

  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),

  hourlyRateRub: integer("hourly_rate_rub").notNull(),
  workedMinutes: integer("worked_minutes"),
  paidHours: integer("paid_hours"),
  amountRub: integer("amount_rub"),

  // Admin identity for the two actions that create/close a shift -- both
  // nullable: a shift opened before this column existed, or an
  // already-deleted admin account, must not block reads. Not exposed
  // anywhere player-facing.
  createdByPlayerId: uuid("created_by_player_id").references(() => players.id, { onDelete: "set null" }),
  endedByPlayerId: uuid("ended_by_player_id").references(() => players.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  // At most one OPEN shift per dealer, enforced at the DB level (not just
  // in application code) -- a partial unique index that only applies to
  // rows where ended_at IS NULL, so any number of completed shifts for the
  // same dealer coexist freely.
  uniqueIndex("dealer_shifts_one_open_per_dealer")
    .on(table.dealerPlayerId)
    .where(sql`${table.endedAt} IS NULL`),

  check("dealer_shifts_hourly_rate_check", sql`${table.hourlyRateRub} >= 0`),
  check("dealer_shifts_worked_minutes_check", sql`${table.workedMinutes} IS NULL OR ${table.workedMinutes} > 0`),
  check("dealer_shifts_paid_hours_check", sql`${table.paidHours} IS NULL OR ${table.paidHours} > 0`),
  check("dealer_shifts_amount_check", sql`${table.amountRub} IS NULL OR ${table.amountRub} >= 0`),
  check("dealer_shifts_ended_after_started_check", sql`${table.endedAt} IS NULL OR ${table.endedAt} > ${table.startedAt}`),
]);
