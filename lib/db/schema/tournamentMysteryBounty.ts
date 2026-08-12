import { pgTable, uuid, integer, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tournaments } from "./tournaments";

// Mystery Bounty snapshot — one row per tournament, created only when an
// admin closes Late Registration (see docs/MYSTERY_BOUNTY_RESEARCH.md §14).
// Row absence means Late Registration is still OPEN; its presence means
// CLOSED and the pool/envelope math below is frozen. Deliberately its own
// table rather than columns on `tournaments`: this is a one-time computed
// snapshot for a single tournament_type, not a property every tournament
// has (mirrors why tournament_live_entries/tournament_player_eliminations
// are their own table instead of columns on `tournaments`).
export const tournamentMysteryBounty = pgTable("tournament_mystery_bounty", {
  tournamentId: uuid("tournament_id")
    .primaryKey()
    .references(() => tournaments.id, { onDelete: "cascade" }),

  status: text().notNull().default("pending_envelopes"),

  playersCount: integer("players_count").notNull(),
  // Sum of the shared free-tournament "Re-buy" field across arrived
  // players — Google Sheets never stores initial entries and rebuys
  // separately, so this is each player's TOTAL entries (initial buy-in +
  // rebuys), not a rebuy count. rebuysCount below is the derived value
  // (total_entries_count - players_count, floored at 0) kept for
  // display/diagnostics; the pool formula uses totalEntriesCount directly
  // (see lib/mystery-bounty.ts).
  totalEntriesCount: integer("total_entries_count").notNull(),
  rebuysCount: integer("rebuys_count").notNull(),
  addonsCount: integer("addons_count").notNull(),
  activePlayersCount: integer("active_players_count").notNull(),

  mysteryPool: integer("mystery_pool").notNull(),
  envelopeCount: integer("envelope_count").notNull(),
  smallCount: integer("small_count").notNull(),
  smallValue: integer("small_value").notNull(),
  mediumCount: integer("medium_count").notNull(),
  mediumValue: integer("medium_value").notNull(),
  jackpotValue: integer("jackpot_value").notNull(),

  closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  recalculatedAt: timestamp("recalculated_at", { withTimezone: true }),
}, (table) => [
  check(
    "tournament_mystery_bounty_status_check",
    sql`${table.status} IN ('pending_envelopes', 'active')`,
  ),
  check("tournament_mystery_bounty_players_check", sql`${table.playersCount} >= 0`),
  check(
    "tournament_mystery_bounty_total_entries_check",
    sql`${table.totalEntriesCount} >= ${table.playersCount}`,
  ),
  check("tournament_mystery_bounty_active_players_check", sql`${table.activePlayersCount} >= 2`),
  check("tournament_mystery_bounty_pool_check", sql`${table.mysteryPool} >= 0`),
]);
