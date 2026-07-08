import { pgTable, uuid, text, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { players } from "./players";
import { tournaments } from "./tournaments";

export const registrations = pgTable("registrations", {
  id: uuid().primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
  status: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("registrations_status_check", sql`${table.status} IN ('registered', 'waitlist', 'cancelled', 'attended')`),

  uniqueIndex("registrations_player_id_tournament_id_key").on(table.playerId, table.tournamentId),

  // Three duplicate pairs collapsed to one index each (see audit section 5:
  // idx_registrations_player_id/registrations_player_id_idx,
  // idx_registrations_status/registrations_status_idx,
  // idx_registrations_tournament_id/registrations_tournament_id_idx were
  // byte-identical in the old schema).
  index("registrations_player_id_idx").on(table.playerId),
  index("registrations_status_idx").on(table.status),
  index("registrations_tournament_id_idx").on(table.tournamentId),

  // New: RegistrationRepository.findExportParticipants /
  // findAdminParticipants / findLiveEligible / findNotificationRecipients
  // all filter tournament_id + status together — a composite index serves
  // that shape directly instead of Postgres combining two single-column
  // indexes via BitmapAnd.
  index("registrations_tournament_id_status_idx").on(table.tournamentId, table.status),
]);
