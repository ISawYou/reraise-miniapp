import "server-only";

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { players, registrations } from "@/lib/db/schema";

// Read side of the no-show waitlist policy (the write side -- "Не пришёл",
// "Допустить в игру", arrival clearing -- lives in
// features/tournament-waitlist-capacity.ts under the tournament-row lock).
//
// ADMIN SURFACE ONLY. The no-show COUNT is always DERIVED from
// registrations.no_show_at -- there is no counter column to drift.
//
// Batched: exactly two queries for an entire participant list (one
// aggregate over registrations, one over players), never one per row.
// Indexes: both queries filter on player_id IN (...), served by the
// existing registrations_player_id_idx / the players primary key -- no new
// index is needed for this shape.

export type AdminNoShowPolicyState = {
  no_show_count: number;
  online_registration_restricted: boolean;
  // THIS tournament's registration no_show_at (ISO), or null.
  no_show_at: string | null;
};

function toIso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function getAdminNoShowPolicyState(
  tournamentId: string,
  playerIds: string[]
): Promise<Map<string, AdminNoShowPolicyState>> {
  const result = new Map<string, AdminNoShowPolicyState>();
  const uniqueIds = Array.from(new Set(playerIds));

  // A no-show/restriction can only ever be written under
  // DATABASE_PROVIDER=postgres -- elsewhere everyone has a clean record.
  if (uniqueIds.length === 0 || process.env.DATABASE_PROVIDER !== "postgres") {
    return result;
  }

  const historyRows = await db
    .select({
      playerId: registrations.playerId,
      noShowCount: sql<number>`count(*)::int`,
      thisTournamentNoShowAt: sql<Date | string | null>`max(${registrations.noShowAt}) filter (where ${registrations.tournamentId} = ${tournamentId})`,
    })
    .from(registrations)
    .where(and(inArray(registrations.playerId, uniqueIds), isNotNull(registrations.noShowAt)))
    .groupBy(registrations.playerId);

  const restrictedRows = await db
    .select({ id: players.id })
    .from(players)
    .where(and(inArray(players.id, uniqueIds), isNotNull(players.onlineRegistrationRestrictedAt)));

  const historyByPlayer = new Map(historyRows.map((row) => [row.playerId, row]));
  const restricted = new Set(restrictedRows.map((row) => row.id));

  for (const playerId of uniqueIds) {
    const history = historyByPlayer.get(playerId);
    result.set(playerId, {
      no_show_count: history ? Number(history.noShowCount) : 0,
      online_registration_restricted: restricted.has(playerId),
      no_show_at: toIso(history?.thisTournamentNoShowAt),
    });
  }

  return result;
}

// The current player's own restriction state -- only for the player-facing
// registration hint. Takes the already-authenticated player's id (see
// features/tournaments.ts's session-bound getMyOnlineRegistrationRestriction); never
// exposes anything about any other player.
export async function isPlayerOnlineRegistrationRestricted(playerId: string): Promise<boolean> {
  if (process.env.DATABASE_PROVIDER !== "postgres") {
    return false;
  }
  const rows = await db
    .select({ id: players.id, restrictedAt: players.onlineRegistrationRestrictedAt })
    .from(players)
    .where(and(eq(players.id, playerId), isNotNull(players.onlineRegistrationRestrictedAt)));
  return rows.some((row) => row.id === playerId && row.restrictedAt != null);
}
