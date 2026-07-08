import { pgTable, uuid, text, date, boolean, timestamp, index, check } from "drizzle-orm/pg-core";
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
]);
