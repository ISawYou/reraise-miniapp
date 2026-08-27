import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFindActive = vi.fn();
const mockGetOfficialSeasonLeaderboard = vi.fn();

vi.mock("@/lib/repositories", () => ({
  seasonRepository: { findActive: mockFindActive },
}));

vi.mock("@/features/leaderboard", () => ({
  getOfficialSeasonLeaderboard: mockGetOfficialSeasonLeaderboard,
}));

const { GET, dynamic } = await import("@/app/api/leaderboard/route");

beforeEach(() => {
  mockFindActive.mockReset();
  mockGetOfficialSeasonLeaderboard.mockReset();
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

  it("returns the season, official leaderboard, and out-of-competition rows on success", async () => {
    mockFindActive.mockResolvedValue({ id: "s1", title: "Season 1" });
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({
      leaderboard: [
        {
          player_id: "p1",
          username: "p1",
          display_name: "Player 1",
          telegram_avatar_url: null,
          custom_avatar_url: null,
          rating: 100,
          officialRank: 1,
        },
      ],
      outOfCompetition: [
        {
          player_id: "p0",
          username: "owner",
          display_name: "Owner",
          telegram_avatar_url: null,
          custom_avatar_url: null,
          rating: 1000,
        },
      ],
    });

    const response = await GET();
    const json = await response.json();

    expect(mockGetOfficialSeasonLeaderboard).toHaveBeenCalledWith("s1");
    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      season: { id: "s1", title: "Season 1" },
      leaderboard: [{ player_id: "p1", rating: 100, officialRank: 1 }],
      outOfCompetition: [{ player_id: "p0", rating: 1000 }],
    });
  });

  it("returns 404 when there is no active season", async () => {
    mockFindActive.mockResolvedValue(null);

    const response = await GET();
    const json = await response.json();

    expect(mockGetOfficialSeasonLeaderboard).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
    expect(json).toMatchObject({ error: expect.any(String) });
  });

  it("returns 500 when leaderboard computation throws", async () => {
    mockFindActive.mockResolvedValue({ id: "s1", title: "Season 1" });
    mockGetOfficialSeasonLeaderboard.mockRejectedValue(new Error("db unreachable"));

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toMatchObject({ error: "db unreachable" });
  });
});
