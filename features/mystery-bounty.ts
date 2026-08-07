"use server";

// Mystery Bounty — Late Registration close / envelope activation / recalc.
// Built entirely on top of the existing free-tournament flow (see
// docs/MYSTERY_BOUNTY_RESEARCH.md §13): `tournament_type: "mystery_bounty"`
// tournaments stay `kind: "free"`, so "Players" (arrived) come from the
// admin's current results-screen roster, exactly like knockouts/rebuys do
// for every other free-tournament type today — there is no persistent
// "arrived" row for free tournaments to read instead.
import {
  tournamentRepository,
  tournamentMysteryBountyRepository,
  tournamentLiveStateRepository,
} from "@/lib/repositories";
import type { MysteryBountyRow } from "@/lib/repositories";
import {
  computeEnvelopeDistribution,
  computeMysteryPool,
  type EnvelopeBreakdown,
} from "@/lib/mystery-bounty";
import type { MysteryBountySnapshot } from "@/types/domain";

export type MysteryBountyRosterRow = {
  player_id: string;
  arrived: boolean;
  rebuys: number;
  addons: number;
  mystery_bounty_points?: number;
};

function mapRow(row: MysteryBountyRow): MysteryBountySnapshot {
  return {
    tournament_id: row.tournament_id,
    // A snapshot row only ever exists once Late Registration has been
    // closed (see lib/db/schema/tournamentMysteryBounty.ts) — its absence
    // is what represents "still open", handled by getMysteryBountySnapshot
    // returning null rather than a row with this field set to "open".
    late_registration_status: "closed",
    status: row.status,
    players_count: row.players_count,
    rebuys_count: row.rebuys_count,
    addons_count: row.addons_count,
    active_players_count: row.active_players_count,
    mystery_pool: row.mystery_pool,
    envelope_count: row.envelope_count,
    small_count: row.small_count,
    small_value: row.small_value,
    medium_count: row.medium_count,
    medium_value: row.medium_value,
    jackpot_value: row.jackpot_value,
    closed_at: row.closed_at,
    activated_at: row.activated_at,
    recalculated_at: row.recalculated_at,
  };
}

async function assertMysteryBountyTournament(tournamentId: string) {
  const tournament = await tournamentRepository.findById(tournamentId);

  if (tournament.tournament_type !== "mystery_bounty") {
    throw new Error("Турнир не является Mystery Bounty");
  }

  return tournament;
}

// Active = arrived && not currently eliminated, read straight from the
// persisted flag. Bust -> rebuy -> active again is deliberately NOT
// re-derived here from "rebuys > 0" — that was tried and is wrong: it's a
// static condition, re-true on every subsequent close/recalculate call, so
// a player marked "Выбыл" a second time (with rebuys unchanged from the
// first bust) would get silently un-eliminated again on the next
// recalculate. The correction belongs at the point a rebuy is actually
// entered (an increase event), not as a standing formula — see
// app/admin/results/[id]/page.tsx's updateFreeRow, which calls the same
// /eliminate endpoint the "Выбыл" checkbox uses the moment rebuys goes up
// for a currently-eliminated player. By the time rows reach this feature,
// tournament_player_eliminations is already the correct, current truth.
async function getActivePlayerIds(
  tournamentId: string,
  arrivedRows: MysteryBountyRosterRow[]
): Promise<Set<string>> {
  const eliminations = await tournamentLiveStateRepository.findEliminationsByTournamentId(
    tournamentId
  );

  const activePlayerIds = new Set(
    arrivedRows
      .filter((row) => !(eliminations.get(row.player_id)?.eliminated ?? false))
      .map((row) => row.player_id)
  );

  return activePlayerIds;
}

type ComputedSnapshotInputs = {
  playersCount: number;
  rebuysCount: number;
  addonsCount: number;
  activePlayersCount: number;
  mysteryPool: number;
  breakdown: EnvelopeBreakdown;
};

async function computeSnapshotInputs(
  tournamentId: string,
  rows: MysteryBountyRosterRow[]
): Promise<ComputedSnapshotInputs> {
  const arrivedRows = rows.filter((row) => row.arrived);
  const uniqueArrivedPlayerIds = new Set(arrivedRows.map((row) => row.player_id));
  const playersCount = uniqueArrivedPlayerIds.size;
  const rebuysCount = arrivedRows.reduce((sum, row) => sum + Math.max(0, row.rebuys), 0);
  const addonsCount = arrivedRows.reduce((sum, row) => sum + Math.max(0, row.addons), 0);

  const activePlayerIds = await getActivePlayerIds(tournamentId, arrivedRows);
  const activePlayersCount = activePlayerIds.size;

  if (activePlayersCount < 2) {
    throw new Error(
      `Mystery Bounty: недостаточно активных игроков (${activePlayersCount}) — нужно минимум 2`
    );
  }

  const mysteryPool = computeMysteryPool({
    players: playersCount,
    rebuys: rebuysCount,
    addons: addonsCount,
  });
  const breakdown = computeEnvelopeDistribution(mysteryPool, activePlayersCount);

  return { playersCount, rebuysCount, addonsCount, activePlayersCount, mysteryPool, breakdown };
}

