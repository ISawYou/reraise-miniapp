import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index, uniqueIndex, check, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tournaments } from "./tournaments";

// Durable idempotency ledger for POST /api/admin/tournaments/notify (real
// sends only -- a dry run never creates a row).
//
// Incident 2026-10-21/22: the admin UI's shared fetch helper auto-retried
// the mass-send POST after nginx returned 504 at 60s while the first
// request's Telegram loop was still running, so every recipient got the
// broadcast twice. The client generates one broadcast_id per confirmed send;
// the server claims it here with INSERT ... ON CONFLICT (broadcast_id) DO
// NOTHING BEFORE the first sendMessage, so at most one request ever runs the
// send loop for a given broadcast_id -- no matter how many times that
// request reaches the server, concurrently or later.
//
// Idempotency is keyed on broadcast_id ONLY -- never on message content. Two
// deliberately identical broadcasts (different broadcast_id) both go out.
//
// The message plaintext and the bot token are never stored: the
// payload_fingerprint is a sha256 over (tournamentId, audience, message,
// testMode, testTelegramId) used only to reject the same broadcast_id being
// reused for a DIFFERENT payload (409).
export const tournamentNotificationBroadcasts = pgTable("tournament_notification_broadcasts", {
  id: uuid().primaryKey().defaultRandom(),

  // Client-generated (crypto.randomUUID()), one per confirmed real send.
  broadcastId: uuid("broadcast_id").notNull(),

  payloadFingerprint: text("payload_fingerprint").notNull(),

  tournamentId: uuid("tournament_id").notNull(),
  audience: text().notNull(),
  testMode: boolean("test_mode").notNull().default(false),

  // processing: claimed; the send loop is (or was, if the process died)
  //             running. NEVER re-sent automatically -- a repeat request
  //             gets "already_processing", whether the original is still
  //             in flight or crashed mid-loop (fail closed: "possibly
  //             missed" beats "definitely duplicated").
  // completed:  the send loop finished; counts below are final and a repeat
  //             request is answered from them without sending anything.
  // failed:     an unexpected server error interrupted the loop after the
  //             claim; some recipients may already have received it. Manual
  //             review only -- never re-sent under the same broadcast_id.
  status: text().notNull().default("processing"),

  totalRecipients: integer("total_recipients").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),

  // Per-recipient failure summary (player_id / telegram_id / display_name /
  // normalized Telegram error) exactly as the route already returns it, so a
  // repeat request after completion can return the stored result verbatim.
  errors: jsonb().notNull().default(sql`'[]'::jsonb`),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  // Explicit name: the auto-generated one exceeds Postgres' 63-char limit.
  foreignKey({
    name: "tournament_notification_broadcasts_tournament_fk",
    columns: [table.tournamentId],
    foreignColumns: [tournaments.id],
  }).onDelete("cascade"),
  check(
    "tournament_notification_broadcasts_status_check",
    sql`${table.status} IN ('processing', 'completed', 'failed')`,
  ),
  check(
    "tournament_notification_broadcasts_audience_check",
    sql`${table.audience} IN ('registered', 'access')`,
  ),

  // THE idempotency guarantee: the atomic claim relies on this constraint.
  uniqueIndex("tournament_notification_broadcasts_broadcast_id_key").on(table.broadcastId),
  index("tournament_notification_broadcasts_tournament_idx").on(table.tournamentId, table.createdAt),
]);
