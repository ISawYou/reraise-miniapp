import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFindActive = vi.fn();
const mockGetSeasonLeaderboard = vi.fn();

vi.mock("@/lib/repositories", () => ({
  seasonRepository: { findActive: mockFindActive },
}));

vi.mock("@/features/leaderboard", () => ({
  getSeasonLeaderboard: mockGetSeasonLeaderboard,
}));

const { GET, dynamic } = await import("@/app/api/leaderboard/route");

beforeEach(() => {
  mockFindActive.mockReset();
  mockGetSeasonLeaderboard.mockReset();
});

describe("GET /api/leaderboard", () => {
  // Regression guard for the fix that removed `export const revalidate = 60`
  // (which made `next build` execute this handler -- and therefore a real
  // Supabase query requiring SUPABASE_SERVICE_ROLE_KEY -- at image build
  // time). If this ever flips back to a value that makes the route eligible
  // for static generation, the GHCR build job's build-time Supabase
  // dependency comes back with it.
  it("is force-dynamic, never statically generated at build time", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns the season and leaderboard on success", async () => {
    mockFindActive.mockResolvedValue({ id: "s1", title: "Season 1" });
    mockGetSeasonLeaderboard.mockResolvedValue([
      {
        player_id: "p1",
        username: "p1",
        display_name: "Player 1",
        telegram_avatar_url: null,
        custom_avatar_url: null,
        rating: 100,
      },
    ]);

    const response = await GET();
    const json = await response.json();

    expect(mockGetSeasonLeaderboard).toHaveBeenCalledWith("s1");
    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      season: { id: "s1", title: "Season 1" },
      leaderboard: [{ player_id: "p1", rating: 100 }],
    });
  });

  it("returns 404 when there is no active season", async () => {
    mockFindActive.mockResolvedValue(null);

    const response = await GET();
    const json = await response.json();

    expect(mockGetSeasonLeaderboard).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
    expect(json).toMatchObject({ error: expect.any(String) });
  });

  it("returns 500 when leaderboard computation throws", async () => {
    mockFindActive.mockResolvedValue({ id: "s1", title: "Season 1" });
    mockGetSeasonLeaderboard.mockRejectedValue(new Error("db unreachable"));

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toMatchObject({ error: "db unreachable" });
  });
});
