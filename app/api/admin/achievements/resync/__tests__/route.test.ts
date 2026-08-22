import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPlayerRepository = { listOrderedByCreatedAtDesc: vi.fn() };
const mockPreview = vi.fn();
const mockSync = vi.fn();

vi.mock("@/lib/repositories", () => ({ playerRepository: mockPlayerRepository }));
vi.mock("@/features/achievements", () => ({
  previewPlayerAchievementSync: mockPreview,
  syncPlayerAchievements: mockSync,
}));

const { POST } = await import("@/app/api/admin/achievements/resync/route");

function request(body: unknown) {
  return new Request("http://localhost/api/admin/achievements/resync", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function plan(overrides = {}) {
  return {
    currentRows: 2,
    projectedRows: 4,
    progressChanges: 2,
    unchanged: 2,
    newlyCompletedCodes: ["pro_2500_rating"],
    projectedCompletedCodes: ["rookie_100_rating", "pro_2500_rating"],
    staleCodes: ["legacy_code"],
    ...overrides,
  };
}

beforeEach(() => {
  mockPlayerRepository.listOrderedByCreatedAtDesc.mockReset().mockResolvedValue([
    { id: "p1" },
    { id: "p2" },
  ]);
  mockPreview.mockReset().mockResolvedValue(plan());
  mockSync.mockReset().mockResolvedValue(plan());
});

describe("achievement full resync", () => {
  it("defaults to read-only dry-run and returns the full report", async () => {
    const response = await POST(request({}));
    const json = await response.json();

    expect(json).toMatchObject({
      mode: "dry-run",
      totalPlayers: 2,
      currentAchievementRows: 4,
      projectedRows: 8,
      progressChanges: 4,
      newCompletions: 2,
      unchanged: 4,
      staleUnknownCodes: ["legacy_code"],
    });
    expect(json.newCompletionCountByCode).toEqual({ pro_2500_rating: 2 });
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("apply explicitly suppresses Activity Feed events", async () => {
    await POST(request({ apply: true }));
    expect(mockSync).toHaveBeenCalledTimes(2);
    expect(mockSync).toHaveBeenCalledWith("p1", { publishActivityEvents: false });
    expect(mockSync).toHaveBeenCalledWith("p2", { publishActivityEvents: false });
  });

  it("reports per-player errors without aborting the batch", async () => {
    mockPreview.mockImplementation((playerId: string) =>
      playerId === "p2" ? Promise.reject(new Error("broken history")) : Promise.resolve(plan()),
    );
    const json = await (await POST(request({}))).json();
    expect(json.failed).toBe(1);
    expect(json.errors).toEqual([{ player_id: "p2", error: "broken history" }]);
  });

  it("clamps batch size to the safe range", async () => {
    expect((await (await POST(request({ batchSize: 9999 }))).json()).batchSize).toBe(100);
    expect((await (await POST(request({ batchSize: -1 }))).json()).batchSize).toBe(1);
  });
});
