import { beforeEach, describe, expect, it, vi } from "vitest";

// Same mocking shape as tournament-results-completion.test.ts one directory
// up: setTournamentPlayerAttendance / getArrivedPlayersForIntegration only
// talk to repositories (never Supabase/Postgres directly), so mocking the
// "@/lib/repositories" barrel is enough.
const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  upsertAttendance: vi.fn(),
  findAttendanceByTournamentId: vi.fn().mockResolvedValue(new Map()),
  findAttendedPlayersWithDetails: vi.fn(),
  findEliminationsByTournamentId: vi.fn().mockResolvedValue(new Map()),
  upsertElimination: vi.fn().mockResolvedValue(undefined),
  findRebuyStateByTournamentId: vi.fn().mockResolvedValue(new Map()),
  upsertRebuyState: vi.fn(),
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
    findAttendanceByTournamentId: mocks.findAttendanceByTournamentId,
    findAttendedPlayersWithDetails: mocks.findAttendedPlayersWithDetails,
    findEliminationsByTournamentId: mocks.findEliminationsByTournamentId,
    upsertElimination: mocks.upsertElimination,
    findRebuyStateByTournamentId: mocks.findRebuyStateByTournamentId,
    upsertRebuyState: mocks.upsertRebuyState,
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
  getActiveTournamentPlayersForPublicView,
  getArrivedPlayersForIntegration,
  getDerivedEliminationPlaces,
  getIntegrationTournamentList,
  getTournamentRebuyState,
  reorderTournamentEliminations,
  setTournamentPlayerAttendance,
  setTournamentPlayerRebuyState,
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
    is_final: false,
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
        place: null,
        eliminatedAt: null,
        // Default mock: no rebuy-state row at all -- raw Re-buy = 0.
        initialStackTaken: false,
        rebuys: 0,
        addons: 0,
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
    // PLAYER_ID: raw Re-buy 3 -- The Black Pearl example from the read-only
    // investigation (initial stack + 2 real rebuys) -- normalizes to
    // initialStackTaken:true, rebuys:2. player-no-results: no rebuy-state
    // row at all -- raw Re-buy 0 (arrived, stack not yet taken) ->
    // initialStackTaken:false, rebuys:0. Addons only set for PLAYER_ID.
    mocks.findRebuyStateByTournamentId.mockResolvedValue(
      new Map([[PLAYER_ID, { rebuys: 3, addons: 1 }]])
    );

    const players = await getArrivedPlayersForIntegration(TOURNAMENT_ID);

    expect(players).toEqual([
      {
        id: PLAYER_ID,
        nickname: "Only Display Name",
        avatarUrl: "https://example.com/telegram.png",
        ratingPoints: 20,
        eliminated: false,
        place: null,
        eliminatedAt: null,
        initialStackTaken: true,
        rebuys: 2,
        addons: 1,
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
        // fieldSize=2 (both players arrived), eliminationIndex=0 -> 2-0=2.
        place: 2,
        eliminatedAt: "2026-08-25T19:00:00.000Z",
        initialStackTaken: false,
        rebuys: 0,
        addons: 0,
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

  it("response contains no PII beyond id/nickname/avatarUrl/ratingPoints/eliminated/place/eliminatedAt", async () => {
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
      ["addons", "avatarUrl", "eliminated", "eliminatedAt", "id", "initialStackTaken", "nickname", "place", "ratingPoints", "rebuys"].sort()
    );
    const raw = JSON.stringify(player);
    for (const forbidden of ["telegram_id", "email", "phone", "role", "moderation", "access", "block"]) {
      expect(raw.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("eliminatedAt mirrors the same tournament_player_eliminations row `eliminated` is read from -- null while not eliminated, the stored timestamp once eliminated", async () => {
    mocks.findById.mockResolvedValue(baseTournament({ season_id: null }));
    mocks.findAttendedPlayersWithDetails.mockResolvedValue([
      {
        player_id: PLAYER_ID,
        arrived_at: "2026-08-25T18:00:00.000Z",
        players: { display_name: "Still In", admin_display_name: null, custom_avatar_url: null, telegram_avatar_url: null },
      },
      {
        player_id: "player-busted",
        arrived_at: "2026-08-25T18:05:00.000Z",
        players: { display_name: "Busted", admin_display_name: null, custom_avatar_url: null, telegram_avatar_url: null },
      },
    ]);
    mocks.findEliminationsByTournamentId.mockResolvedValue(
      new Map([["player-busted", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }]])
    );

    const players = await getArrivedPlayersForIntegration(TOURNAMENT_ID);

    expect(players.find((p) => p.id === PLAYER_ID)?.eliminatedAt).toBeNull();
    expect(players.find((p) => p.id === "player-busted")?.eliminatedAt).toBe(
      "2026-08-25T19:00:00.000Z"
    );
  });

  describe("place -- same derived placement algorithm as Google Sheets", () => {
    it("a still-active (non-eliminated) player gets place: null", async () => {
      mocks.findById.mockResolvedValue(baseTournament({ season_id: null }));
      mocks.findAttendedPlayersWithDetails.mockResolvedValue([
        {
          player_id: PLAYER_ID,
          arrived_at: "2026-08-25T18:00:00.000Z",
          players: { display_name: "Player", admin_display_name: null, custom_avatar_url: null, telegram_avatar_url: null },
        },
      ]);
      mocks.findEliminationsByTournamentId.mockResolvedValue(new Map());

      const [player] = await getArrivedPlayersForIntegration(TOURNAMENT_ID);
      expect(player.place).toBeNull();
    });

    it("17 arrived, first eliminated -> place 17", async () => {
      mocks.findById.mockResolvedValue(baseTournament({ season_id: null }));
      const arrivedRows = Array.from({ length: 17 }, (_, i) => ({
        player_id: `p${i + 1}`,
        arrived_at: "2026-08-25T18:00:00.000Z",
        players: { display_name: `Player ${i + 1}`, admin_display_name: null, custom_avatar_url: null, telegram_avatar_url: null },
      }));
      mocks.findAttendedPlayersWithDetails.mockResolvedValue(arrivedRows);
      mocks.findEliminationsByTournamentId.mockResolvedValue(
        new Map([["p1", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }]])
      );

      const players = await getArrivedPlayersForIntegration(TOURNAMENT_ID);
      expect(players.find((p) => p.id === "p1")?.place).toBe(17);
      expect(players.find((p) => p.id === "p2")?.place).toBeNull();
    });

    it("second eliminated after first (fieldSize 17): first -> 17, second -> 16", async () => {
      mocks.findById.mockResolvedValue(baseTournament({ season_id: null }));
      const arrivedRows = Array.from({ length: 17 }, (_, i) => ({
        player_id: `p${i + 1}`,
        arrived_at: "2026-08-25T18:00:00.000Z",
        players: { display_name: `Player ${i + 1}`, admin_display_name: null, custom_avatar_url: null, telegram_avatar_url: null },
      }));
      mocks.findAttendedPlayersWithDetails.mockResolvedValue(arrivedRows);
      mocks.findEliminationsByTournamentId.mockResolvedValue(
        new Map([
          ["p1", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }],
          ["p2", { eliminated: true, eliminated_at: "2026-08-25T19:05:00.000Z" }],
        ])
      );

      const players = await getArrivedPlayersForIntegration(TOURNAMENT_ID);
      expect(players.find((p) => p.id === "p1")?.place).toBe(17);
      expect(players.find((p) => p.id === "p2")?.place).toBe(16);
    });

    it("waitlist/never-arrived players never contribute to field size (only attendedRows exist here at all)", async () => {
      mocks.findById.mockResolvedValue(baseTournament({ season_id: null }));
      // Only 2 arrived rows -- a waitlisted or registered-but-not-arrived
      // player simply never appears in findAttendedPlayersWithDetails,
      // which is exactly how fieldSize stays scoped to arrived===true.
      mocks.findAttendedPlayersWithDetails.mockResolvedValue([
        { player_id: "p1", arrived_at: "x", players: { display_name: "A", admin_display_name: null, custom_avatar_url: null, telegram_avatar_url: null } },
        { player_id: "p2", arrived_at: "x", players: { display_name: "B", admin_display_name: null, custom_avatar_url: null, telegram_avatar_url: null } },
      ]);
      mocks.findEliminationsByTournamentId.mockResolvedValue(
        new Map([["p1", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }]])
      );

      const players = await getArrivedPlayersForIntegration(TOURNAMENT_ID);
      expect(players.find((p) => p.id === "p1")?.place).toBe(2);
    });
  });
});

