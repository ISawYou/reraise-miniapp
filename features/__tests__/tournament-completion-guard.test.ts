import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addRegistration,
  addResult,
  fakeResults,
  resetFakeResultsDb,
  resultsSnapshot,
  writeStatements,
} from "./helpers/fake-results-db";

// Re-completion guard: exercises the REAL saveTournamentResults /
// completeTournamentFromLiveEntries (features/tournaments.ts) and the REAL
// locked tail (features/tournament-completion-commit.ts) against
// ./helpers/fake-results-db.ts, which logs lock order, enforces the
// `results` constraints and rolls back a throwing transaction.
//
// Honest caveat (same as the other fake-tx suites on this branch): the fake
// serializes transactions by construction, so "concurrency" here means the
// SAME interleaving Postgres' FOR UPDATE lock forces -- the loser's
// lock+status read runs only after the winner committed. True Postgres-level
// concurrency is not provable in a unit test.

vi.mock("@/lib/db", async () => ({
  db: (await import("./helpers/fake-results-db")).fakeResultsDb,
}));

const TID = "t1";

const repoMocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findSeasonIdById: vi.fn(),
  findLiveEntriesWithDetails: vi.fn(),
  findPlayerIdsWithLiveEntry: vi.fn(),
  findLiveEligible: vi.fn(),
  findAttendanceByTournamentId: vi.fn(),
  findClubDiscountPercentsByIds: vi.fn(),
  // Legacy repository writers -- must never be used by completion any more.
  deleteByTournamentId: vi.fn(),
  insertMany: vi.fn(),
  markAttendedBulk: vi.fn(),
  patch: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: { findClubDiscountPercentsByIds: repoMocks.findClubDiscountPercentsByIds },
  seasonRepository: {},
  tournamentRepository: {
    findById: repoMocks.findById,
    findSeasonIdById: repoMocks.findSeasonIdById,
    patch: repoMocks.patch,
  },
  registrationRepository: {
    markAttendedBulk: repoMocks.markAttendedBulk,
    findLiveEligible: repoMocks.findLiveEligible,
  },
  tournamentLiveStateRepository: {
    findPlayerIdsWithLiveEntry: repoMocks.findPlayerIdsWithLiveEntry,
    findLiveEntriesWithDetails: repoMocks.findLiveEntriesWithDetails,
  },
  resultRepository: {
    deleteByTournamentId: repoMocks.deleteByTournamentId,
    insertMany: repoMocks.insertMany,
    findAttendanceByTournamentId: repoMocks.findAttendanceByTournamentId,
  },
}));

const sideEffects = vi.hoisted(() => ({
  publishTournamentWinnerEvent: vi.fn(),
  syncPlayersAchievementsIfEnabled: vi.fn(),
}));
vi.mock("@/features/club-activity", () => ({
  publishTournamentWinnerEvent: sideEffects.publishTournamentWinnerEvent,
}));
vi.mock("@/features/achievements", () => ({
  syncPlayersAchievementsIfEnabled: sideEffects.syncPlayersAchievementsIfEnabled,
}));

import {
  completeTournamentFromLiveEntries,
  saveTournamentResults,
} from "@/features/tournaments";
import {
  TOURNAMENT_ALREADY_COMPLETED_MESSAGE,
  TournamentAlreadyCompletedError,
  TournamentCompletionUnavailableError,
} from "@/lib/tournament-errors";
import { resolveCompletionError } from "@/lib/tournament-completion-errors";
import type { TournamentResultInput } from "@/types/domain";

function freeInput(playerId: string, place: number): TournamentResultInput {
  return {
    player_id: playerId,
    display_name: playerId,
    place,
    reentries: 1,
    knockouts: 0,
    boss_knockouts: 0,
    mystery_bounty_points: 0,
    addons: 0,
    free_reentries: 0,
    rating_points: 10,
    arrived: true,
    participation_points: null,
    knockout_points: null,
    boss_bounty_points: null,
    itm_points: null,
  };
}

function liveEntry(playerId: string, place: number) {
  return {
    id: `entry-${playerId}`,
    tournament_id: TID,
    registration_id: `reg-${playerId}`,
    player_id: playerId,
    arrived: true,
    rebuys: 1,
    addons: 0,
    knockouts: 0,
    boss_knockouts: 0,
    place,
    sheet_row_number: null,
    players: { display_name: playerId, username: null },
    registrations: { status: "registered" },
  };
}

