import { pgTable, uuid, text, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { players } from "./players";

export const emailOtpCodes = pgTable("email_otp_codes", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull(),
  purpose: text().notNull(),
  // Nullable: an OTP can exist before the player row does (email-login flow
  // creates the code first, the player only once the code is verified).
  playerId: uuid("player_id").references(() => players.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  resendAfterAt: timestamp("resend_after_at", { withTimezone: true }).notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  check("email_otp_codes_purpose_check", sql`${table.purpose} IN ('login', 'link_email')`),

  index("email_otp_codes_active_idx").on(table.email, table.purpose, table.consumedAt, table.expiresAt),
  index("email_otp_codes_email_purpose_idx").on(table.email, table.purpose, table.createdAt),
  index("email_otp_codes_expires_at_idx").on(table.expiresAt),

  // New: the FK on player_id had zero covering index in the old schema
  // (advisor-flagged `unindexed_foreign_keys`) — no repository method
  // queries by player_id today, but an index still speeds up the
  // ON DELETE CASCADE lookup when a player row is deleted.
  index("email_otp_codes_player_id_idx").on(table.playerId),
]);
