import { beforeEach, describe, expect, it, vi } from "vitest";

// Same mocking shape as tournament-results-completion.test.ts one directory
// up: setTournamentPlayerAttendance / getArrivedPlayersForIntegration only
// talk to repositories (never Supabase/Postgres directly), so mocking the
// "@/lib/repositories" barrel is enough.
const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  upsertAttendance: vi.fn(),
  findAttendedPlayersWithDetails: vi.fn(),
  findEliminationsByTournamentId: vi.fn().mockResolvedValue(new Map()),
  findRatingPointsBySeasonId: vi.fn().mockResolvedValue([]),
  listOpen: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: {},
  seasonRepository: {},
  tournamentRepository: {
    findById: mocks.findById,
    listOpen: mocks.listOpen,
  },
  registrationRepository: {},
  tournamentLiveStateRepository: {
    upsertAttendance: mocks.upsertAttendance,
    findAttendedPlayersWithDetails: mocks.findAttendedPlayersWithDetails,
    findEliminationsByTournamentId: mocks.findEliminationsByTournamentId,
  },
  resultRepository: {
    findRatingPointsBySeasonId: mocks.findRatingPointsBySeasonId,
  },
}));

vi.mock("@/features/achievements", () => ({
  syncPlayersAchievementsIfEnabled: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/features/club-activity", () => ({
  publishTournamentWinnerEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
  getArrivedPlayersForIntegration,
  getIntegrationTournamentList,
  setTournamentPlayerAttendance,
} from "@/features/tournaments";
import { TournamentNotFoundError } from "@/lib/tournament-errors";

const TOURNAMENT_ID = "tournament-1";
const PLAYER_ID = "player-1";

function baseTournament(overrides: Partial<{ season_id: string | null }> = {}) {
  return {
    id: TOURNAMENT_ID,
    title: "Test Tournament",
    start_at: new Date().toISOString(),
    max_players: 20,
    kind: "free" as const,
    tournament_type: "classic" as const,
    // Explicit `in` check, not `??` -- season_id: null must stay null, not
    // fall back to the default (this is exactly the null-vs-"not passed"
    // distinction the function under test itself has to get right).
    season_id: "season_id" in overrides ? overrides.season_id! : "season-1",
    status: "open" as const,
    created_at: new Date().toISOString(),
    rating_formula_version: "v2" as const,
    rating_guarantee: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// setTournamentPlayerAttendance is now a thin pass-through -- the actual
// arrived_at computation lives in one atomic SQL statement
// (PostgresTournamentLiveStateRepository.ts::upsertAttendance), which a
// mocked repository cannot meaningfully exercise. That logic is covered
// instead by the real-Postgres integration test in
// lib/repositories/tournament-live-state/__tests__/
// upsert-attendance-postgres.integration.test.ts. Same-tab click-order
// safety is a client-side concern (lib/attendance-write-queue.ts, tested in
// lib/__tests__/attendance-write-queue.test.ts) -- this function no longer
// accepts or needs any ordering token at all, by design (see
// AttendanceUpsert's doc comment for why a client-supplied one was tried
// and reverted).
describe("setTournamentPlayerAttendance", () => {
  it("threads arrived through to the repository and returns its result unchanged", async () => {
    mocks.upsertAttendance.mockResolvedValue({
      arrived: true,
      arrived_at: "2026-08-25T18:26:00.000Z",
    });

    const result = await setTournamentPlayerAttendance(TOURNAMENT_ID, PLAYER_ID, true);

    expect(mocks.upsertAttendance).toHaveBeenCalledWith({
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_ID,
      arrived: true,
    });
    expect(result).toEqual({
      arrived: true,
      arrived_at: "2026-08-25T18:26:00.000Z",
    });
  });

  it("does not read the row before writing -- no separate lookup call exists to make", async () => {
    // Regression guard for the actual bug being fixed: the original
    // implementation did a SELECT then an UPSERT (two round-trips), which
    // is exactly the gap where two concurrent calls could interleave. This
    // asserts the fix's shape, not just its outward behavior: only one
    // repository call happens per invocation.
    mocks.upsertAttendance.mockResolvedValue({
      arrived: false,
      arrived_at: null,
    });

    await setTournamentPlayerAttendance(TOURNAMENT_ID, PLAYER_ID, false);

    expect(mocks.upsertAttendance).toHaveBeenCalledTimes(1);
  });
});

describe("getArrivedPlayersForIntegration", () => {
  it("throws TournamentNotFoundError for an unknown tournament instead of leaking the raw repository error", async () => {
    mocks.findById.mockRejectedValue(new Error("some raw Supabase/.single() error text"));

    await expect(getArrivedPlayersForIntegration("missing")).rejects.toThrow(
      TournamentNotFoundError
    );
  });

  it("returns nickname/avatar via the canonical helper + precedence, and rating_points is null when the tournament has no season", async () => {
    mocks.findById.mockResolvedValue(baseTournament({ season_id: null }));
    mocks.findAttendedPlayersWithDetails.mockResolvedValue([
      {
        player_id: PLAYER_ID,
        arrived_at: "2026-08-25T18:26:00.000Z",
        players: {
          display_name: "Fallback Name",
          admin_display_name: "Admin Nick",
          custom_avatar_url: "https://example.com/custom.png",
          telegram_avatar_url: "https://example.com/telegram.png",
        },
      },
    ]);

    const players = await getArrivedPlayersForIntegration(TOURNAMENT_ID);

    expect(players).toEqual([
      {
        id: PLAYER_ID,
        nickname: "Admin Nick",
        avatarUrl: "https://example.com/custom.png",
        ratingPoints: null,
        // Default mock: no elimination row at all for this player.
        eliminated: false,
      },
    ]);
    expect(mocks.findRatingPointsBySeasonId).not.toHaveBeenCalled();
  });

  it("falls back telegram_avatar_url -> null, and sums season rating_points for a season-linked tournament", async () => {
    mocks.findById.mockResolvedValue(baseTournament({ season_id: "season-1" }));
    mocks.findAttendedPlayersWithDetails.mockResolvedValue([
      {
        player_id: PLAYER_ID,
        arrived_at: "2026-08-25T18:26:00.000Z",
        players: {
          display_name: "Only Display Name",
          admin_display_name: null,
          custom_avatar_url: null,
          telegram_avatar_url: "https://example.com/telegram.png",
        },
      },
      {
        player_id: "player-no-results",
        arrived_at: "2026-08-25T18:30:00.000Z",
        players: {
          display_name: "No Results Yet",
          admin_display_name: null,
          custom_avatar_url: null,
          telegram_avatar_url: null,
        },
      },
    ]);
    mocks.findRatingPointsBySeasonId.mockResolvedValue([
      { player_id: PLAYER_ID, rating_points: 12 },
      { player_id: PLAYER_ID, rating_points: 8 },
    ]);
    // player-no-results has busted out; PLAYER_ID has no elimination row
    // (still active) -- covers both branches in one pass.
    mocks.findEliminationsByTournamentId.mockResolvedValue(
      new Map([["player-no-results", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }]])
    );

    const players = await getArrivedPlayersForIntegration(TOURNAMENT_ID);

    expect(players).toEqual([
      {
        id: PLAYER_ID,
        nickname: "Only Display Name",
        avatarUrl: "https://example.com/telegram.png",
        ratingPoints: 20,
        eliminated: false,
      },
      {
        id: "player-no-results",
        nickname: "No Results Yet",
        avatarUrl: null,
        // Real zero (has a season but no results yet), not null.
        ratingPoints: 0,
        // Eliminated players are NOT filtered out -- they stay present with
        // eliminated=true (see the type's own doc comment for why: Poker
        // Clock needs to show them, not silently drop them).
        eliminated: true,
      },
    ]);
  });

  it("live semantics: a later GET reflects a change to eliminated with no snapshot/caching in between", async () => {
    mocks.findById.mockResolvedValue(baseTournament({ season_id: null }));
    mocks.findAttendedPlayersWithDetails.mockResolvedValue([
      {
        player_id: PLAYER_ID,
        arrived_at: "2026-08-25T18:00:00.000Z",
        players: {
          display_name: "Player",
          admin_display_name: null,
          custom_avatar_url: null,
          telegram_avatar_url: null,
        },
      },
    ]);

    // First read: admin hasn't touched "Выбыл" yet.
    mocks.findEliminationsByTournamentId.mockResolvedValueOnce(new Map());
    const before = await getArrivedPlayersForIntegration(TOURNAMENT_ID);
    expect(before[0].eliminated).toBe(false);

    // Admin ticks "Выбыл" between the two GETs -- no code under test here,
    // just a differently-mocked repository read, exactly modelling
    // "the underlying table changed between two requests".
    mocks.findEliminationsByTournamentId.mockResolvedValueOnce(
      new Map([[PLAYER_ID, { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }]])
    );
    const afterEliminate = await getArrivedPlayersForIntegration(TOURNAMENT_ID);
    expect(afterEliminate[0].eliminated).toBe(true);

    // If the admin unchecks it again, the very next GET reflects that too --
    // the existing "Выбыл" write path already allows eliminated: true ->
    // false (see features/tournaments.ts::setTournamentPlayerElimination),
    // and this endpoint has no cache to invalidate.
    mocks.findEliminationsByTournamentId.mockResolvedValueOnce(new Map());
    const afterUnEliminate = await getArrivedPlayersForIntegration(TOURNAMENT_ID);
    expect(afterUnEliminate[0].eliminated).toBe(false);
  });

  it("response contains no PII beyond id/nickname/avatarUrl/ratingPoints/eliminated", async () => {
    mocks.findById.mockResolvedValue(baseTournament({ season_id: null }));
    mocks.findAttendedPlayersWithDetails.mockResolvedValue([
      {
        player_id: PLAYER_ID,
        arrived_at: "2026-08-25T18:26:00.000Z",
        players: {
          display_name: "Player",
          admin_display_name: null,
          custom_avatar_url: null,
          telegram_avatar_url: null,
        },
      },
    ]);
    mocks.findEliminationsByTournamentId.mockResolvedValue(
      new Map([[PLAYER_ID, { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }]])
    );

    const [player] = await getArrivedPlayersForIntegration(TOURNAMENT_ID);

    expect(Object.keys(player).sort()).toEqual(
      ["avatarUrl", "eliminated", "id", "nickname", "ratingPoints"].sort()
    );
  });
});

describe("getIntegrationTournamentList", () => {
  it("returns only open tournaments -- completed tournaments are not offered for a new binding", async () => {
    mocks.listOpen.mockResolvedValue([
      {
        id: "open-1",
        title: "CLASSIC",
        start_at: "2026-08-26T16:00:00.000Z",
        status: "open",
        tournament_type: "classic",
      },
    ]);

    const tournaments = await getIntegrationTournamentList();

    expect(tournaments).toEqual([
      {
        id: "open-1",
        title: "CLASSIC",
        startAt: "2026-08-26T16:00:00.000Z",
        status: "open",
        tournamentType: "classic",
      },
    ]);
  });

  it("never calls listCompleted -- completed tournaments are not fetched at all, not merely filtered", async () => {
    mocks.listOpen.mockResolvedValue([]);

    await getIntegrationTournamentList();

    // tournamentRepository mock only defines findById/listOpen (see the
    // vi.mock at the top of this file) -- if getIntegrationTournamentList
    // called .listCompleted() it would throw "not a function", which this
    // call not throwing already proves. Asserted explicitly for clarity.
    expect(mocks.listOpen).toHaveBeenCalledTimes(1);
  });
});
