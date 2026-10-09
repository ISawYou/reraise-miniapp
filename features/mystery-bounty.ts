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
import type { MysteryBountyInsert, MysteryBountyRow } from "@/lib/repositories";
import { tournamentMysteryBounty } from "@/lib/db/schema";
import {
  computeEnvelopeDistribution,
  computeMysteryPool,
  computeRebuys,
  type EnvelopeBreakdown,
} from "@/lib/mystery-bounty";
import type { MysteryBountySnapshot, RatingFormulaVersion } from "@/types/domain";

// Pre-v2 Mystery Pool formula (Total Entries x6 + Addons x12, ceil to 10) --
// kept only so a Mystery Bounty tournament whose rating_formula_version is
// still "legacy" (Late Registration was opened before the v2 rollout, if
// one ever exists) keeps computing the pool it was created under, instead
// of silently jumping to the new x5/x10 weights mid-flight. Every
// completed Mystery Bounty tournament is unaffected either way -- its
// snapshot is frozen once points are awarded and never recomputed.
function computeLegacyMysteryPool(input: { totalEntries: number; addons: number }): number {
  const rawPool = input.totalEntries * 6 + input.addons * 12;
  return Math.ceil(rawPool / 10) * 10;
}

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
    total_entries_count: row.total_entries_count,
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

// Same field mapping as PostgresTournamentMysteryBountyRepository's own
// (private) mapRow, exposed here so features/late-registration.ts's
// transactional Mystery-aware close can map the raw row it just
// inserted/read via `tx` (bypassing the repository, which isn't tx-aware)
// without duplicating this field list a third time.
// async: every top-level export of a "use server" file must be an async
// function (Next.js Server Actions convention) -- this mapper has no IO of
// its own, but a plain sync export here breaks the WHOLE module's build.
export async function mapMysteryBountyDrizzleRow(
  row: typeof tournamentMysteryBounty.$inferSelect
): Promise<MysteryBountySnapshot> {
  return mapRow({
    tournament_id: row.tournamentId,
    status: row.status as MysteryBountyRow["status"],
    players_count: row.playersCount,
    total_entries_count: row.totalEntriesCount,
    rebuys_count: row.rebuysCount,
    addons_count: row.addonsCount,
    active_players_count: row.activePlayersCount,
    mystery_pool: row.mysteryPool,
    envelope_count: row.envelopeCount,
    small_count: row.smallCount,
    small_value: row.smallValue,
    medium_count: row.mediumCount,
    medium_value: row.mediumValue,
    jackpot_value: row.jackpotValue,
    closed_at: row.closedAt.toISOString(),
    activated_at: row.activatedAt ? row.activatedAt.toISOString() : null,
    recalculated_at: row.recalculatedAt ? row.recalculatedAt.toISOString() : null,
  });
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
  totalEntriesCount: number;
  rebuysCount: number;
  addonsCount: number;
  activePlayersCount: number;
  mysteryPool: number;
  breakdown: EnvelopeBreakdown;
};

async function computeSnapshotInputs(
  tournamentId: string,
  rows: MysteryBountyRosterRow[],
  ratingFormulaVersion: RatingFormulaVersion
): Promise<ComputedSnapshotInputs> {
  const arrivedRows = rows.filter((row) => row.arrived);
  const uniqueArrivedPlayerIds = new Set(arrivedRows.map((row) => row.player_id));
  const playersCount = uniqueArrivedPlayerIds.size;

  // `row.rebuys` is the shared free-tournament "Re-buy" field — typed
  // directly by the admin or pulled from Google Sheets, there is no
  // separate channel for either. Google Sheets never stores initial
  // entries and rebuys separately, so this number is each player's TOTAL
  // ENTRIES (initial buy-in + every rebuy), not a rebuy count on its own.
  // Summed across arrived players this is the tournament's Total Entries;
  // true Rebuys is Total Entries minus Players (computeRebuys), kept only
  // for display/diagnostics — the pool formula uses Total Entries
  // directly (see computeMysteryPool's doc comment for why).
  const totalEntriesCount = arrivedRows.reduce((sum, row) => sum + Math.max(0, row.rebuys), 0);
  const rebuysCount = computeRebuys(totalEntriesCount, playersCount);
  const addonsCount = arrivedRows.reduce((sum, row) => sum + Math.max(0, row.addons), 0);

  const activePlayerIds = await getActivePlayerIds(tournamentId, arrivedRows);
  const activePlayersCount = activePlayerIds.size;

  if (activePlayersCount < 2) {
    throw new Error(
      `Mystery Bounty: недостаточно активных игроков (${activePlayersCount}) — нужно минимум 2`
    );
  }

  const mysteryPool =
    ratingFormulaVersion === "legacy"
      ? computeLegacyMysteryPool({ totalEntries: totalEntriesCount, addons: addonsCount })
      : computeMysteryPool({ totalEntries: totalEntriesCount, addons: addonsCount });
  const breakdown = computeEnvelopeDistribution(mysteryPool, activePlayersCount);

  return {
    playersCount,
    totalEntriesCount,
    rebuysCount,
    addonsCount,
    activePlayersCount,
    mysteryPool,
    breakdown,
  };
}

export async function getMysteryBountySnapshot(
  tournamentId: string
): Promise<MysteryBountySnapshot | null> {
  const row = await tournamentMysteryBountyRepository.findByTournamentId(tournamentId);
  return row ? mapRow(row) : null;
}

// THE pool/envelope computation, shared by closeMysteryBountyLateRegistration
// below AND features/late-registration.ts's transactional Mystery-aware
// close -- so the formula is computed in exactly one place no matter which
// caller is closing Late Registration. Returns ready-to-insert values
// (minus tournament_id, which each caller already has) rather than the
// intermediate ComputedSnapshotInputs shape, so neither caller re-maps
// field names on its own.
export async function buildMysteryBountyInsertValues(
  tournamentId: string,
  rows: MysteryBountyRosterRow[],
  ratingFormulaVersion: RatingFormulaVersion
): Promise<Omit<MysteryBountyInsert, "tournament_id">> {
  const {
    playersCount,
    totalEntriesCount,
    rebuysCount,
    addonsCount,
    activePlayersCount,
    mysteryPool,
    breakdown,
  } = await computeSnapshotInputs(tournamentId, rows, ratingFormulaVersion);

  return {
    status: "pending_envelopes",
    players_count: playersCount,
    total_entries_count: totalEntriesCount,
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
  };
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

  const insertValues = await buildMysteryBountyInsertValues(
    tournamentId,
    rows,
    tournament.rating_formula_version
  );

  const row = await tournamentMysteryBountyRepository.insert({
    tournament_id: tournamentId,
    ...insertValues,
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

  const {
    playersCount,
    totalEntriesCount,
    rebuysCount,
    addonsCount,
    activePlayersCount,
    mysteryPool,
    breakdown,
  } = await computeSnapshotInputs(tournamentId, rows, tournament.rating_formula_version);

  const row = await tournamentMysteryBountyRepository.update(tournamentId, {
    status: "pending_envelopes",
    players_count: playersCount,
    total_entries_count: totalEntriesCount,
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