// The repository's tournament read reflects the fake's committed status
// unless a test deliberately makes it stale (a request whose unlocked
// pre-check ran before a concurrent completion committed).
let staleStatusForPreCheck: string | null = null;

function liveTournamentRow() {
  return {
    id: TID,
    title: "Live",
    google_sheet_tab_name: null,
    start_at: new Date().toISOString(),
    max_players: 20,
    kind: "cash",
    tournament_type: "classic",
    season_id: "season-1",
    status: staleStatusForPreCheck ?? fakeResults.state.tournament!.status,
    created_at: new Date().toISOString(),
    rating_formula_version: "legacy",
    rating_guarantee: null,
    is_final: false,
  };
}

const originalProvider = process.env.DATABASE_PROVIDER;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_PROVIDER = "postgres";
  staleStatusForPreCheck = null;
  resetFakeResultsDb({ id: TID, status: "open", kind: "free" });
  repoMocks.findById.mockImplementation(async () => liveTournamentRow());
  repoMocks.findSeasonIdById.mockResolvedValue({ id: TID, season_id: "season-1" });
  repoMocks.findPlayerIdsWithLiveEntry.mockResolvedValue([]);
  repoMocks.findLiveEligible.mockResolvedValue([]);
  repoMocks.findAttendanceByTournamentId.mockResolvedValue([]);
  repoMocks.findClubDiscountPercentsByIds.mockResolvedValue([]);
  sideEffects.publishTournamentWinnerEvent.mockResolvedValue(undefined);
  sideEffects.syncPlayersAchievementsIfEnabled.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env.DATABASE_PROVIDER = originalProvider;
});

function expectNoLegacyRepositoryWrites() {
  expect(repoMocks.deleteByTournamentId).not.toHaveBeenCalled();
  expect(repoMocks.insertMany).not.toHaveBeenCalled();
  expect(repoMocks.markAttendedBulk).not.toHaveBeenCalled();
  expect(repoMocks.patch).not.toHaveBeenCalled();
}

// A completed tournament whose places were already fixed by the Super-Admin
// place correction (p2 <-> p3 swapped vs. the original finish).
function seedCorrectedCompletedTournament() {
  fakeResults.state.tournament!.status = "completed";
  addResult("p1", 1);
  addResult("p2", 3);
  addResult("p3", 2);
  addRegistration("p1", "attended");
  addRegistration("p2", "attended");
  addRegistration("p3", "attended");
}

