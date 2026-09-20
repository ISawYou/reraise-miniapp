import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTournamentsPlayedTop: vi.fn(),
  getWinsTop: vi.fn(),
  getItmTop: vi.fn(),
  getReferralsTop: vi.fn(),
  getKnockoutsTop: vi.fn(),
  getBossKnockoutsTop: vi.fn(),
  getHeadhunterTop: vi.fn(),
  getAchievementHolders: vi.fn(),
  getAllTimeLeaderboard: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  clubStatisticsRepository: {
    getTournamentsPlayedTop: mocks.getTournamentsPlayedTop,
    getWinsTop: mocks.getWinsTop,
    getItmTop: mocks.getItmTop,
    getReferralsTop: mocks.getReferralsTop,
    getKnockoutsTop: mocks.getKnockoutsTop,
    getBossKnockoutsTop: mocks.getBossKnockoutsTop,
    getHeadhunterTop: mocks.getHeadhunterTop,
    getAchievementHolders: mocks.getAchievementHolders,
  },
}));

vi.mock("@/features/leaderboard", () => ({
  getAllTimeLeaderboard: mocks.getAllTimeLeaderboard,
}));

const { getClubStatisticTop, getAchievementHolders, CLUB_STATISTIC_METRIC } = await import(
  "@/features/club-statistics"
);

function statRow(overrides: Partial<{
  player_id: string;
  username: string | null;
  display_name: string;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
  value: number;
}> = {}) {
  return {
    player_id: "p1",
    username: "alice",
    display_name: "Alice",
    telegram_avatar_url: null,
    custom_avatar_url: null,
    value: 10,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getClubStatisticTop -- each metric maps to its intended source", () => {
  it("tournaments_played reads through getTournamentsPlayedTop (results row count)", async () => {
    mocks.getTournamentsPlayedTop.mockResolvedValue([statRow()]);
    await getClubStatisticTop(CLUB_STATISTIC_METRIC.TOURNAMENTS_PLAYED);
    expect(mocks.getTournamentsPlayedTop).toHaveBeenCalledWith(10);
    expect(mocks.getWinsTop).not.toHaveBeenCalled();
  });

  it("wins reads through getWinsTop (place = 1)", async () => {
    mocks.getWinsTop.mockResolvedValue([statRow()]);
    await getClubStatisticTop(CLUB_STATISTIC_METRIC.WINS);
    expect(mocks.getWinsTop).toHaveBeenCalledWith(10);
  });

  it("itm reads through getItmTop (itm_points > 0)", async () => {
    mocks.getItmTop.mockResolvedValue([statRow()]);
    await getClubStatisticTop(CLUB_STATISTIC_METRIC.ITM);
    expect(mocks.getItmTop).toHaveBeenCalledWith(10);
  });

  it("referrals reads through getReferralsTop (players.referral_count)", async () => {
    mocks.getReferralsTop.mockResolvedValue([statRow()]);
    await getClubStatisticTop(CLUB_STATISTIC_METRIC.REFERRALS);
    expect(mocks.getReferralsTop).toHaveBeenCalledWith(10);
  });

  it("knockouts reads through getKnockoutsTop (SUM(knockouts))", async () => {
    mocks.getKnockoutsTop.mockResolvedValue([statRow()]);
    await getClubStatisticTop(CLUB_STATISTIC_METRIC.KNOCKOUTS);
    expect(mocks.getKnockoutsTop).toHaveBeenCalledWith(10);
  });

  it("boss_knockouts reads through getBossKnockoutsTop (SUM(boss_knockouts)), never conflated with ordinary knockouts", async () => {
    mocks.getBossKnockoutsTop.mockResolvedValue([statRow()]);
    await getClubStatisticTop(CLUB_STATISTIC_METRIC.BOSS_KNOCKOUTS);
    expect(mocks.getBossKnockoutsTop).toHaveBeenCalledWith(10);
    expect(mocks.getKnockoutsTop).not.toHaveBeenCalled();
  });

  it("headhunter reads through getHeadhunterTop (MAX(knockouts) per player, not a sum)", async () => {
    mocks.getHeadhunterTop.mockResolvedValue([statRow()]);
    await getClubStatisticTop(CLUB_STATISTIC_METRIC.HEADHUNTER);
    expect(mocks.getHeadhunterTop).toHaveBeenCalledWith(10);
  });

  it("lifetime_rating reuses getAllTimeLeaderboard's exact values -- never queries clubStatisticsRepository at all", async () => {
    mocks.getAllTimeLeaderboard.mockResolvedValue([
      { player_id: "p1", username: "a", display_name: "Alice", telegram_avatar_url: null, custom_avatar_url: null, rating: 500 },
    ]);
    const result = await getClubStatisticTop(CLUB_STATISTIC_METRIC.LIFETIME_RATING);
    expect(mocks.getAllTimeLeaderboard).toHaveBeenCalledTimes(1);
    expect(result[0].value).toBe(500);
    expect(mocks.getTournamentsPlayedTop).not.toHaveBeenCalled();
    expect(mocks.getWinsTop).not.toHaveBeenCalled();
    expect(mocks.getKnockoutsTop).not.toHaveBeenCalled();
  });
});