describe("getTournamentRebuyState / setTournamentPlayerRebuyState", () => {
  it("getTournamentRebuyState is a thin pass-through of the repository's map", async () => {
    const map = new Map([[PLAYER_ID, { rebuys: 2, addons: 1 }]]);
    mocks.findRebuyStateByTournamentId.mockResolvedValue(map);

    const result = await getTournamentRebuyState(TOURNAMENT_ID);

    expect(mocks.findRebuyStateByTournamentId).toHaveBeenCalledWith(TOURNAMENT_ID);
    expect(result).toBe(map);
  });

  it("setTournamentPlayerRebuyState threads rebuys/addons through to the repository and returns its result unchanged", async () => {
    mocks.upsertRebuyState.mockResolvedValue({ rebuys: 3, addons: 1 });

    const result = await setTournamentPlayerRebuyState(TOURNAMENT_ID, PLAYER_ID, 3, 1);

    expect(mocks.upsertRebuyState).toHaveBeenCalledWith({
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_ID,
      rebuys: 3,
      addons: 1,
    });
    expect(result).toEqual({ rebuys: 3, addons: 1 });
  });
});

describe("getArrivedPlayersForIntegration -- Re-buy normalization", () => {
  beforeEach(() => {
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
  });

  it("raw Re-buy 1 (initial stack taken, no real rebuy yet) -> initialStackTaken:true, rebuys:0", async () => {
    mocks.findRebuyStateByTournamentId.mockResolvedValue(new Map([[PLAYER_ID, { rebuys: 1, addons: 0 }]]));

    const [player] = await getArrivedPlayersForIntegration(TOURNAMENT_ID);

    expect(player.initialStackTaken).toBe(true);
    expect(player.rebuys).toBe(0);
  });

  it("raw Re-buy 0 (arrived, stack not yet taken) -> initialStackTaken:false, rebuys:0 -- not negative", async () => {
    mocks.findRebuyStateByTournamentId.mockResolvedValue(new Map([[PLAYER_ID, { rebuys: 0, addons: 0 }]]));

    const [player] = await getArrivedPlayersForIntegration(TOURNAMENT_ID);

    expect(player.initialStackTaken).toBe(false);
    expect(player.rebuys).toBe(0);
  });

  it("raw Re-buy 3 -> initialStackTaken:true, rebuys:2 (the exact The Black Pearl example from the investigation)", async () => {
    mocks.findRebuyStateByTournamentId.mockResolvedValue(new Map([[PLAYER_ID, { rebuys: 3, addons: 0 }]]));

    const [player] = await getArrivedPlayersForIntegration(TOURNAMENT_ID);

    expect(player.initialStackTaken).toBe(true);
    expect(player.rebuys).toBe(2);
  });

  it("addons pass through as-is, no normalization", async () => {
    mocks.findRebuyStateByTournamentId.mockResolvedValue(new Map([[PLAYER_ID, { rebuys: 1, addons: 1 }]]));

    const [player] = await getArrivedPlayersForIntegration(TOURNAMENT_ID);

    expect(player.addons).toBe(1);
  });

  it("does NOT use the aggregate max(0, totalEntries - fieldSize) shortcut -- normalization is per-player", async () => {
    // Two arrived players: A raw Re-buy 2 (1 real rebuy), B raw Re-buy 0
    // (not yet staked). The aggregate shortcut used by features/rating-v2.ts
    // would compute totalEntries=2, fieldSize=2 -> max(0, 2-2) = 0 total
    // rebuys, silently losing A's real rebuy. Per-player normalization must
    // get A right regardless of what B's value is.
    mocks.findAttendedPlayersWithDetails.mockResolvedValue([
      {
        player_id: "player-a",
        arrived_at: "2026-08-25T18:00:00.000Z",
        players: { display_name: "A", admin_display_name: null, custom_avatar_url: null, telegram_avatar_url: null },
      },
      {
        player_id: "player-b",
        arrived_at: "2026-08-25T18:01:00.000Z",
        players: { display_name: "B", admin_display_name: null, custom_avatar_url: null, telegram_avatar_url: null },
      },
    ]);
    mocks.findRebuyStateByTournamentId.mockResolvedValue(
      new Map([
        ["player-a", { rebuys: 2, addons: 0 }],
        ["player-b", { rebuys: 0, addons: 0 }],
      ])
    );

    const players = await getArrivedPlayersForIntegration(TOURNAMENT_ID);
    const a = players.find((p) => p.id === "player-a")!;
    const b = players.find((p) => p.id === "player-b")!;

    expect(a.initialStackTaken).toBe(true);
    expect(a.rebuys).toBe(1);
    expect(b.initialStackTaken).toBe(false);
    expect(b.rebuys).toBe(0);
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

describe("getDerivedEliminationPlaces -- dynamic recalculation", () => {
  function attendanceMap(arrivedPlayerIds: string[]) {
    return new Map(arrivedPlayerIds.map((id) => [id, { arrived: true, arrived_at: "x" }]));
  }

  it("17 arrived, one eliminated -> place 17", async () => {
    mocks.findAttendanceByTournamentId.mockResolvedValue(
      attendanceMap(Array.from({ length: 17 }, (_, i) => `p${i + 1}`))
    );
    mocks.findEliminationsByTournamentId.mockResolvedValue(
      new Map([["p1", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }]])
    );

    const places = await getDerivedEliminationPlaces(TOURNAMENT_ID);
    expect(places.get("p1")).toBe(17);
  });

  it("two MORE players arrive later -- the already-eliminated player's place shifts from 17 to 19, no re-click needed", async () => {
    mocks.findEliminationsByTournamentId.mockResolvedValue(
      new Map([["p1", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }]])
    );

    mocks.findAttendanceByTournamentId.mockResolvedValue(
      attendanceMap(Array.from({ length: 17 }, (_, i) => `p${i + 1}`))
    );
    const before = await getDerivedEliminationPlaces(TOURNAMENT_ID);
    expect(before.get("p1")).toBe(17);

    mocks.findAttendanceByTournamentId.mockResolvedValue(
      attendanceMap(Array.from({ length: 19 }, (_, i) => `p${i + 1}`))
    );
    const after = await getDerivedEliminationPlaces(TOURNAMENT_ID);
    expect(after.get("p1")).toBe(19);
  });

  it("registered but never arrived does not increase field size", async () => {
    // Only 17 players ever have an attendance row at all -- a
    // registered-but-not-arrived player simply has no row here (matching
    // tournament_attendance's own semantics), so it can't inflate fieldSize.
    mocks.findAttendanceByTournamentId.mockResolvedValue(
      attendanceMap(Array.from({ length: 17 }, (_, i) => `p${i + 1}`))
    );
    mocks.findEliminationsByTournamentId.mockResolvedValue(
      new Map([["p1", { eliminated: true, eliminated_at: "x" }]])
    );

    const places = await getDerivedEliminationPlaces(TOURNAMENT_ID);
    expect(places.get("p1")).toBe(17);
  });

  it("arrival correction (a mistaken Пришел is unchecked) shrinks the field and recalculates places", async () => {
    mocks.findEliminationsByTournamentId.mockResolvedValue(
      new Map([["p1", { eliminated: true, eliminated_at: "x" }]])
    );

    mocks.findAttendanceByTournamentId.mockResolvedValue(
      new Map([
        ...Array.from({ length: 17 }, (_, i) => [`p${i + 1}`, { arrived: true, arrived_at: "x" }] as const),
      ])
    );
    const before = await getDerivedEliminationPlaces(TOURNAMENT_ID);
    expect(before.get("p1")).toBe(17);

    // p17's arrival gets corrected to false -- no longer counts.
    const correctedAttendance: [string, { arrived: boolean; arrived_at: string | null }][] = [
      ...Array.from({ length: 16 }, (_, i) => [`p${i + 1}`, { arrived: true, arrived_at: "x" }] as [string, { arrived: boolean; arrived_at: string | null }]),
      ["p17", { arrived: false, arrived_at: null }],
    ];
    mocks.findAttendanceByTournamentId.mockResolvedValue(new Map(correctedAttendance));
    const after = await getDerivedEliminationPlaces(TOURNAMENT_ID);
    expect(after.get("p1")).toBe(16);
  });

  it("un-eliminate removes the player from elimination order entirely and recalculates the rest", async () => {
    mocks.findAttendanceByTournamentId.mockResolvedValue(attendanceMap(["p1", "p2", "p3"]));
    mocks.findEliminationsByTournamentId.mockResolvedValue(
      new Map([
        ["p1", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }],
        ["p2", { eliminated: true, eliminated_at: "2026-08-25T19:05:00.000Z" }],
      ])
    );
    const before = await getDerivedEliminationPlaces(TOURNAMENT_ID);
    expect(before.get("p1")).toBe(3);
    expect(before.get("p2")).toBe(2);

    // p1 is un-eliminated.
    mocks.findEliminationsByTournamentId.mockResolvedValue(
      new Map([
        ["p1", { eliminated: false, eliminated_at: null }],
        ["p2", { eliminated: true, eliminated_at: "2026-08-25T19:05:00.000Z" }],
      ])
    );
    const after = await getDerivedEliminationPlaces(TOURNAMENT_ID);
    expect(after.has("p1")).toBe(false);
    expect(after.get("p2")).toBe(3);
  });

  it("simultaneous eliminations (identical timestamp) resolve deterministically by player_id, not iteration order", async () => {
    mocks.findAttendanceByTournamentId.mockResolvedValue(attendanceMap(["pA", "pB"]));
    mocks.findEliminationsByTournamentId.mockResolvedValue(
      new Map([
        ["pB", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }],
        ["pA", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }],
      ])
    );

    const first = await getDerivedEliminationPlaces(TOURNAMENT_ID);
    const second = await getDerivedEliminationPlaces(TOURNAMENT_ID);
    expect(first).toEqual(second);
    // pA sorts before pB lexicographically -> pA is treated as eliminated
    // first (worse place).
    expect(first.get("pA")).toBe(2);
    expect(first.get("pB")).toBe(1);
  });
});

