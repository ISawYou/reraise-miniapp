import { pgTable, uuid, integer, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { players } from "./players";
import { tournaments } from "./tournaments";

// Admin Shifts V1 -- a SEPARATE model from dealer_shifts (lib/db/schema/dealers.ts),
// deliberately not generalized onto it: dealer shifts are hourly-rate-driven
// (worked_minutes/paid_hours/hourly_rate_rub all feed a computed amount_rub),
// while an admin shift is flat-payout -- amount_rub is simply stored, set to
// a default at creation and never derived from elapsed time. Bolting this
// onto dealer_shifts would mean nulling out its hourly-specific columns and
// weakening its CHECK constraints for a case that doesn't need them.
//
// Any player with role 'operator' or 'admin' (see lib/roles.ts) may start
// their own shift -- unlike dealer_profiles, there is no separate
// "activation" row: staff status IS the eligibility, enforced at the
// route/feature layer (features/admin-shifts.ts), not by a profile table.
export const adminShifts = pgTable("admin_shifts", {
  id: uuid().primaryKey().defaultRandom(),
  adminPlayerId: uuid("admin_player_id").notNull().references(() => players.id, { onDelete: "cascade" }),

  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),

  // Flat payout, stored on the shift itself at creation time (default
  // 4000 RUB -- see features/admin-shifts.ts's DEFAULT_ADMIN_SHIFT_AMOUNT_RUB).
  // Changing the application default in the future must NEVER retroactively
  // change an already-created shift's amount -- there is deliberately no
  // "current default" lookup anywhere in the read path, only this column.
  // A Super Admin may later apply an explicit correction (trainee shift,
  // shortened shift, exceptional payout) via updatedByPlayerId/updatedAt
  // below -- never automatically recomputed.
  amountRub: integer("amount_rub").notNull().default(4000),

  // Which tournament this shift worked, if any -- nullable, same
  // "Без турнира is legitimate, never invented" convention as
  // dealer_shifts.tournamentId. ON DELETE SET NULL: removing a tournament
  // must never cascade into deleting payroll history.
  tournamentId: uuid("tournament_id").references(() => tournaments.id, { onDelete: "set null" }),

  // Actor identity -- all nullable: a shift opened before this column
  // existed, or an already-deleted admin account, must not block reads.
  createdByPlayerId: uuid("created_by_player_id").references(() => players.id, { onDelete: "set null" }),
  endedByPlayerId: uuid("ended_by_player_id").references(() => players.id, { onDelete: "set null" }),
  // Set only when a Super Admin explicitly corrects amount_rub -- null
  // means "still the value set at creation, never corrected".
  updatedByPlayerId: uuid("updated_by_player_id").references(() => players.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  // At most one OPEN shift per admin, enforced at the DB level -- same
  // partial-unique-index pattern as dealer_shifts_one_open_per_dealer.
  uniqueIndex("admin_shifts_one_open_per_admin")
    .on(table.adminPlayerId)
    .where(sql`${table.endedAt} IS NULL`),

  index("admin_shifts_tournament_id_idx").on(table.tournamentId),

  check("admin_shifts_amount_check", sql`${table.amountRub} >= 0`),
  check("admin_shifts_ended_after_started_check", sql`${table.endedAt} IS NULL OR ${table.endedAt} >= ${table.startedAt}`),
]);
