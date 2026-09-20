import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAchievementHolders = vi.fn();

vi.mock("@/features/club-statistics", () => ({
  getAchievementHolders: mockGetAchievementHolders,
}));

const { GET } = await import("@/app/api/achievements/holders/route");

beforeEach(() => {
  mockGetAchievementHolders.mockReset();
});

function requestFor(query: string) {
  return new Request(`http://localhost/api/achievements/holders${query}`);
}

describe("GET /api/achievements/holders -- allowlist validation", () => {
  it("rejects a missing code with 400", async () => {
    const response = await GET(requestFor(""));
    expect(response.status).toBe(400);
    expect(mockGetAchievementHolders).not.toHaveBeenCalled();
  });

  it("rejects a code not on the allowlist with 400 -- e.g. a metric-based achievement code", async () => {
    const response = await GET(requestFor("?code=ten_itm"));
    expect(response.status).toBe(400);
    expect(mockGetAchievementHolders).not.toHaveBeenCalled();
  });

  it("accepts royal_flush", async () => {
    mockGetAchievementHolders.mockResolvedValue([]);
    const response = await GET(requestFor("?code=royal_flush"));
    expect(response.status).toBe(200);
    expect(mockGetAchievementHolders).toHaveBeenCalledWith("royal_flush");
  });

  it("accepts number_one", async () => {
    mockGetAchievementHolders.mockResolvedValue([]);
    const response = await GET(requestFor("?code=number_one"));
    expect(response.status).toBe(200);
    expect(mockGetAchievementHolders).toHaveBeenCalledWith("number_one");
  });
});
