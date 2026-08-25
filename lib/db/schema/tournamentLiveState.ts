import { pgTable, uuid, integer, boolean, timestamp, primaryKey, uniqueIndex, index } from "drizzle-orm/pg-core";
import { players } from "./players";
import { tournaments } from "./tournaments";
import { registrations } from "./registrations";

// All three tables here model the *operational* state of a currently-running
// tournament, read/written together during live play and feeding the
// Google Sheets live-sync — matching the single, already-agreed
// TournamentLiveStateRepository that covers all of them (see
// docs/ARCHITECTURE_RULES.md, principle 2's stated exception). Kept in one
// schema file for the same reason, not split further.

export const tournamentLiveEntries = pgTable("tournament_live_entries", {
  id: uuid().primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  registrationId: uuid("registration_id").notNull().unique().references(() => registrations.id, { onDelete: "cascade" }),

  arrived: boolean().notNull().default(false),
  rebuys: integer().notNull().default(0),
  addons: integer().notNull().default(0),
  knockouts: integer().notNull().default(0),

  // Boss Bounty format: live count of Boss knockouts during play, mirrors
  // results.bossKnockouts once the tournament completes (sql/boss_bounty.sql
  // — ported into schema.ts as the source of truth).
  bossKnockouts: integer("boss_knockouts").notNull().default(0),

  place: integer(),
  sheetRowNumber: integer("sheet_row_number"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("tournament_live_entries_tournament_id_player_id_key").on(table.tournamentId, table.playerId),

  // tournament_live_entries_tournament_id_idx dropped — redundant with the
  // composite unique above (leftmost column already serves
  // findPlayerIdsWithLiveEntry's per-tournament lookup). player_id keeps
  // its own index: deleteLiveEntriesByPlayerId filters by player_id alone,
  // which the composite above does not cover (not the leftmost column).
  // registration_id needs no separate index either — .unique() already
  // creates one; the old schema had both a plain index and a unique
  // constraint on it (same redundancy pattern as players.telegram_id).
  index("tournament_live_entries_player_id_idx").on(table.playerId),
]);

export const tournamentPlayerEliminations = pgTable("tournament_player_eliminations", {
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  eliminated: boolean().notNull().default(false),
  eliminatedAt: timestamp("eliminated_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  // Composite PK, no surrogate id — the row has no identity beyond "this
  // player, in this tournament". Already correct in the old schema; kept
  // unchanged. Covers both existing query shapes (by tournament_id alone,
  // and by tournament_id + player_id) via leftmost-column — no extra index
  // needed despite the advisor flagging player_id as "unindexed FK".
  primaryKey({ columns: [table.tournamentId, table.playerId] }),
]);

// Live "Пришёл" state for a tournament currently in progress -- deliberately
// separate from both `registrations.status` (registration lifecycle:
// registered/waitlist/cancelled/attended -- "attended" there is set in bulk
// only at tournament completion, see completeTournamentFromLiveEntries /
// saveTournamentResults, and does NOT mean "physically checked in") and
// `results.arrived` (a frozen snapshot written once at completion, feeding
// the rating engine's field-size calculation -- see
// docs/RATING_BREAKDOWN_ANALYSIS.md). This table is the one place that is
// written the instant an admin toggles the checkbox, for every tournament
// kind (not gated to paid/cash the way tournament_live_entries is) --
// modelled 1:1 on tournamentPlayerEliminations directly above, same
// composite-PK / upsert shape, for the same reason: an operational flag on
// an in-progress tournament, independent of the registration and result
// lifecycles it will later feed into at completion time.
//
// Concurrency: NOT a versioned/optimistic-concurrency table. An earlier
// version of this schema added a client-supplied `write_seq` column to
// guard against out-of-order writes -- reverted (see
// lib/attendance-write-queue.ts's doc comment) because trusting a client
// device's wall clock as an authoritative ordering token is unsound (clock
// skew between an admin's own devices can make a genuinely later action
// look "older" and get silently rejected; a client could also send an
// arbitrarily large value and permanently block every future write for a
// player). Same-tab click ordering is instead guaranteed entirely
// client-side (AttendanceWriteQueue serializes writes per player, never
// more than one in flight). Across two different tabs/devices, the server
// applies plain last-processed-wins semantics -- acceptable for an
// admin-facing checkbox, per explicit product decision.
export const tournamentAttendance = pgTable("tournament_attendance", {
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  arrived: boolean().notNull().default(false),
  // Preserved across arrived=true -> false -> true (re-checking the box
  // keeps the original arrival time rather than rewriting history) -- see
  // setTournamentPlayerAttendance in features/tournaments.ts, same
  // convention already established for eliminatedAt above. Computed
  // atomically inside upsertAttendance's single SQL statement (COALESCE
  // against the row's own current value), not via a separate read -- so
  // this stays race-free even under genuinely concurrent cross-tab writes,
  // independent of the "last write wins" semantics for `arrived` itself.
  arrivedAt: timestamp("arrived_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  primaryKey({ columns: [table.tournamentId, table.playerId] }),
]);