describe("reorderTournamentEliminations -- \"Исправить порядок выбывания\"", () => {
  it("reassigns the existing eliminated_at set to the corrected order and recomputes places accordingly", async () => {
    // p1 busted first (worst), p2 second, p3 third (best of the three) --
    // admin corrects the real order to p1, p3, p2 (p3 actually busted
    // before p2).
    mocks.findEliminationsByTournamentId.mockResolvedValue(
      new Map([
        ["p1", { eliminated: true, eliminated_at: "2026-01-01T00:00:00.000Z" }],
        ["p2", { eliminated: true, eliminated_at: "2026-01-01T00:01:00.000Z" }],
        ["p3", { eliminated: true, eliminated_at: "2026-01-01T00:02:00.000Z" }],
      ])
    );

    const result = await reorderTournamentEliminations(TOURNAMENT_ID, ["p1", "p3", "p2"]);

    expect(result).toEqual({ ok: true });
    // The existing timestamp SET (00:00, 00:01, 00:02) is reassigned in the
    // corrected order -- never fabricated new times.
    expect(mocks.upsertElimination).toHaveBeenCalledWith(
      expect.objectContaining({ player_id: "p1", eliminated_at: "2026-01-01T00:00:00.000Z" })
    );
    expect(mocks.upsertElimination).toHaveBeenCalledWith(
      expect.objectContaining({ player_id: "p3", eliminated_at: "2026-01-01T00:01:00.000Z" })
    );
    expect(mocks.upsertElimination).toHaveBeenCalledWith(
      expect.objectContaining({ player_id: "p2", eliminated_at: "2026-01-01T00:02:00.000Z" })
    );

    // Feeding the newly-assigned timestamps back through the SAME canonical
    // placement algorithm confirms the corrected order actually took effect
    // (fieldSize=3: first eliminated -> 3, then 2, then 1).
    mocks.findAttendanceByTournamentId.mockResolvedValue(
      new Map([
        ["p1", { arrived: true, arrived_at: "x" }],
        ["p2", { arrived: true, arrived_at: "x" }],
        ["p3", { arrived: true, arrived_at: "x" }],
      ])
    );
    mocks.findEliminationsByTournamentId.mockResolvedValue(
      new Map([
        ["p1", { eliminated: true, eliminated_at: "2026-01-01T00:00:00.000Z" }],
        ["p3", { eliminated: true, eliminated_at: "2026-01-01T00:01:00.000Z" }],
        ["p2", { eliminated: true, eliminated_at: "2026-01-01T00:02:00.000Z" }],
      ])
    );
    const places = await getDerivedEliminationPlaces(TOURNAMENT_ID);
    expect(places.get("p1")).toBe(3);
    expect(places.get("p3")).toBe(2);
    expect(places.get("p2")).toBe(1);
  });

  it("duplicate source timestamps still produce a strictly-increasing, deterministic reassignment", async () => {
    // p1 and p2 both landed at the exact same timestamp (poller latency) --
    // admin knows p1 actually busted first.
    mocks.findEliminationsByTournamentId.mockResolvedValue(
      new Map([
        ["p1", { eliminated: true, eliminated_at: "2026-01-01T00:00:00.000Z" }],
        ["p2", { eliminated: true, eliminated_at: "2026-01-01T00:00:00.000Z" }],
      ])
    );

    await reorderTournamentEliminations(TOURNAMENT_ID, ["p1", "p2"]);

    const p1Call = mocks.upsertElimination.mock.calls.find((c) => c[0].player_id === "p1")![0];
    const p2Call = mocks.upsertElimination.mock.calls.find((c) => c[0].player_id === "p2")![0];
    // Strictly increasing -- p2's timestamp can never tie or precede p1's,
    // so the corrected order is unambiguous regardless of any tie-break
    // computeDerivedEliminationPlaces might otherwise apply.
    expect(new Date(p2Call.eliminated_at).getTime()).toBeGreaterThan(
      new Date(p1Call.eliminated_at).getTime()
    );
  });

  it("rejects a submitted order that no longer matches the current eliminated set (stale client)", async () => {
    mocks.findEliminationsByTournamentId.mockResolvedValue(
      new Map([
        ["p1", { eliminated: true, eliminated_at: "2026-01-01T00:00:00.000Z" }],
        ["p2", { eliminated: true, eliminated_at: "2026-01-01T00:01:00.000Z" }],
      ])
    );

    // p3 has since been un-eliminated server-side; this client is stale.
    const result = await reorderTournamentEliminations(TOURNAMENT_ID, ["p1", "p2", "p3"]);

    expect(result).toEqual({
      ok: false,
      error: expect.any(String),
    });
    expect(mocks.upsertElimination).not.toHaveBeenCalled();
  });

  it("rejects a shorter list even if every submitted id is currently eliminated (missing p2)", async () => {
    mocks.findEliminationsByTournamentId.mockResolvedValue(
      new Map([
        ["p1", { eliminated: true, eliminated_at: "2026-01-01T00:00:00.000Z" }],
        ["p2", { eliminated: true, eliminated_at: "2026-01-01T00:01:00.000Z" }],
      ])
    );

    const result = await reorderTournamentEliminations(TOURNAMENT_ID, ["p1"]);

    expect(result.ok).toBe(false);
    expect(mocks.upsertElimination).not.toHaveBeenCalled();
  });
});

