import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetClubStatisticTop = vi.fn();

vi.mock("@/features/club-statistics", () => ({
  getClubStatisticTop: mockGetClubStatisticTop,
  CLUB_STATISTIC_METRICS: [
    "tournaments_played",
    "wins",
    "lifetime_rating",
    "itm",
    "referrals",
    "knockouts",
    "boss_knockouts",
    "headhunter",
  ],
}));

const { GET } = await import("@/app/api/leaderboard/statistics/route");

beforeEach(() => {
  mockGetClubStatisticTop.mockReset();
});

function requestFor(query: string) {
  return new Request(`http://localhost/api/leaderboard/statistics${query}`);
}

describe("GET /api/leaderboard/statistics -- allowlist validation", () => {
  it("rejects a missing metric with 400", async () => {
    const response = await GET(requestFor(""));
    expect(response.status).toBe(400);
    expect(mockGetClubStatisticTop).not.toHaveBeenCalled();
  });

  it("rejects an unknown metric with 400 -- no arbitrary field/name reaches the query layer", async () => {
    const response = await GET(requestFor("?metric=rating_points"));
    expect(response.status).toBe(400);
    expect(mockGetClubStatisticTop).not.toHaveBeenCalled();
  });

  it("rejects a SQL-injection-shaped metric value with 400", async () => {
    const response = await GET(requestFor("?metric=knockouts%3B%20DROP%20TABLE%20results"));
    expect(response.status).toBe(400);
    expect(mockGetClubStatisticTop).not.toHaveBeenCalled();
  });

  it("accepts every allowlisted metric and returns it in the response", async () => {
    mockGetClubStatisticTop.mockResolvedValue([]);
    const response = await GET(requestFor("?metric=knockouts"));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.metric).toBe("knockouts");
    expect(mockGetClubStatisticTop).toHaveBeenCalledWith("knockouts");
  });

  it("returns the topPlayers list from the feature layer unchanged", async () => {
    const players = [{ playerId: "p1", displayName: "Alice", username: null, telegramAvatarUrl: null, customAvatarUrl: null, value: 30, rank: 1 }];
    mockGetClubStatisticTop.mockResolvedValue(players);
    const response = await GET(requestFor("?metric=wins"));
    const json = await response.json();
    expect(json.topPlayers).toEqual(players);
  });
});
