"use server";

import {
  tournamentLateRegistrationRepository,
  tournamentLiveStateRepository,
  tournamentRepository,
} from "@/lib/repositories";
import { calculateRatingPlaceStructureForTournament } from "@/features/rating-v2";
import {
  closeMysteryBountyLateRegistration,
  getMysteryBountySnapshot,
} from "@/features/mystery-bounty";
import { TournamentNotFoundError } from "@/lib/tournament-errors";
import type {
  MysteryBountySnapshot,
  Tournament,
  TournamentLateRegistrationSnapshot,
} from "@/types/domain";

export type AuthoritativeLateRegistrationRow = {
  player_id: string;
  arrived: true;
  rebuys: number;
  addons: number;
};

async function findTournament(tournamentId: string): Promise<Tournament> {
  try {
    return await tournamentRepository.findById(tournamentId);
  } catch {
    throw new TournamentNotFoundError(tournamentId);
  }
}

function assertFreeTournament(tournament: Tournament) {
  if (tournament.kind !== "free") {
    throw new Error("Late Registration snapshot поддерживается только для рейтинговых free-турниров");
  }
}

export async function getAuthoritativeLateRegistrationRows(
  tournamentId: string
): Promise<AuthoritativeLateRegistrationRow[]> {
  const [attendedRows, rebuyState] = await Promise.all([
    tournamentLiveStateRepository.findAttendedPlayersWithDetails(tournamentId),
    tournamentLiveStateRepository.findRebuyStateByTournamentId(tournamentId),
  ]);

  return attendedRows.map((row) => ({
    player_id: row.player_id,
    arrived: true,
    rebuys: rebuyState.get(row.player_id)?.rebuys ?? 0,
    addons: rebuyState.get(row.player_id)?.addons ?? 0,
  }));
}

export async function getTournamentLateRegistrationSnapshot(
  tournamentId: string
): Promise<TournamentLateRegistrationSnapshot | null> {
  return tournamentLateRegistrationRepository.findByTournamentId(tournamentId);
}

export async function closeTournamentLateRegistration(
  tournamentId: string
): Promise<TournamentLateRegistrationSnapshot> {
  const tournament = await findTournament(tournamentId);
  assertFreeTournament(tournament);

  const existing = await tournamentLateRegistrationRepository.findByTournamentId(tournamentId);
  if (existing) return existing;

  if (tournament.status === "completed") {
    throw new Error("Турнир уже завершён — позднюю регистрацию закрыть нельзя");
  }

  const rows = await getAuthoritativeLateRegistrationRows(tournamentId);
  if (rows.length === 0) {
    throw new Error("Нельзя закрыть позднюю регистрацию: нет игроков с отметкой «Пришёл»");
  }

  const ratingPlaces = calculateRatingPlaceStructureForTournament(
    rows.map((row) => ({ entries: row.rebuys, addons: row.addons })),
    tournament.tournament_type,
    tournament.rating_formula_version,
    { ratingGuarantee: tournament.rating_guarantee }
  );

  const initialStacksCount = rows.filter((row) => row.rebuys >= 1).length;
  const totalEntriesCount = rows.reduce((sum, row) => sum + row.rebuys, 0);
  const rebuysCount = rows.reduce((sum, row) => sum + Math.max(row.rebuys - 1, 0), 0);
  const addonsCount = rows.reduce((sum, row) => sum + row.addons, 0);

  return tournamentLateRegistrationRepository.insertIfAbsent({
    tournament_id: tournamentId,
    arrived_players_count: rows.length,
    initial_stacks_count: initialStacksCount,
    total_entries_count: totalEntriesCount,
    rebuys_count: rebuysCount,
    addons_count: addonsCount,
    tournament_type: tournament.tournament_type,
    rating_formula_version: tournament.rating_formula_version,
    rating_guarantee: tournament.rating_guarantee,
    rating_places: ratingPlaces,
  });
}

// One UI operation for Mystery Bounty, with a retry-safe order. Its physical
// envelope snapshot is created first; the generic snapshot is then inserted
// idempotently. If the second step fails, the generic state remains OPEN and
// a retry reuses the existing Mystery row before completing the generic step.
export async function closeTournamentLateRegistrationOperation(
  tournamentId: string
): Promise<{
  snapshot: TournamentLateRegistrationSnapshot;
  mysteryBountySnapshot: MysteryBountySnapshot | null;
}> {
  const tournament = await findTournament(tournamentId);
  assertFreeTournament(tournament);

  let mysteryBountySnapshot: MysteryBountySnapshot | null = null;
  if (tournament.tournament_type === "mystery_bounty") {
    mysteryBountySnapshot = await getMysteryBountySnapshot(tournamentId);
    if (!mysteryBountySnapshot) {
      const rows = await getAuthoritativeLateRegistrationRows(tournamentId);
      mysteryBountySnapshot = await closeMysteryBountyLateRegistration(tournamentId, rows);
    }
  }

  const snapshot = await closeTournamentLateRegistration(tournamentId);
  return { snapshot, mysteryBountySnapshot };
}

export async function getTournamentStateForIntegration(tournamentId: string) {
  const tournament = await findTournament(tournamentId);
  assertFreeTournament(tournament);
  const snapshot = await getTournamentLateRegistrationSnapshot(tournamentId);

  return snapshot
    ? {
        lateRegistration: { status: "closed" as const, closedAt: snapshot.closed_at },
        rating: { places: snapshot.rating_places },
      }
    : {
        lateRegistration: { status: "open" as const, closedAt: null },
        rating: null,
      };
}
