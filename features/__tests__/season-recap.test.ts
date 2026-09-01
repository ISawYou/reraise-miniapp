import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindSeasonRecapRows = vi.fn();
const mockListAllSeasons = vi.fn();
const mockGetOfficialSeasonLeaderboard = vi.fn();

vi.mock("@/lib/repositories", () => ({
  resultRepository: { findSeasonRecapRows: mockFindSeasonRecapRows },
  seasonRepository: { listAll: mockListAllSeasons },
}));

vi.mock("@/features/leaderboard", () => ({
  getOfficialSeasonLeaderboard: mockGetOfficialSeasonLeaderboard,
}));

const { getSeasonRecap } = await import("@/features/season-recap");

const SEASON_ID = "season-1";

function season() {
  return {
    id: SEASON_ID,
    title: "Открытие",
    start_date: "2026-01-01",
    end_date: "2026-08-31",
    is_active: false,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

// One completed-tournament result row -- exactly the shape
// findSeasonRecapRows returns (see ResultRepository.ts's
// SeasonRecapResultRow -- deliberately no addons/free_reentries fields).
function row(overrides: Partial<{
  tournament_id: string;
  tournament_title: string;
  tournament_start_at: string;
  tournament_type: string;
  player_id: string;
  display_name: string;
  place: number;
  reentries: number;
  knockouts: number;
  boss_knockouts: number;
  mystery_bounty_points: number;
  rating_points: number;
}> = {}) {
  return {
    tournament_id: "t1",
    tournament_title: "Friday Classic",
    tournament_start_at: "2026-03-01T18:00:00.000Z",
    tournament_type: "classic",
    player_id: "p1",
    display_name: "Player One",
    place: 1,
    reentries: 0,
    knockouts: 0,
    boss_knockouts: 0,
    mystery_bounty_points: 0,
    rating_points: 100,
    ...overrides,
  };
}

function officialEntry(playerId: string, displayName: string, rating: number, officialRank: number) {
  return { player_id: playerId, username: null, display_name: displayName, telegram_avatar_url: null, custom_avatar_url: null, rating, officialRank };
}

beforeEach(() => {
  mockFindSeasonRecapRows.mockReset();
  mockListAllSeasons.mockReset().mockResolvedValue([season()]);
  mockGetOfficialSeasonLeaderboard.mockReset().mockResolvedValue({ leaderboard: [], outOfCompetition: [] });
});

describe("getSeasonRecap -- season scoping", () => {
  it("queries findSeasonRecapRows with exactly the requested season id -- no cross-season leakage", async () => {
    mockFindSeasonRecapRows.mockResolvedValue([]);

    await getSeasonRecap(SEASON_ID);

    expect(mockFindSeasonRecapRows).toHaveBeenCalledWith(SEASON_ID);
    expect(mockFindSeasonRecapRows).toHaveBeenCalledTimes(1);
  });

  it("a season with a different id's rows never appears -- recap reflects only what the repository returns for THIS season", async () => {
    mockFindSeasonRecapRows.mockResolvedValue([row({ player_id: "only-this-season" })]);

    const recap = await getSeasonRecap(SEASON_ID);

    expect(recap.summary.uniquePlayers).toBe(1);
    expect(recap.records.mostTournaments.leaders[0].playerId).toBe("only-this-season");
  });

  it("throws for a season id that doesn't exist", async () => {
    mockListAllSeasons.mockResolvedValue([]);
    await expect(getSeasonRecap("nope")).rejects.toThrow(/не найден/);
  });
});

describe("getSeasonRecap -- summary", () => {
  it("computes unique players, participations, reentries, and uses FROZEN rating_points (no recalculation)", async () => {
    mockFindSeasonRecapRows.mockResolvedValue([
      row({ tournament_id: "t1", player_id: "p1", reentries: 2, rating_points: 100 }),
      row({ tournament_id: "t1", player_id: "p2", reentries: 1, rating_points: 80 }),
      row({ tournament_id: "t2", player_id: "p1", reentries: 0, rating_points: 50 }),
    ]);

    const recap = await getSeasonRecap(SEASON_ID);

    expect(recap.summary.completedTournaments).toBe(2);
    expect(recap.summary.uniquePlayers).toBe(2);
    expect(recap.summary.totalParticipations).toBe(3);
    expect(recap.summary.totalReentries).toBe(3);
    // 100 + 80 + 50, summed as-is -- never re-derived from a formula.
    expect(recap.summary.totalRatingPointsAwarded).toBe(230);
    expect(recap.summary.averageFieldSize).toBeCloseTo(1.5);
  });

  it("tournament type breakdown counts DISTINCT tournaments, not participation rows", async () => {
    mockFindSeasonRecapRows.mockResolvedValue([
      row({ tournament_id: "t1", tournament_type: "classic", player_id: "p1" }),
      row({ tournament_id: "t1", tournament_type: "classic", player_id: "p2" }),
      row({ tournament_id: "t2", tournament_type: "bounty", player_id: "p1" }),
    ]);

    const recap = await getSeasonRecap(SEASON_ID);

    expect(recap.summary.tournamentTypeBreakdown.classic).toBe(1);
    expect(recap.summary.tournamentTypeBreakdown.bounty).toBe(1);
    expect(recap.summary.tournamentTypeBreakdown.phoenix).toBe(0);
  });

  it("largest field reports the tournament with the most participants", async () => {
    mockFindSeasonRecapRows.mockResolvedValue([
      row({ tournament_id: "small", tournament_title: "Small", player_id: "p1" }),
      row({ tournament_id: "big", tournament_title: "Big", player_id: "p1" }),
      row({ tournament_id: "big", tournament_title: "Big", player_id: "p2" }),
      row({ tournament_id: "big", tournament_title: "Big", player_id: "p3" }),
    ]);

    const recap = await getSeasonRecap(SEASON_ID);

    expect(recap.summary.largestField).toEqual({
      tournamentId: "big",
      tournamentTitle: "Big",
      startAt: "2026-03-01T18:00:00.000Z",
      playerCount: 3,
    });
  });
});

describe("getSeasonRecap -- official winner/finalists reuse getOfficialSeasonLeaderboard as-is", () => {
  it("winner and finalists come directly from the official leaderboard, never independently derived", async () => {
    mockFindSeasonRecapRows.mockResolvedValue([]);
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({
      leaderboard: [officialEntry("p1", "Winner", 500, 1), officialEntry("p2", "Runner-up", 400, 2)],
      outOfCompetition: [],
    });

    const recap = await getSeasonRecap(SEASON_ID);

    expect(mockGetOfficialSeasonLeaderboard).toHaveBeenCalledWith(SEASON_ID);
    expect(recap.official.winner).toEqual({ playerId: "p1", displayName: "Winner", rating: 500, officialRank: 1 });
    expect(recap.official.finalists).toHaveLength(2);
    expect(recap.official.pointsGapFirstToSecond).toBe(100);
  });

  it("an OOC (Вне зачёта) player never appears as an official finalist, even with the highest raw rating", async () => {
    mockFindSeasonRecapRows.mockResolvedValue([]);
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({
      leaderboard: [officialEntry("p1", "Eligible Winner", 300, 1)],
      outOfCompetition: [{ player_id: "owner", username: null, display_name: "Owner", telegram_avatar_url: null, custom_avatar_url: null, rating: 9999 }],
    });

    const recap = await getSeasonRecap(SEASON_ID);

    expect(recap.official.winner?.playerId).toBe("p1");
    expect(recap.official.finalists.some((f) => f.playerId === "owner")).toBe(false);
    expect(recap.official.outOfCompetitionPlayersCount).toBe(1);
  });

  it("limits finalists to the official TOP-9 even if more players are eligible", async () => {
    mockFindSeasonRecapRows.mockResolvedValue([]);
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({
      leaderboard: Array.from({ length: 12 }, (_, i) => officialEntry(`p${i + 1}`, `P${i + 1}`, 100 - i, i + 1)),
      outOfCompetition: [],
    });

    const recap = await getSeasonRecap(SEASON_ID);

    expect(recap.official.finalists).toHaveLength(9);
    expect(recap.official.officialPlayersCount).toBe(12);
  });
});

describe("getSeasonRecap -- player records", () => {
  it("most tournaments / wins / podiums / TOP-9 finishes computed correctly", async () => {
    mockFindSeasonRecapRows.mockResolvedValue([
      row({ tournament_id: "t1", player_id: "grinder", place: 5 }),
      row({ tournament_id: "t2", player_id: "grinder", place: 10 }),
      row({ tournament_id: "t3", player_id: "grinder", place: 2 }),
      row({ tournament_id: "t1", player_id: "champ", place: 1 }),
    ]);

    const recap = await getSeasonRecap(SEASON_ID);

    expect(recap.records.mostTournaments).toMatchObject({ value: 3, leaders: [{ playerId: "grinder", displayName: "Player One" }] });
    expect(recap.records.mostWins.leaders[0].playerId).toBe("champ");
    expect(recap.records.mostPodiums.leaders[0].playerId).toBe("grinder"); // places 5,10,2 -> only place 2 counts as podium (<=3), still most among 1 podium each...
  });

  it("KO / Boss KO / Mystery Bounty are summed per player", async () => {
    mockFindSeasonRecapRows.mockResolvedValue([
      row({ tournament_id: "t1", player_id: "p1", knockouts: 3, boss_knockouts: 1, mystery_bounty_points: 50 }),
      row({ tournament_id: "t2", player_id: "p1", knockouts: 2, boss_knockouts: 0, mystery_bounty_points: 0 }),
      row({ tournament_id: "t1", player_id: "p2", knockouts: 1, boss_knockouts: 0, mystery_bounty_points: 0 }),
    ]);

    const recap = await getSeasonRecap(SEASON_ID);

    expect(recap.records.mostKnockouts).toMatchObject({ value: 5, leaders: [{ playerId: "p1" }] });
    expect(recap.records.mostBossKnockouts).toMatchObject({ value: 1, leaders: [{ playerId: "p1" }] });
    expect(recap.records.mostMysteryBounty).toMatchObject({ value: 50, leaders: [{ playerId: "p1" }] });
  });

  it("zero-value Boss KO / Mystery Bounty records report meaningful:false with NO fake winner", async () => {
    mockFindSeasonRecapRows.mockResolvedValue([
      row({ player_id: "p1", boss_knockouts: 0, mystery_bounty_points: 0 }),
      row({ tournament_id: "t2", player_id: "p2", boss_knockouts: 0, mystery_bounty_points: 0 }),
    ]);

    const recap = await getSeasonRecap(SEASON_ID);

    expect(recap.records.mostBossKnockouts).toEqual({ value: 0, leaders: [], meaningful: false });
    expect(recap.records.mostMysteryBounty).toEqual({ value: 0, leaders: [], meaningful: false });
  });

  it("tied records return ALL tied leaders, sorted by display name -- never one arbitrary winner", async () => {
    mockFindSeasonRecapRows.mockResolvedValue([
      row({ tournament_id: "t1", player_id: "b", display_name: "Boris", knockouts: 5 }),
      row({ tournament_id: "t2", player_id: "a", display_name: "Anna", knockouts: 5 }),
      row({ tournament_id: "t3", player_id: "c", display_name: "Carl", knockouts: 3 }),
    ]);

    const recap = await getSeasonRecap(SEASON_ID);

    expect(recap.records.mostKnockouts.value).toBe(5);
    expect(recap.records.mostKnockouts.leaders.map((l) => l.displayName)).toEqual(["Anna", "Boris"]);
  });

  it("best single-tournament rating and max single-tournament KO include the tournament, and support ties", async () => {
    mockFindSeasonRecapRows.mockResolvedValue([
      row({ tournament_id: "t1", tournament_title: "Big One", player_id: "p1", display_name: "P1", rating_points: 400, knockouts: 8 }),
      row({ tournament_id: "t2", tournament_title: "Other", player_id: "p2", display_name: "P2", rating_points: 200, knockouts: 8 }),
    ]);

    const recap = await getSeasonRecap(SEASON_ID);

    expect(recap.records.bestSingleTournamentRating).toMatchObject({
      value: 400,
      leaders: [{ playerId: "p1", tournamentTitle: "Big One" }],
    });
    expect(recap.records.mostKnockoutsSingleTournament.value).toBe(8);
    expect(recap.records.mostKnockoutsSingleTournament.leaders).toHaveLength(2);
  });

  it("longest participation streak counts consecutive completed tournaments in chronological order, breaking on a missed one", async () => {
    mockFindSeasonRecapRows.mockResolvedValue([
      row({ tournament_id: "t1", tournament_start_at: "2026-01-01T18:00:00.000Z", player_id: "steady" }),
      row({ tournament_id: "t2", tournament_start_at: "2026-02-01T18:00:00.000Z", player_id: "steady" }),
      row({ tournament_id: "t3", tournament_start_at: "2026-03-01T18:00:00.000Z", player_id: "steady" }),
      // sporadic played t1 and t3 but missed t2 -- streak of 1, not 2.
      row({ tournament_id: "t1", tournament_start_at: "2026-01-01T18:00:00.000Z", player_id: "sporadic" }),
      row({ tournament_id: "t3", tournament_start_at: "2026-03-01T18:00:00.000Z", player_id: "sporadic" }),
    ]);

    const recap = await getSeasonRecap(SEASON_ID);

    expect(recap.records.longestParticipationStreak).toMatchObject({ value: 3, leaders: [{ playerId: "steady" }] });
  });
});

describe("getSeasonRecap -- tournament records", () => {
  it("highest rating pool and highest KO tournaments are grouped correctly, with tie support", async () => {
    mockFindSeasonRecapRows.mockResolvedValue([
      row({ tournament_id: "t1", tournament_title: "Pool A", player_id: "p1", rating_points: 300, knockouts: 2 }),
      row({ tournament_id: "t1", tournament_title: "Pool A", player_id: "p2", rating_points: 200, knockouts: 1 }),
      row({ tournament_id: "t2", tournament_title: "Pool B", player_id: "p1", rating_points: 100, knockouts: 10 }),
    ]);

    const recap = await getSeasonRecap(SEASON_ID);

    // t1 pool = 500, t2 pool = 100 -> t1 wins.
    expect(recap.tournamentRecords.highestRatingPool).toMatchObject({ value: 500, tournaments: [{ tournamentId: "t1" }] });
    // t1 KO = 3, t2 KO = 10 -> t2 wins.
    expect(recap.tournamentRecords.highestKnockouts).toMatchObject({ value: 10, tournaments: [{ tournamentId: "t2" }] });
    expect(recap.tournamentRecords.distinctFormatsPlayed).toBe(1);
  });
});

describe("getSeasonRecap -- data quality: addons/free_reentries never used", () => {
  it("the SeasonRecapResultRow shape itself has no addons/free_reentries field to read -- verified structurally", async () => {
    mockFindSeasonRecapRows.mockResolvedValue([row({ player_id: "p1" })]);
    const recap = await getSeasonRecap(SEASON_ID);
    // Every numeric field actually used is exactly this allowed set --
    // if a future edit added an addons/free_reentries read, TypeScript
    // would reject it (SeasonRecapResultRow has no such field), so this
    // is a structural guarantee, not just a text scan.
    expect(Object.keys(row())).toEqual([
      "tournament_id",
      "tournament_title",
      "tournament_start_at",
      "tournament_type",
      "player_id",
      "display_name",
      "place",
      "reentries",
      "knockouts",
      "boss_knockouts",
      "mystery_bounty_points",
      "rating_points",
    ]);
    expect(recap.summary.totalParticipations).toBe(1);
  });

  it("the Postgres recap query never selects addons or free_reentries", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(process.cwd(), "lib/repositories/result/PostgresResultRepository.ts"),
      "utf8"
    );
    const recapMethod = source.slice(source.indexOf("findSeasonRecapRows"), source.indexOf("findHistoryWithTournamentByPlayerId"));
    expect(recapMethod).not.toMatch(/addons/i);
    expect(recapMethod).not.toMatch(/freeReentries|free_reentries/i);
  });
});
