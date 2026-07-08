import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// key IS the primary key — a natural key, not a generic uuid entity. Values
// are arbitrary per-key shape (genuinely a key-value store), so `value`
// stays untyped jsonb rather than a fixed interface.
export const appSettings = pgTable("app_settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