describe("saveTournamentResults (complete-free) -- re-completion guard", () => {
  it("rejects an already-completed tournament with zero writes", async () => {
    seedCorrectedCompletedTournament();
    const resultsBefore = resultsSnapshot();
    const registrationsBefore = structuredClone(fakeResults.state.registrations);

    const attempt = saveTournamentResults(TID, [freeInput("p1", 1), freeInput("p2", 2), freeInput("p3", 3)]);
    await expect(attempt).rejects.toBeInstanceOf(TournamentAlreadyCompletedError);
    await expect(
      saveTournamentResults(TID, [freeInput("p1", 1), freeInput("p2", 2), freeInput("p3", 3)])
    ).rejects.toThrow(TOURNAMENT_ALREADY_COMPLETED_MESSAGE);

    expect(writeStatements()).toEqual([]);
    expect(fakeResults.state.log).toEqual([
      "tx:begin",
      "lock:tournaments",
      "tx:rollback",
      "tx:begin",
      "lock:tournaments",
      "tx:rollback",
    ]);
    // Previously corrected rows: byte-for-byte unchanged.
    expect(fakeResults.state.results).toEqual(resultsBefore);
    expect(fakeResults.state.registrations).toEqual(registrationsBefore);
    expect(fakeResults.state.tournament!.status).toBe("completed");
    expectNoLegacyRepositoryWrites();
    // No winner Activity republish, no achievements.
    expect(sideEffects.publishTournamentWinnerEvent).not.toHaveBeenCalled();
    expect(sideEffects.syncPlayersAchievementsIfEnabled).not.toHaveBeenCalled();
  });

  it("first completion of an open tournament: lock first, then delete/insert/attended/status in ONE transaction, then post-commit side effects", async () => {
    addRegistration("p1", "registered");
    addRegistration("p2", "registered");
    addRegistration("p9", "waitlist");
    repoMocks.findClubDiscountPercentsByIds.mockResolvedValue([{ id: "p2", club_discount_percent: 10 }]);

    await saveTournamentResults(TID, [freeInput("p1", 1), freeInput("p2", 2)]);

    expect(fakeResults.state.log).toEqual([
      "tx:begin",
      "lock:tournaments",
      "delete:results",
      "insert:results",
      "update:registrations",
      "update:tournaments",
      "tx:commit",
    ]);
    expect(fakeResults.state.tournament!.status).toBe("completed");
    expect(
      fakeResults.state.results.map((row) => ({
        tournamentId: row.tournamentId,
        playerId: row.playerId,
        seasonId: row.seasonId,
        place: row.place,
        reentries: row.reentries,
        ratingPoints: row.ratingPoints,
        arrived: row.arrived,
        clubDiscountPercent: row.clubDiscountPercent,
      }))
    ).toEqual([
      { tournamentId: TID, playerId: "p1", seasonId: "season-1", place: 1, reentries: 1, ratingPoints: 10, arrived: true, clubDiscountPercent: 0 },
      { tournamentId: TID, playerId: "p2", seasonId: "season-1", place: 2, reentries: 1, ratingPoints: 10, arrived: true, clubDiscountPercent: 10 },
    ]);
    expect(fakeResults.state.registrations.map((r) => [r.playerId, r.status])).toEqual([
      ["p1", "attended"],
      ["p2", "attended"],
      ["p9", "waitlist"],
    ]);
    expectNoLegacyRepositoryWrites();
    expect(sideEffects.publishTournamentWinnerEvent).toHaveBeenCalledWith(TID, "p1");
    expect(sideEffects.syncPlayersAchievementsIfEnabled).toHaveBeenCalledWith(["p1", "p2"], {
      publishActivityEvents: true,
    });
  });

  it("race: the loser's locked status read sees the winner's committed completion and writes nothing", async () => {
    addRegistration("p1");
    addRegistration("p2");

    // Winner reaches the lock first and runs its whole mutation tail.
    await saveTournamentResults(TID, [freeInput("p1", 1), freeInput("p2", 2)]);
    const committed = resultsSnapshot();
    const logAfterWinner = fakeResults.state.log.length;
    vi.clearAllMocks();

    // Loser (e.g. second tab / double click, already past all upstream work).
    await expect(
      saveTournamentResults(TID, [freeInput("p1", 2), freeInput("p2", 1)])
    ).rejects.toBeInstanceOf(TournamentAlreadyCompletedError);

    expect(fakeResults.state.log.slice(logAfterWinner)).toEqual([
      "tx:begin",
      "lock:tournaments",
      "tx:rollback",
    ]);
    expect(fakeResults.state.results).toEqual(committed);
    expect(sideEffects.publishTournamentWinnerEvent).not.toHaveBeenCalled();
    expect(sideEffects.syncPlayersAchievementsIfEnabled).not.toHaveBeenCalled();
  });

  it("a failure mid-tail rolls back everything, leaving the tournament open", async () => {
    addRegistration("p1");
    // Same player twice -> UNIQUE(tournament_id, player_id) on insert.
    // (assertValidResultPlaces only checks places.)
    await expect(
      saveTournamentResults(TID, [freeInput("p1", 1), freeInput("p1", 2)])
    ).rejects.toThrow(/results_tournament_id_player_id_key/);

    expect(fakeResults.state.log.at(-1)).toBe("tx:rollback");
    expect(fakeResults.state.results).toEqual([]);
    expect(fakeResults.state.tournament!.status).toBe("open");
    expect(fakeResults.state.registrations[0].status).toBe("registered");
    expect(sideEffects.publishTournamentWinnerEvent).not.toHaveBeenCalled();
  });

  it("fails closed outside Postgres mode, before any transaction", async () => {
    process.env.DATABASE_PROVIDER = "supabase";
    await expect(saveTournamentResults(TID, [freeInput("p1", 1)])).rejects.toBeInstanceOf(
      TournamentCompletionUnavailableError
    );
    expect(fakeResults.state.log).toEqual([]);
  });
});

