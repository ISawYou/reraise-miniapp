import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Repository layer mock -------------------------------------------------
// saveTournamentResults / completeTournamentFromLiveEntries only talk to
// repositories (never Supabase/Postgres directly), so mocking the
// "@/lib/repositories" barrel is enough to exercise the real place
// validation without touching a database. Same pattern as
// features/__tests__/admin-remove-participant.test.ts, one level up the
// abstraction.
const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findSeasonIdById: vi.fn(),
  patch: vi.fn().mockResolvedValue(undefined),
  deleteByTournamentId: vi.fn().mockResolvedValue(undefined),
  insertMany: vi.fn().mockResolvedValue(undefined),
  markAttendedBulk: vi.fn().mockResolvedValue(undefined),
  findLiveEligible: vi.fn().mockResolvedValue([]),
  findPlayerIdsWithLiveEntry: vi.fn().mockResolvedValue([]),
  findLiveEntriesWithDetails: vi.fn(),
  publishTournamentWinnerEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: {},
  seasonRepository: {},
  tournamentRepository: {
    findById: mocks.findById,
    findSeasonIdById: mocks.findSeasonIdById,
    patch: mocks.patch,
  },
  registrationRepository: {
    markAttendedBulk: mocks.markAttendedBulk,
    findLiveEligible: mocks.findLiveEligible,
  },
  tournamentLiveStateRepository: {
    findPlayerIdsWithLiveEntry: mocks.findPlayerIdsWithLiveEntry,
    findLiveEntriesWithDetails: mocks.findLiveEntriesWithDetails,
  },
  resultRepository: {
    deleteByTournamentId: mocks.deleteByTournamentId,
    insertMany: mocks.insertMany,
  },
}));

vi.mock("@/features/achievements", () => ({
  syncPlayersAchievementsIfEnabled: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/features/club-activity", () => ({
  publishTournamentWinnerEvent: mocks.publishTournamentWinnerEvent,
}));

import { completeTournamentFromLiveEntries, saveTournamentResults } from "@/features/tournaments";
import { ResultPlaceValidationError } from "@/lib/tournament-results-validation";
import type { TournamentResultInput } from "@/types/domain";

const FREE_TOURNAMENT_ID = "tournament-free-1";
const LIVE_TOURNAMENT_ID = "tournament-live-1";

function freeResultInput(overrides: Partial<TournamentResultInput> & { player_id: string }) {
  return {
    reentries: 0,
    knockouts: 0,
    boss_knockouts: 0,
    mystery_bounty_points: 0,
    addons: 0,
    rating_points: 10,
    place: 1,
    ...overrides,
  };
}