export async function getMysteryBountySnapshot(
  tournamentId: string
): Promise<MysteryBountySnapshot | null> {
  const row = await tournamentMysteryBountyRepository.findByTournamentId(tournamentId);
  return row ? mapRow(row) : null;
}

export async function closeMysteryBountyLateRegistration(
  tournamentId: string,
  rows: MysteryBountyRosterRow[]
): Promise<MysteryBountySnapshot> {
  const tournament = await assertMysteryBountyTournament(tournamentId);

  if (tournament.status === "completed") {
    throw new Error("Турнир уже завершён — Mystery Bounty больше нельзя изменять");
  }

  const existing = await tournamentMysteryBountyRepository.findByTournamentId(tournamentId);
  if (existing) {
    throw new Error(
      "Late Registration уже закрыта для этого турнира. Используйте «Пересчитать Mystery Bounty»."
    );
  }

  const { playersCount, rebuysCount, addonsCount, activePlayersCount, mysteryPool, breakdown } =
    await computeSnapshotInputs(tournamentId, rows);

  const row = await tournamentMysteryBountyRepository.insert({
    tournament_id: tournamentId,
    status: "pending_envelopes",
    players_count: playersCount,
    rebuys_count: rebuysCount,
    addons_count: addonsCount,
    active_players_count: activePlayersCount,
    mystery_pool: mysteryPool,
    envelope_count: breakdown.envelopeCount,
    small_count: breakdown.smallCount,
    small_value: breakdown.smallValue,
    medium_count: breakdown.mediumCount,
    medium_value: breakdown.mediumValue,
    jackpot_value: breakdown.jackpotValue,
  });

  return mapRow(row);
}

export async function activateMysteryBounty(
  tournamentId: string
): Promise<MysteryBountySnapshot> {
  const tournament = await assertMysteryBountyTournament(tournamentId);

  if (tournament.status === "completed") {
    throw new Error("Турнир уже завершён — Mystery Bounty больше нельзя изменять");
  }

  const existing = await tournamentMysteryBountyRepository.findByTournamentId(tournamentId);
  if (!existing) {
    throw new Error("Late Registration ещё не закрыта — сначала закройте регистрацию");
  }

  if (existing.status === "active") {
    return mapRow(existing);
  }

  const row = await tournamentMysteryBountyRepository.update(tournamentId, {
    status: "active",
    activated_at: new Date().toISOString(),
  });

  return mapRow(row);
}

export async function recalculateMysteryBounty(
  tournamentId: string,
  rows: MysteryBountyRosterRow[]
): Promise<MysteryBountySnapshot> {
  const tournament = await assertMysteryBountyTournament(tournamentId);

  // Guards against exactly the gap a reload exposes: for free tournaments,
  // per-player Bounty Points only ever live in this request's `rows` (no
  // durable store between activation and completion without Google
  // Sheets — see docs/MYSTERY_BOUNTY_RESEARCH.md). After completion,
  // `rows` from a freshly-reloaded page is the untouched draft (all
  // zeros), which would silently defeat the "already awarded" check below
  // even though `results.mystery_bounty_points` is already frozen in the
  // DB. Once completed, the snapshot must never change again regardless
  // of what the client submits.
  if (tournament.status === "completed") {
    throw new Error("Турнир уже завершён — Mystery Bounty больше нельзя изменять");
  }

  const existing = await tournamentMysteryBountyRepository.findByTournamentId(tournamentId);
  if (!existing) {
    throw new Error("Late Registration ещё не закрыта — пересчитывать нечего");
  }

  const alreadyAwarded = rows.some((row) => (row.mystery_bounty_points ?? 0) > 0);
  if (alreadyAwarded) {
    throw new Error(
      "Пересчёт запрещён: у игроков уже есть выданные Mystery Bounty очки — физические конверты уже вскрываются"
    );
  }

  const { playersCount, rebuysCount, addonsCount, activePlayersCount, mysteryPool, breakdown } =
    await computeSnapshotInputs(tournamentId, rows);

  const row = await tournamentMysteryBountyRepository.update(tournamentId, {
    status: "pending_envelopes",
    players_count: playersCount,
    rebuys_count: rebuysCount,
    addons_count: addonsCount,
    active_players_count: activePlayersCount,
    mystery_pool: mysteryPool,
    envelope_count: breakdown.envelopeCount,
    small_count: breakdown.smallCount,
    small_value: breakdown.smallValue,
    medium_count: breakdown.mediumCount,
    medium_value: breakdown.mediumValue,
    jackpot_value: breakdown.jackpotValue,
    activated_at: null,
    recalculated_at: new Date().toISOString(),
  });

  return mapRow(row);
}