// Player-facing "В игре"/"Выбыли" read model -- same authoritative source
// as the Poker Clock integration (getArrivedPlayersForIntegration above),
// sanitized to the browser-safe PublicActiveTournamentPlayer shape. Covers
// the split's underlying data contract; app/tournaments/[id]/page.tsx does
// the actual "В игре" vs "Выбыли" filtering/sorting client-side (see
// lib/__tests__/tournament-helpers.test.ts for those pure sort helpers).
describe("getActiveTournamentPlayersForPublicView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findAttendanceByTournamentId.mockResolvedValue(new Map());
    mocks.findEliminationsByTournamentId.mockResolvedValue(new Map());
    mocks.findRebuyStateByTournamentId.mockResolvedValue(new Map());
    mocks.findRatingPointsBySeasonId.mockResolvedValue([]);
  });

  function playerRow(id: string, displayName: string) {
    return {
      player_id: id,
      arrived_at: "2026-08-25T18:00:00.000Z",
      players: {
        display_name: displayName,
        admin_display_name: null,
        custom_avatar_url: null,
        telegram_avatar_url: null,
      },
    };
  }

  it("includes BOTH active and eliminated arrived players -- the split happens client-side, not here", async () => {
    mocks.findById.mockResolvedValue(baseTournament({ season_id: null }));
    mocks.findAttendedPlayersWithDetails.mockResolvedValue([
      playerRow("p1", "Still Playing"),
      playerRow("p2", "Busted Out"),
    ]);
    mocks.findEliminationsByTournamentId.mockResolvedValue(
      new Map([["p2", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }]])
    );

    const players = await getActiveTournamentPlayersForPublicView(TOURNAMENT_ID);

    expect(players.find((p) => p.playerId === "p1")).toMatchObject({ eliminated: false, place: null });
    expect(players.find((p) => p.playerId === "p2")).toMatchObject({ eliminated: true });
  });

  it("exposes the SAME canonical derived place as the integration endpoint, never recalculated here", async () => {
    mocks.findById.mockResolvedValue(baseTournament({ season_id: null }));
    mocks.findAttendedPlayersWithDetails.mockResolvedValue([
      playerRow("p1", "Field Player 1"),
      playerRow("p2", "Busted"),
    ]);
    mocks.findEliminationsByTournamentId.mockResolvedValue(
      new Map([["p2", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }]])
    );

    const players = await getActiveTournamentPlayersForPublicView(TOURNAMENT_ID);

    // fieldSize=2, eliminationIndex=0 -> place 2 -- same
    // computeDerivedEliminationPlaces call getArrivedPlayersForIntegration
    // makes, not a second one.
    expect(players.find((p) => p.playerId === "p2")?.place).toBe(2);
    expect(players.find((p) => p.playerId === "p1")?.place).toBeNull();
  });

  it("un-elimination (eliminated: true -> false between polls) is naturally reflected on the next call -- no separate participant source of truth", async () => {
    mocks.findById.mockResolvedValue(baseTournament({ season_id: null }));
    mocks.findAttendedPlayersWithDetails.mockResolvedValue([playerRow("p1", "Player")]);

    mocks.findEliminationsByTournamentId.mockResolvedValueOnce(
      new Map([["p1", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }]])
    );
    const eliminated = await getActiveTournamentPlayersForPublicView(TOURNAMENT_ID);
    expect(eliminated[0].eliminated).toBe(true);

    // Admin corrects the elimination -- the very next call reflects it, no
    // caching/snapshot in between.
    mocks.findEliminationsByTournamentId.mockResolvedValueOnce(new Map());
    const restored = await getActiveTournamentPlayersForPublicView(TOURNAMENT_ID);
    expect(restored[0].eliminated).toBe(false);
    expect(restored[0].place).toBeNull();
  });

  it("response contains no PII/admin-only fields -- no rebuys/addons/initialStackTaken/eliminatedAt beyond the public shape", async () => {
    mocks.findById.mockResolvedValue(baseTournament({ season_id: null }));
    mocks.findAttendedPlayersWithDetails.mockResolvedValue([playerRow("p1", "Player")]);
    mocks.findEliminationsByTournamentId.mockResolvedValue(
      new Map([["p1", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }]])
    );

    const [player] = await getActiveTournamentPlayersForPublicView(TOURNAMENT_ID);

    expect(Object.keys(player).sort()).toEqual(
      ["avatarUrl", "displayName", "eliminated", "place", "playerId", "rating"].sort()
    );
    const raw = JSON.stringify(player);
    for (const forbidden of ["telegram", "email", "phone", "role", "rebuy", "addon", "initialstack", "moderation", "access"]) {
      expect(raw.toLowerCase()).not.toContain(forbidden);
    }
  });
});
