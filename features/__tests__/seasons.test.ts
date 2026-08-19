import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSeasonRepository = {
  listAll: vi.fn(),
  setActive: vi.fn().mockResolvedValue(undefined),
};

const mockAchievementRepository = {
  findSummariesByPlayerId: vi.fn().mockResolvedValue([]),
  upsertMany: vi.fn().mockResolvedValue(undefined),
};

const mockGetSeasonLeaderboard = vi.fn();

vi.mock("@/lib/repositories", () => ({
  seasonRepository: mockSeasonRepository,
  achievementRepository: mockAchievementRepository,
}));

vi.mock("@/features/leaderboard", () => ({
  getSeasonLeaderboard: mockGetSeasonLeaderboard,
}));

// Real features/achievements.ts (only its achievementRepository import is
// mocked, via the shared @/lib/repositories mock above) -- exercises the
// actual grantEventAutomaticAchievement, not a stub, for genuine
// end-to-end confidence on the idempotency/completed_at behavior.
const { closeSeason } = await import("@/features/seasons");

const SEASON_ID = "season-1";
const NOW_ISO = "2026-08-20T12:00:00.000Z";

function season(overrides: Partial<{ id: string; title: string; is_active: boolean }> = {}) {
  return {
    id: SEASON_ID,
    title: "Сезон 1",
    start_date: "2026-01-01",
    end_date: "2026-01-31",
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function entry(playerId: string, rating: number) {
  return {
    player_id: playerId,
    username: null,
    display_name: playerId,
    telegram_avatar_url: null,
    custom_avatar_url: null,
    rating,
  };
}

function upsertedRows() {
  return mockAchievementRepository.upsertMany.mock.calls.flatMap(([rows]) => rows) as Array<{
    player_id: string;
    achievement_code: string;
    completed_at: string | null;
  }>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
  mockSeasonRepository.listAll.mockReset();
  mockSeasonRepository.setActive.mockReset().mockResolvedValue(undefined);
  mockAchievementRepository.findSummariesByPlayerId.mockReset().mockResolvedValue([]);
  mockAchievementRepository.upsertMany.mockClear();
  mockGetSeasonLeaderboard.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("closeSeason", () => {
  it("grants Number One to the sole winner and closes the season", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([season()]);
    mockGetSeasonLeaderboard.mockResolvedValue([entry("winner", 100), entry("runner-up", 80)]);

    const result = await closeSeason(SEASON_ID);

    expect(result).toEqual({
      status: "closed",
      seasonId: SEASON_ID,
      winnerPlayerId: "winner",
      winnerRating: 100,
    });

    const rows = upsertedRows();
    expect(rows).toEqual([
      { player_id: "winner", achievement_code: "number_one", current_value: 1, completed_at: NOW_ISO, updated_at: NOW_ISO },
    ]);
    // #2 never gets a number_one row at all.
    expect(rows.some((r) => r.player_id === "runner-up")).toBe(false);

    expect(mockSeasonRepository.setActive).toHaveBeenCalledWith(SEASON_ID, false);
  });

  it("does NOT grant the runner-up (#2) Number One", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([season()]);
    mockGetSeasonLeaderboard.mockResolvedValue([entry("winner", 100), entry("runner-up", 80)]);

    await closeSeason(SEASON_ID);

    const grantedPlayerIds = upsertedRows().map((r) => r.player_id);
    expect(grantedPlayerIds).toEqual(["winner"]);
  });

  it("a repeat finalization attempt on an already-closed season is rejected, not re-run", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([season({ is_active: false })]);

    await expect(closeSeason(SEASON_ID)).rejects.toThrow(/уже закрыт/);
    expect(mockGetSeasonLeaderboard).not.toHaveBeenCalled();
    expect(mockAchievementRepository.upsertMany).not.toHaveBeenCalled();
    expect(mockSeasonRepository.setActive).not.toHaveBeenCalled();
  });

  it("rejects finalizing a season that doesn't exist", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([]);
    await expect(closeSeason("does-not-exist")).rejects.toThrow(/не найден/);
  });

  it("retrying a grant preserves the original completed_at (idempotent)", async () => {
    const ORIGINAL_COMPLETED_AT = "2025-01-01T00:00:00.000Z";
    mockSeasonRepository.listAll.mockResolvedValue([season()]);
    mockGetSeasonLeaderboard.mockResolvedValue([entry("winner", 100)]);
    mockAchievementRepository.findSummariesByPlayerId.mockResolvedValue([
      { achievement_code: "number_one", current_value: 1, completed_at: ORIGINAL_COMPLETED_AT },
    ]);

    await closeSeason(SEASON_ID);

    const row = upsertedRows().find((r) => r.achievement_code === "number_one");
    expect(row?.completed_at).toBe(ORIGINAL_COMPLETED_AT);
    expect(row?.completed_at).not.toBe(NOW_ISO);
  });

  it("a tie for #1 is NOT resolved by guessing -- no grant, season stays open", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([season()]);
    mockGetSeasonLeaderboard.mockResolvedValue([
      entry("player-a", 100),
      entry("player-b", 100),
      entry("player-c", 50),
    ]);

    const result = await closeSeason(SEASON_ID);

    expect(result).toEqual({
      status: "tie",
      seasonId: SEASON_ID,
      tiedPlayerIds: ["player-a", "player-b"],
      rating: 100,
    });
    expect(mockAchievementRepository.upsertMany).not.toHaveBeenCalled();
    expect(mockSeasonRepository.setActive).not.toHaveBeenCalled();
  });

  it("a three-way tie for #1 reports all three tied players", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([season()]);
    mockGetSeasonLeaderboard.mockResolvedValue([
      entry("player-a", 50),
      entry("player-b", 50),
      entry("player-c", 50),
    ]);

    const result = await closeSeason(SEASON_ID);

    expect(result.status).toBe("tie");
    if (result.status === "tie") {
      expect(result.tiedPlayerIds.sort()).toEqual(["player-a", "player-b", "player-c"]);
    }
  });

  it("a tie further down the leaderboard (not at #1) does not block finalization", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([season()]);
    mockGetSeasonLeaderboard.mockResolvedValue([
      entry("winner", 100),
      entry("tied-2nd-a", 50),
      entry("tied-2nd-b", 50),
    ]);

    const result = await closeSeason(SEASON_ID);

    expect(result).toMatchObject({ status: "closed", winnerPlayerId: "winner" });
  });

  it("no results at all closes the season without granting anything", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([season()]);
    mockGetSeasonLeaderboard.mockResolvedValue([]);

    const result = await closeSeason(SEASON_ID);

    expect(result).toEqual({ status: "no_results", seasonId: SEASON_ID });
    expect(mockAchievementRepository.upsertMany).not.toHaveBeenCalled();
    expect(mockSeasonRepository.setActive).toHaveBeenCalledWith(SEASON_ID, false);
  });
});
