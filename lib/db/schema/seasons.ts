import { pgTable, uuid, text, date, boolean, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const seasons = pgTable("seasons", {
  id: uuid().primaryKey().defaultRandom(),
  title: text().notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("seasons_title_length", sql`char_length(${table.title}) BETWEEN 1 AND 100`),
  index("seasons_is_active_idx").on(table.isActive),
  // At most one ACTIVE season, enforced at the DB level -- a partial unique
  // index (same pattern as dealer_shifts_one_open_per_dealer in
  // lib/db/schema/dealers.ts) that only applies to rows where is_active is
  // true, so any number of inactive/archived seasons coexist freely.
  // Season rollover (deactivate old + activate next) must therefore happen
  // old-first-then-new within one transaction, or this index rejects the
  // moment two rows would both be active at once.
  uniqueIndex("seasons_one_active_key")
    .on(table.isActive)
    .where(sql`${table.isActive} = true`),
]);