function liveEntryRow(overrides: {
  player_id: string;
  place: number | null;
  display_name?: string;
}) {
  return {
    id: `entry-${overrides.player_id}`,
    tournament_id: LIVE_TOURNAMENT_ID,
    registration_id: `reg-${overrides.player_id}`,
    player_id: overrides.player_id,
    arrived: true,
    rebuys: 1,
    addons: 0,
    knockouts: 0,
    boss_knockouts: 0,
    place: overrides.place,
    sheet_row_number: null,
    players: { display_name: overrides.display_name ?? overrides.player_id, username: null },
    registrations: { status: "registered" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findLiveEligible.mockResolvedValue([]);
  mocks.findPlayerIdsWithLiveEntry.mockResolvedValue([]);
  mocks.patch.mockResolvedValue(undefined);
  mocks.deleteByTournamentId.mockResolvedValue(undefined);
  mocks.insertMany.mockResolvedValue(undefined);
  mocks.markAttendedBulk.mockResolvedValue(undefined);
  mocks.publishTournamentWinnerEvent.mockResolvedValue(undefined);
});

describe("saveTournamentResults (free completion flow)", () => {
  beforeEach(() => {
    mocks.findSeasonIdById.mockResolvedValue({ id: FREE_TOURNAMENT_ID, season_id: "season-1" });
  });

  it("succeeds and persists results when every place is unique -- unaffected/regression-safe", async () => {
    const results = [
      freeResultInput({ player_id: "p1", place: 1, display_name: "Alice" }),
      freeResultInput({ player_id: "p2", place: 2, display_name: "Bob" }),
      freeResultInput({ player_id: "p3", place: 3, display_name: "Carol" }),
    ];

    await saveTournamentResults(FREE_TOURNAMENT_ID, results);

    expect(mocks.deleteByTournamentId).toHaveBeenCalledWith(FREE_TOURNAMENT_ID);
    expect(mocks.insertMany).toHaveBeenCalledTimes(1);
    const inserted = mocks.insertMany.mock.calls[0][0];
    expect(inserted).toHaveLength(3);
    expect(inserted.map((row: { place: number }) => row.place).sort()).toEqual([1, 2, 3]);
    expect(mocks.patch).toHaveBeenCalledWith(FREE_TOURNAMENT_ID, { status: "completed" });
    expect(mocks.publishTournamentWinnerEvent).toHaveBeenCalledWith(FREE_TOURNAMENT_ID, "p1");
  });

  it("rejects two players sharing place=12 before touching the database (the production incident)", async () => {
    const results = [
      freeResultInput({ player_id: "p1", place: 1, display_name: "Alice" }),
      freeResultInput({ player_id: "p2", place: 12, display_name: "Player A" }),
      freeResultInput({ player_id: "p3", place: 12, display_name: "Player B" }),
    ];

    await expect(saveTournamentResults(FREE_TOURNAMENT_ID, results)).rejects.toThrow(
      ResultPlaceValidationError
    );
    await expect(saveTournamentResults(FREE_TOURNAMENT_ID, results)).rejects.toThrow(
      /Место 12 указано у нескольких игроков: Player A, Player B/
    );

    expect(mocks.deleteByTournamentId).not.toHaveBeenCalled();
    expect(mocks.insertMany).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("rejects place=0 and a negative place", async () => {
    const results = [
      freeResultInput({ player_id: "p1", place: 0, display_name: "Zero" }),
      freeResultInput({ player_id: "p2", place: -1, display_name: "Negative" }),
    ];

    await expect(saveTournamentResults(FREE_TOURNAMENT_ID, results)).rejects.toThrow(
      ResultPlaceValidationError
    );
    expect(mocks.insertMany).not.toHaveBeenCalled();
  });

  it("rejects several different duplicate places in the same roster", async () => {
    const results = [
      freeResultInput({ player_id: "p1", place: 2, display_name: "A" }),
      freeResultInput({ player_id: "p2", place: 2, display_name: "B" }),
      freeResultInput({ player_id: "p3", place: 5, display_name: "C" }),
      freeResultInput({ player_id: "p4", place: 5, display_name: "D" }),
    ];

    await expect(saveTournamentResults(FREE_TOURNAMENT_ID, results)).rejects.toThrow(
      /Место 2 указано у нескольких игроков: A, B\.\s*Место 5 указано у нескольких игроков: C, D\./
    );
    expect(mocks.insertMany).not.toHaveBeenCalled();
  });
});

describe("completeTournamentFromLiveEntries (live completion flow)", () => {
  beforeEach(() => {
    mocks.findById.mockResolvedValue({
      id: LIVE_TOURNAMENT_ID,
      title: "Live Cash Game",
      google_sheet_tab_name: null,
      start_at: new Date().toISOString(),
      max_players: 20,
      kind: "cash",
      tournament_type: "classic",
      season_id: "season-1",
      status: "open",
      created_at: new Date().toISOString(),
      rating_formula_version: "legacy",
      rating_guarantee: null,
    });
    mocks.findSeasonIdById.mockResolvedValue({ id: LIVE_TOURNAMENT_ID, season_id: "season-1" });
  });

  it("succeeds and persists results when every place is unique -- unaffected/regression-safe", async () => {
    mocks.findLiveEntriesWithDetails.mockResolvedValue([
      liveEntryRow({ player_id: "p1", place: 1, display_name: "Alice" }),
      liveEntryRow({ player_id: "p2", place: 2, display_name: "Bob" }),
    ]);

    const result = await completeTournamentFromLiveEntries(LIVE_TOURNAMENT_ID);

    expect(result.completedCount).toBe(2);
    expect(mocks.insertMany).toHaveBeenCalledTimes(1);
    const inserted = mocks.insertMany.mock.calls[0][0];
    expect(inserted.map((row: { place: number }) => row.place).sort()).toEqual([1, 2]);
    expect(mocks.patch).toHaveBeenCalledWith(LIVE_TOURNAMENT_ID, { status: "completed" });
    expect(mocks.markAttendedBulk).toHaveBeenCalledTimes(1);
    expect(mocks.publishTournamentWinnerEvent).toHaveBeenCalledWith(LIVE_TOURNAMENT_ID, "p1");
  });

  it("rejects two players sharing place=12 before touching the database", async () => {
    mocks.findLiveEntriesWithDetails.mockResolvedValue([
      liveEntryRow({ player_id: "p1", place: 1, display_name: "Alice" }),
      liveEntryRow({ player_id: "p2", place: 12, display_name: "Player A" }),
      liveEntryRow({ player_id: "p3", place: 12, display_name: "Player B" }),
    ]);

    await expect(completeTournamentFromLiveEntries(LIVE_TOURNAMENT_ID)).rejects.toThrow(
      ResultPlaceValidationError
    );

    expect(mocks.deleteByTournamentId).not.toHaveBeenCalled();
    expect(mocks.insertMany).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("still reports the pre-existing 'missing place' error ahead of the new duplicate/positivity check", async () => {
    mocks.findLiveEntriesWithDetails.mockResolvedValue([
      liveEntryRow({ player_id: "p1", place: 1, display_name: "Alice" }),
      liveEntryRow({ player_id: "p2", place: null, display_name: "Bob" }),
    ]);

    await expect(completeTournamentFromLiveEntries(LIVE_TOURNAMENT_ID)).rejects.toThrow(
      /Заполните место/
    );
    expect(mocks.insertMany).not.toHaveBeenCalled();
  });
});