describe("getClubStatisticTop -- TOP-10 limit and rank assignment", () => {
  it("requests exactly 10 from the repository for a GROUP-BY metric", async () => {
    mocks.getKnockoutsTop.mockResolvedValue([]);
    await getClubStatisticTop(CLUB_STATISTIC_METRIC.KNOCKOUTS);
    expect(mocks.getKnockoutsTop).toHaveBeenCalledWith(10);
  });

  it("assigns sequential 1-based rank matching the already-ordered rows", async () => {
    mocks.getKnockoutsTop.mockResolvedValue([
      statRow({ player_id: "p1", value: 30 }),
      statRow({ player_id: "p2", value: 20 }),
      statRow({ player_id: "p3", value: 10 }),
    ]);
    const result = await getClubStatisticTop(CLUB_STATISTIC_METRIC.KNOCKOUTS);
    expect(result.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(result.map((r) => r.playerId)).toEqual(["p1", "p2", "p3"]);
  });

  it("caps lifetime_rating to the top 10 even when getAllTimeLeaderboard returns more", async () => {
    mocks.getAllTimeLeaderboard.mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => ({
        player_id: `p${i}`,
        username: null,
        display_name: `Player ${i}`,
        telegram_avatar_url: null,
        custom_avatar_url: null,
        rating: 100 - i,
      }))
    );
    const result = await getClubStatisticTop(CLUB_STATISTIC_METRIC.LIFETIME_RATING);
    expect(result).toHaveLength(10);
    expect(result[9].rank).toBe(10);
  });
});

describe("getClubStatisticTop -- deterministic tie ordering", () => {
  it("lifetime_rating breaks equal-rating ties deterministically by player_id, without altering the rating values", async () => {
    mocks.getAllTimeLeaderboard.mockResolvedValue([
      { player_id: "zzz", username: null, display_name: "Z", telegram_avatar_url: null, custom_avatar_url: null, rating: 100 },
      { player_id: "aaa", username: null, display_name: "A", telegram_avatar_url: null, custom_avatar_url: null, rating: 100 },
    ]);
    const result = await getClubStatisticTop(CLUB_STATISTIC_METRIC.LIFETIME_RATING);
    // Deterministic secondary order (player_id ascending), same run every time.
    expect(result.map((r) => r.playerId)).toEqual(["aaa", "zzz"]);
    // Values themselves are untouched -- both still 100, not perturbed to break the tie.
    expect(result.map((r) => r.value)).toEqual([100, 100]);

    const again = await getClubStatisticTop(CLUB_STATISTIC_METRIC.LIFETIME_RATING);
    expect(again.map((r) => r.playerId)).toEqual(result.map((r) => r.playerId));
  });
});

describe("getClubStatisticTop -- no private fields in the normalized response", () => {
  it("only exposes public leaderboard-safe fields, same convention as the existing leaderboard", async () => {
    mocks.getKnockoutsTop.mockResolvedValue([statRow()]);
    const result = await getClubStatisticTop(CLUB_STATISTIC_METRIC.KNOCKOUTS);
    expect(Object.keys(result[0]).sort()).toEqual(
      ["customAvatarUrl", "displayName", "playerId", "rank", "telegramAvatarUrl", "username", "value"].sort()
    );
  });
});

describe("getAchievementHolders -- MANUAL/event achievement ownership list", () => {
  it("returns holders as-is, no ranking/value attached", async () => {
    mocks.getAchievementHolders.mockResolvedValue([
      { player_id: "p1", username: "a", display_name: "Alice", telegram_avatar_url: null, custom_avatar_url: null, completed_at: "2026-01-01T00:00:00.000Z" },
    ]);
    const result = await getAchievementHolders("royal_flush");
    expect(mocks.getAchievementHolders).toHaveBeenCalledWith("royal_flush", 50);
    expect(result[0]).toEqual({
      playerId: "p1",
      username: "a",
      displayName: "Alice",
      telegramAvatarUrl: null,
      customAvatarUrl: null,
      completedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result[0]).not.toHaveProperty("rank");
    expect(result[0]).not.toHaveProperty("value");
  });

  it("returns an empty list for an achievement with no holders yet", async () => {
    mocks.getAchievementHolders.mockResolvedValue([]);
    const result = await getAchievementHolders("number_one");
    expect(result).toEqual([]);
  });
});
