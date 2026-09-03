import { pgTable, uuid, text, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { players } from "./players";
import { emailOtpCodes } from "./emailOtpCodes";

// Created the moment app/api/auth/email/verify-code/route.ts discovers that
// a successfully-verified link_email OTP's email belongs to a different
// player than the caller's own verified session. The OTP already proved
// ownership of the email (email_otp_codes.consumed_at) -- this row is what
// turns that proof into a one-time, expiring, server-issued token the
// client can present to POST /api/auth/email/merge, instead of the client
// ever supplying a target/source player id itself. Ported from Sterling
// (spb-poker commit 770ce78d, feat(account-merge)) -- same shape, same
// invariants; see lib/player-merge.ts for the reconciliation semantics.
export const playerMergeIntents = pgTable("player_merge_intents", {
  id: uuid().primaryKey().defaultRandom(),

  // The canonical/surviving account -- always the caller's own verified
  // session at intent-creation time. Never touched by any later request's
  // own claims; re-derived from the session on execute too.
  targetPlayerId: uuid("target_player_id").notNull().references(() => players.id, { onDelete: "cascade" }),

  // The account whose email the caller just proved ownership of via OTP.
  sourcePlayerId: uuid("source_player_id").notNull().references(() => players.id, { onDelete: "cascade" }),

  email: text().notNull(),

  // Proof this intent is backed by a real, hash-gated OTP verification --
  // not merely "the client asserted it". Nullable only because the OTP row
  // itself is nullable-on-delete elsewhere; this intent should never be
  // actionable without one, enforced at the application layer.
  otpVerificationId: uuid("otp_verification_id").references(() => emailOtpCodes.id, { onDelete: "set null" }),

  // pending: awaiting user confirmation, self-service-eligible.
  // conflict: overlapping tournament history (or source has its own
  //           telegram_id) detected -- routed to /admin/account-merges,
  //           never executable via the self-service endpoint.
  // completed: merge transaction committed.
  // expired: pending intent's expiresAt passed without confirmation.
  // cancelled: reserved for a future explicit decline action -- no code
  //            path sets this yet.
  status: text().notNull().default("pending"),

  // Populated when status flips to 'conflict' -- shown verbatim to the
  // admin queue, not the end user (the end user only ever sees "needs
  // admin review").
  conflictReason: text("conflict_reason"),

  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (table) => [
  check(
    "player_merge_intents_status_check",
    sql`${table.status} IN ('pending', 'conflict', 'completed', 'expired', 'cancelled')`,
  ),
  check("player_merge_intents_not_self", sql`${table.targetPlayerId} != ${table.sourcePlayerId}`),

  index("player_merge_intents_target_idx").on(table.targetPlayerId),
  index("player_merge_intents_source_idx").on(table.sourcePlayerId),
  index("player_merge_intents_status_idx").on(table.status),

  // At most one live pending intent per (target, source) pair -- a retried
  // request re-triggers the same conflict rather than piling up duplicate
  // rows the admin queue would need to de-dupe itself.
  uniqueIndex("player_merge_intents_pending_unique")
    .on(table.targetPlayerId, table.sourcePlayerId)
    .where(sql`${table.status} = 'pending'`),
]);