describe("completeTournamentFromLiveEntries (complete-live) -- re-completion guard", () => {
  beforeEach(() => {
    fakeResults.state.tournament!.kind = "cash";
    repoMocks.findLiveEntriesWithDetails.mockResolvedValue([liveEntry("p1", 1), liveEntry("p2", 2)]);
  });

  it("rejects an already-completed tournament with zero writes (fail-fast pre-check)", async () => {
    seedCorrectedCompletedTournament();
    const resultsBefore = resultsSnapshot();

    await expect(completeTournamentFromLiveEntries(TID)).rejects.toBeInstanceOf(
      TournamentAlreadyCompletedError
    );

    expect(writeStatements()).toEqual([]);
    expect(fakeResults.state.results).toEqual(resultsBefore);
    expectNoLegacyRepositoryWrites();
    expect(sideEffects.publishTournamentWinnerEvent).not.toHaveBeenCalled();
    expect(sideEffects.syncPlayersAchievementsIfEnabled).not.toHaveBeenCalled();
  });

  it("rejects under the lock even when the unlocked pre-check saw a stale 'open' (race loser), zero writes", async () => {
    seedCorrectedCompletedTournament();
    staleStatusForPreCheck = "open";
    const resultsBefore = resultsSnapshot();
    const registrationsBefore = structuredClone(fakeResults.state.registrations);

    await expect(completeTournamentFromLiveEntries(TID)).rejects.toBeInstanceOf(
      TournamentAlreadyCompletedError
    );

    expect(fakeResults.state.log).toEqual(["tx:begin", "lock:tournaments", "tx:rollback"]);
    expect(fakeResults.state.results).toEqual(resultsBefore);
    expect(fakeResults.state.registrations).toEqual(registrationsBefore);
    expectNoLegacyRepositoryWrites();
    expect(sideEffects.publishTournamentWinnerEvent).not.toHaveBeenCalled();
    expect(sideEffects.syncPlayersAchievementsIfEnabled).not.toHaveBeenCalled();
  });

  it("first completion of an open tournament still succeeds: lock first, full tail, then winner event", async () => {
    addRegistration("p1", "registered");
    addRegistration("p2", "attended");

    const result = await completeTournamentFromLiveEntries(TID);

    expect(result).toEqual({ completedCount: 2 });
    expect(fakeResults.state.log).toEqual([
      "tx:begin",
      "lock:tournaments",
      "delete:results",
      "insert:results",
      "update:registrations",
      "update:tournaments",
      "tx:commit",
    ]);
    expect(fakeResults.state.tournament!.status).toBe("completed");
    expect(fakeResults.state.results.map((row) => [row.playerId, row.place, row.reentries])).toEqual([
      ["p1", 1, 1],
      ["p2", 2, 1],
    ]);
    expect(fakeResults.state.registrations.every((r) => r.status === "attended")).toBe(true);
    expectNoLegacyRepositoryWrites();
    expect(sideEffects.publishTournamentWinnerEvent).toHaveBeenCalledWith(TID, "p1");
  });

  it("race: second sequential call after a committed completion is rejected with zero writes", async () => {
    await completeTournamentFromLiveEntries(TID);
    const committed = resultsSnapshot();
    const logLength = fakeResults.state.log.length;
    vi.clearAllMocks();
    staleStatusForPreCheck = "open"; // loser passed the unlocked pre-check earlier

    await expect(completeTournamentFromLiveEntries(TID)).rejects.toBeInstanceOf(
      TournamentAlreadyCompletedError
    );
    expect(fakeResults.state.log.slice(logLength)).toEqual([
      "tx:begin",
      "lock:tournaments",
      "tx:rollback",
    ]);
    expect(fakeResults.state.results).toEqual(committed);
    expect(sideEffects.publishTournamentWinnerEvent).not.toHaveBeenCalled();
  });
});

describe("resolveCompletionError -- TournamentAlreadyCompletedError", () => {
  it("maps to an expected 409 with the Russian message", () => {
    expect(resolveCompletionError(new TournamentAlreadyCompletedError())).toEqual({
      status: 409,
      message: "Турнир уже завершён",
      expected: true,
    });
  });
});
