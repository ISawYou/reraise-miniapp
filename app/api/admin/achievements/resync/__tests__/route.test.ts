import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPlayerRepository = {
  listOrderedByCreatedAtDesc: vi.fn(),
};

const mockResultRepository = {
  countByPlayerId: vi.fn(),
  countItmFinishesByPlayerId: vi.fn(),
};

const mockGetPlayerAchievementProgress = vi.fn();
const mockSyncPlayerAchievements = vi.fn();

vi.mock("@/lib/repositories", () => ({
  playerRepository: mockPlayerRepository,
  resultRepository: mockResultRepository,
}));

vi.mock("@/features/achievements", () => ({
  getPlayerAchievementProgress: mockGetPlayerAchievementProgress,
  syncPlayerAchievements: mockSyncPlayerAchievements,
}));

// Imported after the mocks, same pattern as features/__tests__/*.test.ts.
const { POST } = await import("@/app/api/admin/achievements/resync/route");

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/admin/achievements/resync", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function makePlayers(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `player-${i}` }));
}

beforeEach(() => {
  mockPlayerRepository.listOrderedByCreatedAtDesc.mockReset();
  mockResultRepository.countByPlayerId.mockReset().mockResolvedValue(0);
  mockResultRepository.countItmFinishesByPlayerId.mockReset().mockResolvedValue(0);
  mockGetPlayerAchievementProgress.mockReset().mockResolvedValue([]);
  mockSyncPlayerAchievements.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/admin/achievements/resync", () => {
  it("defaults to dry-run (no apply flag) and never calls syncPlayerAchievements", async () => {
    mockPlayerRepository.listOrderedByCreatedAtDesc.mockResolvedValue(makePlayers(3));

    const response = await POST(jsonRequest({}));
    const json = await response.json();

    expect(json.mode).toBe("dry-run");
    expect(json.totalPlayers).toBe(3);
    expect(mockSyncPlayerAchievements).not.toHaveBeenCalled();
  });

  it("dry-run reports playersWithResults, ITM thresholds, and projected completions without writing", async () => {
    mockPlayerRepository.listOrderedByCreatedAtDesc.mockResolvedValue(makePlayers(4));
    mockResultRepository.countByPlayerId.mockImplementation((id: string) =>
      Promise.resolve(id === "player-3" ? 0 : 5) // player-3 has no results
    );
    mockResultRepository.countItmFinishesByPlayerId.mockImplementation((id: string) => {
      if (id === "player-0") return Promise.resolve(100); // hits every threshold
      if (id === "player-1") return Promise.resolve(10); // hits gte1/gte10
      if (id === "player-2") return Promise.resolve(1); // hits gte1 only
      return Promise.resolve(0); // player-3: nothing
    });
    mockGetPlayerAchievementProgress.mockImplementation((id: string) => {
      if (id === "player-0") {
        return Promise.resolve([
          { code: "first_itm", currentValue: 1, completed: true },
          { code: "ten_itm", currentValue: 10, completed: true },
          { code: "twenty_five_itm", currentValue: 25, completed: true },
          { code: "hundred_itm", currentValue: 100, completed: true },
        ]);
      }
      if (id === "player-1") {
        return Promise.resolve([
          { code: "first_itm", currentValue: 1, completed: true },
          { code: "ten_itm", currentValue: 10, completed: true },
        ]);
      }
      if (id === "player-2") {
        return Promise.resolve([{ code: "first_itm", currentValue: 1, completed: true }]);
      }
      return Promise.resolve([]);
    });

    const response = await POST(jsonRequest({}));
    const json = await response.json();

    expect(json.totalPlayers).toBe(4);
    expect(json.playersWithResults).toBe(3); // all but player-3
    expect(json.itmThresholds).toEqual({ gte1: 3, gte10: 2, gte25: 1, gte100: 1 });
    expect(json.projectedCompletedItmAchievements).toEqual({
      first_itm: 3,
      ten_itm: 2,
      twenty_five_itm: 1,
      hundred_itm: 1,
    });
    expect(mockSyncPlayerAchievements).not.toHaveBeenCalled();
  });

  it("apply mode calls syncPlayerAchievements for every player and reports success/failure", async () => {
    mockPlayerRepository.listOrderedByCreatedAtDesc.mockResolvedValue(makePlayers(3));
    mockSyncPlayerAchievements.mockImplementation((id: string) =>
      id === "player-1" ? Promise.reject(new Error("boom")) : Promise.resolve(undefined)
    );

    const response = await POST(jsonRequest({ apply: true }));
    const json = await response.json();

    expect(json.mode).toBe("apply");
    expect(mockSyncPlayerAchievements).toHaveBeenCalledTimes(3);
    expect(json.processed).toBe(3);
    expect(json.succeeded).toBe(2);
    expect(json.failed).toBe(1);
    expect(json.errors).toEqual([{ player_id: "player-1", error: "boom" }]);
    expect(json.ok).toBe(false);
  });

  it("apply mode with zero failures reports ok: true", async () => {
    mockPlayerRepository.listOrderedByCreatedAtDesc.mockResolvedValue(makePlayers(2));

    const response = await POST(jsonRequest({ apply: true }));
    const json = await response.json();

    expect(json.ok).toBe(true);
    expect(json.succeeded).toBe(2);
    expect(json.failed).toBe(0);
  });

  it("clamps an out-of-range batchSize into [1, 100]", async () => {
    mockPlayerRepository.listOrderedByCreatedAtDesc.mockResolvedValue(makePlayers(1));

    const tooLarge = await POST(jsonRequest({ batchSize: 99999 }));
    expect((await tooLarge.json()).batchSize).toBe(100);

    const tooSmall = await POST(jsonRequest({ batchSize: -5 }));
    expect((await tooSmall.json()).batchSize).toBe(1);

    const defaultCase = await POST(jsonRequest({}));
    expect((await defaultCase.json()).batchSize).toBe(25);
  });

  it("processes players across multiple batches when batchSize is smaller than the player count", async () => {
    mockPlayerRepository.listOrderedByCreatedAtDesc.mockResolvedValue(makePlayers(7));

    const response = await POST(jsonRequest({ apply: true, batchSize: 2 }));
    const json = await response.json();

    expect(json.totalPlayers).toBe(7);
    expect(json.processed).toBe(7);
    expect(mockSyncPlayerAchievements).toHaveBeenCalledTimes(7);
  });
});
