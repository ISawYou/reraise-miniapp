import "server-only";

import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
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

// ---------------------------------------------------------------------------
// Global "Неявки игроков" admin surface (app/admin/no-shows/page.tsx, via
// the authorized Server Actions in features/no-show-admin-actions.ts).
// ---------------------------------------------------------------------------

// One row per player with a no-show history and/or an active online-
// registration restriction. Deliberately minimal (no telegram id, email,
// username or any other PII beyond what the tournament roster already
// shows staff): avatar + preferred nickname + derived counters.
export type NoShowPlayerSummary = {
  player_id: string;
  nickname: string;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
  // DERIVED: COUNT(registrations WHERE no_show_at IS NOT NULL) -- the ONLY
  // no-show history there is (no counter column exists anywhere).
  no_show_count: number;
  // MAX(registrations.no_show_at), ISO, or null.
  last_no_show_at: string | null;
  online_registration_restricted: boolean;
};

function preferredNickname(adminDisplayName: string | null, displayName: string | null): string {
  return adminDisplayName?.trim() || displayName?.trim() || "Игрок";
}

// ONE aggregate query for the whole page (no N+1): a grouped no-show
// history subquery LEFT JOINed onto players, keeping every player that has
// at least one historical no-show OR a currently active restriction (the
// latter so a restriction whose history row was removed by older code can
// still be lifted from here). Merged-away tombstone accounts are excluded
// -- they can never register. Ordered: restricted first, then most recent
// no-show, then most no-shows.
export async function listNoShowPlayerSummaries(): Promise<NoShowPlayerSummary[]> {
  if (process.env.DATABASE_PROVIDER !== "postgres") {
    return [];
  }

  const history = db
    .select({
      playerId: registrations.playerId,
      noShowCount: sql<number>`count(*)::int`.as("no_show_count"),
      lastNoShowAt: sql<Date | string | null>`max(${registrations.noShowAt})`.as("last_no_show_at"),
    })
    .from(registrations)
    .where(isNotNull(registrations.noShowAt))
    .groupBy(registrations.playerId)
    .as("no_show_history");

  const rows = await db
    .select({
      id: players.id,
      adminDisplayName: players.adminDisplayName,
      displayName: players.displayName,
      telegramAvatarUrl: players.telegramAvatarUrl,
      customAvatarUrl: players.customAvatarUrl,
      restrictedAt: players.onlineRegistrationRestrictedAt,
      noShowCount: history.noShowCount,
      lastNoShowAt: history.lastNoShowAt,
    })
    .from(players)
    .leftJoin(history, eq(history.playerId, players.id))
    .where(
      and(
        isNull(players.mergedIntoPlayerId),
        or(isNotNull(history.playerId), isNotNull(players.onlineRegistrationRestrictedAt))
      )
    )
    .orderBy(
      sql`(${players.onlineRegistrationRestrictedAt} is null)`,
      sql`${history.lastNoShowAt} desc nulls last`,
      sql`${history.noShowCount} desc nulls last`,
      players.id
    );

  return rows.map((row) => ({
    player_id: row.id,
    nickname: preferredNickname(row.adminDisplayName, row.displayName),
    telegram_avatar_url: row.telegramAvatarUrl ?? null,
    custom_avatar_url: row.customAvatarUrl ?? null,
    no_show_count: row.noShowCount == null ? 0 : Number(row.noShowCount),
    last_no_show_at: toIso(row.lastNoShowAt),
    online_registration_restricted: row.restrictedAt != null,
  }));
}

export type ClearRestrictionResult = { cleared: boolean };

// "Разрешить обычную запись" -- FUTURE registration policy only. Clears
// exactly players.online_registration_restricted_at and nothing else:
//   - registrations.no_show_at history is never touched (count stays);
//   - no result, rating or attendance row is touched;
//   - no registration is admitted/promoted anywhere. A quarantined no-show
//     row in a CURRENT tournament stays quarantined, because automatic
//     promotion independently skips any row with its own no_show_at (see
//     features/tournament-waitlist-capacity.ts, NO-SHOW QUARANTINE).
// No tournament-row lock is needed: this changes no seat and promotes
// nothing; the reconciler reads the restriction under its own lock, and
// even a racing reconcile can't promote a quarantined row.
export async function clearPlayerOnlineRegistrationRestriction(
  playerId: string
): Promise<ClearRestrictionResult> {
  if (process.env.DATABASE_PROVIDER !== "postgres") {
    return { cleared: false };
  }
  const rows = await db
    .update(players)
    .set({ onlineRegistrationRestrictedAt: null })
    .where(and(eq(players.id, playerId), isNotNull(players.onlineRegistrationRestrictedAt)))
    .returning({ id: players.id });
  return { cleared: rows.length > 0 };
}

// THIS registration's no_show_at (or null) -- lets the penalty-free
// "Удалить" correction keep no-show history instead of hard-deleting it
// (see features/tournaments.ts::removeAdminTournamentParticipant). Always
// null outside DATABASE_PROVIDER=postgres, where no_show_at is never set.
export async function findRegistrationNoShowAt(registrationId: string): Promise<Date | null> {
  if (process.env.DATABASE_PROVIDER !== "postgres") {
    return null;
  }
  const rows = await db
    .select({ noShowAt: registrations.noShowAt })
    .from(registrations)
    .where(eq(registrations.id, registrationId))
    .limit(1);
  return rows[0]?.noShowAt ?? null;
}
