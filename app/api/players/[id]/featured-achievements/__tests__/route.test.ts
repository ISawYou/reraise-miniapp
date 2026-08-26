import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetPlayerFromSessionServer = vi.fn();
const mockSaveFeaturedAchievementKeys = vi.fn();

vi.mock("@/features/auth-server", () => ({
  getPlayerFromSessionServer: mockGetPlayerFromSessionServer,
}));
vi.mock("@/features/featured-achievements", () => ({
  getFeaturedAchievementKeys: vi.fn(),
  saveFeaturedAchievementKeys: mockSaveFeaturedAchievementKeys,
}));

const { PUT } = await import("@/app/api/players/[id]/featured-achievements/route");

function putRequest(keys: unknown) {
  return new NextRequest("http://localhost/api/players/player-1/featured-achievements", {
    method: "PUT",
    body: JSON.stringify({ keys }),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockGetPlayerFromSessionServer.mockReset();
  mockSaveFeaturedAchievementKeys.mockReset();
});

describe("PUT /api/players/[id]/featured-achievements", () => {
  it("rejects a blocked player's still-valid session (getPlayerFromSessionServer already denies it)", async () => {
    // A blocked player's session cookie still verifies cryptographically,
    // but getPlayerFromSessionServer now resolves it to null.
    mockGetPlayerFromSessionServer.mockResolvedValue(null);

    const response = await PUT(putRequest(["royal_flush"]), ctx("player-1"));

    expect(response.status).toBe(403);
    expect(mockSaveFeaturedAchievementKeys).not.toHaveBeenCalled();
  });

  it("rejects editing another player's profile", async () => {
    mockGetPlayerFromSessionServer.mockResolvedValue({ id: "someone-else" });

    const response = await PUT(putRequest(["royal_flush"]), ctx("player-1"));

    expect(response.status).toBe(403);
    expect(mockSaveFeaturedAchievementKeys).not.toHaveBeenCalled();
  });

  it("allows an active player to edit their own featured achievements", async () => {
    mockGetPlayerFromSessionServer.mockResolvedValue({ id: "player-1" });
    mockSaveFeaturedAchievementKeys.mockResolvedValue(["royal_flush"]);

    const response = await PUT(putRequest(["royal_flush"]), ctx("player-1"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.keys).toEqual(["royal_flush"]);
  });
});
