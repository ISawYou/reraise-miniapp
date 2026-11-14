import type { Tournament, TournamentType } from "@/types/domain";
import type { IntegrationCompletedResultRow } from "@/lib/repositories/result/ResultRepository";
import { isRatingEligibleTournament } from "@/lib/tournament-helpers";

export const SUPPORTED_COMPLETED_RESULTS_TYPES: ReadonlySet<string> = new Set<TournamentType>([
  "classic",
  "qualification_final",
  "phoenix",
  "deep_stack",
  "bounty",
  "boss_bounty",
  "win_the_button",
  "mystery_bounty",
  "crazy_pineapple",
  "bomb_pot",
  "boost_rating",
  "free_roll",
]);

export class CompletedResultsUnavailableError extends Error {
  readonly code = "RESULTS_UNAVAILABLE" as const;

  constructor(message = "Official completed results are unavailable or inconsistent") {
    super(message);
    this.name = "CompletedResultsUnavailableError";
  }
}

export class CompletedResultsNotReadyError extends Error {
  readonly code = "RESULTS_NOT_READY" as const;

  constructor() {
    super("Official results are not ready");
    this.name = "CompletedResultsNotReadyError";
  }
}

export class UnsupportedCompletedResultsTypeError extends Error {
  readonly code = "UNSUPPORTED_TOURNAMENT_TYPE" as const;

  constructor(tournamentType: string) {
    super(`Unsupported tournament type: ${tournamentType}`);
    this.name = "UnsupportedCompletedResultsTypeError";
  }
}

export type CompletedResultsResponse = {
  tournamentId: string;
  title: string;
  tournamentType: string;
  status: "completed";
  ratingApplicable: boolean;
  completedAt: null;
  participantsCount: number | null;
  results: Array<{
    playerId: string;
    nickname: string;
    place: number;
    ratingPointsEarned: number | null;
    knockouts: number;
    bossKnockouts: number | null;
    mysteryBountyPoints: number | null;
  }>;
};

export function buildCompletedResultsResponse(
  tournament: Tournament,
  rows: IntegrationCompletedResultRow[],
): CompletedResultsResponse {
  if (!SUPPORTED_COMPLETED_RESULTS_TYPES.has(tournament.tournament_type)) {
    throw new UnsupportedCompletedResultsTypeError(tournament.tournament_type);
  }
  if (tournament.status !== "completed") throw new CompletedResultsNotReadyError();
  if (rows.length === 0) throw new CompletedResultsUnavailableError("No official result rows exist");

  const places = new Set<number>();
  for (const row of rows) {
    if (!Number.isInteger(row.place) || row.place < 1 || places.has(row.place)) {
      throw new CompletedResultsUnavailableError("Official result places are inconsistent");
    }
    places.add(row.place);
  }
  if (rows.filter((row) => row.place === 1).length !== 1) {
    throw new CompletedResultsUnavailableError("Official winner result is missing or duplicated");
  }

  const attendanceIsKnown = rows.every((row) => row.arrived !== null);
  const participantsCount = attendanceIsKnown
    ? rows.filter((row) => row.arrived === true).length
    : null;
  const ratingApplicable = isRatingEligibleTournament(tournament);

  return {
    tournamentId: tournament.id,
    title: tournament.title,
    tournamentType: tournament.tournament_type,
    status: "completed",
    ratingApplicable,
    completedAt: null,
    participantsCount,
    results: rows
      .slice()
      .sort((a, b) => a.place - b.place)
      .map((row) => ({
        playerId: row.player_id,
        nickname: row.display_name,
        place: row.place,
        ratingPointsEarned: ratingApplicable ? row.rating_points : null,
        knockouts: row.knockouts,
        bossKnockouts: row.boss_knockouts,
        mysteryBountyPoints: row.mystery_bounty_points,
      })),
  };
}
