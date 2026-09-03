import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindWithPlayerBySeasonId = vi.fn();
const mockFindAllTimeWithPlayer = vi.fn();
const mockListBySeasonId = vi.fn();
const mockFindActiveSeason = vi.fn();
const mockListCompleted = vi.fn();

vi.mock("@/lib/repositories", () => ({
  resultRepository: {
    findWithPlayerBySeasonId: mockFindWithPlayerBySeasonId,
    findAllTimeWithPlayer: mockFindAllTimeWithPlayer,
  },
  seasonRatingExclusionRepository: { listBySeasonId: mockListBySeasonId },
  seasonRepository: { findActive: mockFindActiveSeason },
  tournamentRepository: { listCompleted: mockListCompleted },
}));

const {
  getSeasonLeaderboard,
  getOfficialSeasonLeaderboard,
  getOfficialSeasonLeaderboardWithMovement,
  getAllTimeLeaderboard,
  getPlayerRatingSummary,
} = await import("@/features/leaderboard");

function resultRow(playerId: string, ratingPoints: number, tournamentId = "t-default") {
  return {
    player_id: playerId,
    tournament_id: tournamentId,
    rating_points: ratingPoints,
    username: playerId,
    display_name: playerId,
    telegram_avatar_url: null,
    custom_avatar_url: null,
  };
}

function tournament(
  overrides: Partial<{
    id: string;
    season_id: string | null;
    start_at: string;
    status: string;
    is_final: boolean;
  }> = {}
) {
  return {
    id: "t-default",
    season_id: "s1",
    status: "completed",
    start_at: "2026-06-01T18:00:00.000Z",
    is_final: false,
    ...overrides,
  };
}

function exclusion(playerId: string, seasonId = "s1") {
  return {
    id: `excl-${playerId}`,
    season_id: seasonId,
    player_id: playerId,
    created_by_player_id: "admin-1",
    reason: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  mockFindWithPlayerBySeasonId.mockReset();
  mockFindAllTimeWithPlayer.mockReset();
  mockListBySeasonId.mockReset();
  mockFindActiveSeason.mockReset();
  mockListCompleted.mockReset().mockResolvedValue([]);
});

describe("getSeasonLeaderboard (raw)", () => {
  it("accumulates rating_points per player across multiple result rows", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("p1", 100),
      resultRow("p1", 50),
      resultRow("p2", 80),
    ]);

    const raw = await getSeasonLeaderboard("s1");

    expect(raw).toEqual([
      expect.objectContaining({ player_id: "p1", rating: 150 }),
      expect.objectContaining({ player_id: "p2", rating: 80 }),
    ]);
  });

  it("a Final Month result row (rating_points=0) does not change a player's season total -- it's a plain sum, 0 contributes nothing", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("p1", 150, "t-normal"),
      resultRow("p1", 0, "t-final"),
    ]);

    const raw = await getSeasonLeaderboard("s1");

    expect(raw).toEqual([expect.objectContaining({ player_id: "p1", rating: 150 })]);
  });
});

describe("getOfficialSeasonLeaderboard", () => {
  it("an excluded player keeps their exact raw accumulated rating in outOfCompetition (rating math untouched)", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([resultRow("owner", 600), resultRow("owner", 400)]);
    mockListBySeasonId.mockResolvedValue([exclusion("owner")]);

    const { outOfCompetition } = await getOfficialSeasonLeaderboard("s1");

    expect(outOfCompetition).toEqual([expect.objectContaining({ player_id: "owner", rating: 1000 })]);
  });

  it("removing the exclusion restores the same official score immediately (no recalculation, same underlying rating)", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([resultRow("p1", 900)]);

    mockListBySeasonId.mockResolvedValue([exclusion("p1")]);
    const excluded = await getOfficialSeasonLeaderboard("s1");
    expect(excluded.leaderboard).toEqual([]);
    expect(excluded.outOfCompetition[0].rating).toBe(900);

    mockListBySeasonId.mockResolvedValue([]);
    const restored = await getOfficialSeasonLeaderboard("s1");
    expect(restored.leaderboard).toEqual([expect.objectContaining({ player_id: "p1", rating: 900, officialRank: 1 })]);
  });

  it("an excluded raw #1 does not occupy official rank #1 -- the next eligible player becomes #1", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("owner", 1000),
      resultRow("player-a", 900),
      resultRow("player-b", 850),
    ]);
    mockListBySeasonId.mockResolvedValue([exclusion("owner")]);

    const { leaderboard } = await getOfficialSeasonLeaderboard("s1");

    expect(leaderboard[0]).toEqual(expect.objectContaining({ player_id: "player-a", officialRank: 1 }));
    expect(leaderboard.some((row) => row.player_id === "owner")).toBe(false);
  });

  it("an excluded raw #6 does not occupy a TOP-9 slot -- it never appears in the official leaderboard at all", async () => {
    const raw = Array.from({ length: 10 }, (_, i) => resultRow(`p${i + 1}`, 1000 - i * 10));
    mockFindWithPlayerBySeasonId.mockResolvedValue(raw);
    mockListBySeasonId.mockResolvedValue([exclusion("p6")]); // raw #6 excluded

    const { leaderboard, outOfCompetition } = await getOfficialSeasonLeaderboard("s1");

    expect(leaderboard.some((row) => row.player_id === "p6")).toBe(false);
    expect(outOfCompetition.some((row) => row.player_id === "p6")).toBe(true);
    // p7..p10 each move up one official rank; the 9-slot TOP-9 now reaches
    // p10 (formerly raw #10) instead of stopping at p9.
    expect(leaderboard).toHaveLength(9);
    expect(leaderboard.find((row) => row.player_id === "p10")?.officialRank).toBe(9);
  });

  it("raw #10 becomes official #9 when raw #1..#N includes exactly one exclusion above it", async () => {
    const raw = Array.from({ length: 10 }, (_, i) => resultRow(`p${i + 1}`, 1000 - i * 10));
    mockFindWithPlayerBySeasonId.mockResolvedValue(raw);
    mockListBySeasonId.mockResolvedValue([exclusion("p1")]); // raw #1 excluded

    const { leaderboard } = await getOfficialSeasonLeaderboard("s1");

    // p1 excluded -> p2..p10 shift up one official rank each; the raw #10
    // (p10) becomes official rank 9.
    expect(leaderboard).toHaveLength(9);
    const p10 = leaderboard.find((row) => row.player_id === "p10");
    expect(p10?.officialRank).toBe(9);
  });

  it("excluded rows carry no officialRank field at all", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([resultRow("owner", 1000)]);
    mockListBySeasonId.mockResolvedValue([exclusion("owner")]);

    const { outOfCompetition } = await getOfficialSeasonLeaderboard("s1");

    expect(outOfCompetition[0]).not.toHaveProperty("officialRank");
  });

  it("season scope: excluded in season A but eligible in season B (independent exclusion sets)", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([resultRow("p1", 500)]);

    mockListBySeasonId.mockImplementation(async (seasonId: string) =>
      seasonId === "season-a" ? [exclusion("p1", "season-a")] : []
    );

    const seasonA = await getOfficialSeasonLeaderboard("season-a");
    const seasonB = await getOfficialSeasonLeaderboard("season-b");

    expect(seasonA.leaderboard.some((row) => row.player_id === "p1")).toBe(false);
    expect(seasonB.leaderboard.some((row) => row.player_id === "p1")).toBe(true);
  });
});

describe("getAllTimeLeaderboard", () => {
  it("sums frozen raw rating_points across every result regardless of season", async () => {
    mockFindAllTimeWithPlayer.mockResolvedValue([
      resultRow("p1", 100), // season A
      resultRow("p1", 50), // season B
      resultRow("p2", 80),
    ]);

    const all = await getAllTimeLeaderboard();

    expect(all).toEqual([
      expect.objectContaining({ player_id: "p1", rating: 150 }),
      expect.objectContaining({ player_id: "p2", rating: 80 }),
    ]);
    // No season_id argument -- the repository call itself is season-agnostic.
    expect(mockFindAllTimeWithPlayer).toHaveBeenCalledWith();
  });

  it("a Final Month result row (rating_points=0) does not change a player's all-time total", async () => {
    mockFindAllTimeWithPlayer.mockResolvedValue([
      resultRow("p1", 150, "t-normal"),
      resultRow("p1", 0, "t-final"),
    ]);

    const all = await getAllTimeLeaderboard();

    expect(all).toEqual([expect.objectContaining({ player_id: "p1", rating: 150 })]);
  });

  it("does NOT remove points earned while the player was 'Вне зачёта' in some season -- exclusions are never consulted", async () => {
    mockFindAllTimeWithPlayer.mockResolvedValue([resultRow("owner", 1000)]);

    const all = await getAllTimeLeaderboard();

    expect(all).toEqual([expect.objectContaining({ player_id: "owner", rating: 1000 })]);
    expect(mockListBySeasonId).not.toHaveBeenCalled();
  });

  it("sorts descending by total rating", async () => {
    mockFindAllTimeWithPlayer.mockResolvedValue([
      resultRow("low", 10),
      resultRow("high", 900),
      resultRow("mid", 300),
    ]);

    const all = await getAllTimeLeaderboard();

    expect(all.map((row) => row.player_id)).toEqual(["high", "mid", "low"]);
  });
});

describe("getPlayerRatingSummary -- profile data contract", () => {
  it("returns current-season rank/points and distinct all-time points for an officially ranked player", async () => {
    mockFindActiveSeason.mockResolvedValue({ id: "s1", title: "Осень 2026", is_active: true });
    mockFindWithPlayerBySeasonId.mockResolvedValue([resultRow("p1", 150)]);
    mockListBySeasonId.mockResolvedValue([]);
    mockFindAllTimeWithPlayer.mockResolvedValue([resultRow("p1", 150), resultRow("p1", 400)]);

    const summary = await getPlayerRatingSummary("p1");

    expect(summary.currentSeason).toEqual({
      id: "s1",
      title: "Осень 2026",
      points: 150,
      rank: 1,
      isOutOfCompetition: false,
    });
    // Current-season points (150) and all-time points (550) are genuinely
    // distinct numbers, not the same value duplicated.
    expect(summary.allTime.points).toBe(550);
    expect(summary.allTime.points).not.toBe(summary.currentSeason?.points);
  });

  it("an OOC player in the current season gets their points but no fake rank, while all-time is unaffected by the exclusion", async () => {
    mockFindActiveSeason.mockResolvedValue({ id: "s1", title: "Осень 2026", is_active: true });
    mockFindWithPlayerBySeasonId.mockResolvedValue([resultRow("owner", 1000)]);
    mockListBySeasonId.mockResolvedValue([exclusion("owner")]);
    mockFindAllTimeWithPlayer.mockResolvedValue([resultRow("owner", 1000)]);

    const summary = await getPlayerRatingSummary("owner");

    expect(summary.currentSeason).toMatchObject({ rank: null, points: 1000, isOutOfCompetition: true });
    // All-time never consults season_rating_exclusions -- OOC in-season
    // does not erase the points from the all-time total or rank.
    expect(summary.allTime).toEqual({ rank: 1, points: 1000 });
  });

  it("a player with no results at all -> 0 points, null rank, in both current and all-time", async () => {
    mockFindActiveSeason.mockResolvedValue({ id: "s1", title: "Осень 2026", is_active: true });
    mockFindWithPlayerBySeasonId.mockResolvedValue([]);
    mockListBySeasonId.mockResolvedValue([]);
    mockFindAllTimeWithPlayer.mockResolvedValue([]);

    const summary = await getPlayerRatingSummary("nobody");

    expect(summary.currentSeason).toMatchObject({ points: 0, rank: null, isOutOfCompetition: false });
    expect(summary.allTime).toEqual({ points: 0, rank: null });
  });

  it("no active season at all -> currentSeason is null, allTime still resolves", async () => {
    mockFindActiveSeason.mockResolvedValue(null);
    mockFindAllTimeWithPlayer.mockResolvedValue([resultRow("p1", 200)]);

    const summary = await getPlayerRatingSummary("p1");

    expect(summary.currentSeason).toBeNull();
    expect(summary.allTime).toEqual({ points: 200, rank: 1 });
  });

  it("public payload never contains season start_date/end_date", async () => {
    mockFindActiveSeason.mockResolvedValue({ id: "s1", title: "Осень 2026", is_active: true });
    mockFindWithPlayerBySeasonId.mockResolvedValue([resultRow("p1", 100)]);
    mockListBySeasonId.mockResolvedValue([]);
    mockFindAllTimeWithPlayer.mockResolvedValue([resultRow("p1", 100)]);

    const summary = await getPlayerRatingSummary("p1");

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("start_date");
    expect(serialized).not.toContain("end_date");
    expect(summary.currentSeason).not.toHaveProperty("start_date");
    expect(summary.currentSeason).not.toHaveProperty("end_date");
  });
});

describe("getOfficialSeasonLeaderboardWithMovement", () => {
  it("1. the season's first completed tournament -> every ranked player is NEW", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("p1", 100, "t1"),
      resultRow("p2", 80, "t1"),
    ]);
    mockListBySeasonId.mockResolvedValue([]);
    mockListCompleted.mockResolvedValue([tournament({ id: "t1", start_at: "2026-06-01T18:00:00.000Z" })]);

    const { leaderboard } = await getOfficialSeasonLeaderboardWithMovement("s1");

    expect(leaderboard.map((e) => e.rankMovement)).toEqual([{ type: "new" }, { type: "new" }]);
  });

  it("2. a player absent before the latest tournament (first tournament of the season for them) -> NEW, even when other players already have an established previous rank", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("p1", 100, "t-old"),
      resultRow("p2", 90, "t-old"),
      resultRow("p3", 50, "t-new"),
    ]);
    mockListBySeasonId.mockResolvedValue([]);
    mockListCompleted.mockResolvedValue([
      tournament({ id: "t-old", start_at: "2026-05-01T18:00:00.000Z" }),
      tournament({ id: "t-new", start_at: "2026-06-01T18:00:00.000Z" }),
    ]);

    const { leaderboard } = await getOfficialSeasonLeaderboardWithMovement("s1");

    expect(leaderboard.find((e) => e.player_id === "p3")?.rankMovement).toEqual({ type: "new" });
  });

  it("3. #8 -> #5 => up 3", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("p1", 800, "t-old"),
      resultRow("p2", 700, "t-old"),
      resultRow("p3", 600, "t-old"),
      resultRow("p4", 500, "t-old"),
      resultRow("p5", 400, "t-old"),
      resultRow("p6", 300, "t-old"),
      resultRow("p7", 200, "t-old"),
      resultRow("p8", 100, "t-old"),
      resultRow("p8", 350, "t-new"),
    ]);
    mockListBySeasonId.mockResolvedValue([]);
    mockListCompleted.mockResolvedValue([
      tournament({ id: "t-old", start_at: "2026-05-01T18:00:00.000Z" }),
      tournament({ id: "t-new", start_at: "2026-06-01T18:00:00.000Z" }),
    ]);

    const { leaderboard } = await getOfficialSeasonLeaderboardWithMovement("s1");
    const p8 = leaderboard.find((e) => e.player_id === "p8")!;

    expect(p8.officialRank).toBe(5);
    expect(p8.rankMovement).toEqual({ type: "up", places: 3 });
  });

  it("Final Month (is_final=true) is never picked as the 'latest' tournament for movement, even when it's chronologically the most recent completed one -- its zero-point results must not flatten every player's movement to 'same'", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      // t-oldest: establishes p1=#1(500), p2=#2(400), p3=#3(300).
      resultRow("p1", 500, "t-oldest"),
      resultRow("p2", 400, "t-oldest"),
      resultRow("p3", 300, "t-oldest"),
      // t-middle (rating-eligible, most recent RATING tournament): p3
      // earns enough to overtake everyone -> new order p3(#1) p1(#2) p2(#3).
      resultRow("p3", 300, "t-middle"),
      // t-final: is_final=true, chronologically THE most recent completed
      // tournament of the three, but contributes 0 to every player -- if it
      // were (incorrectly) picked as "latest", excluding only its rows
      // would leave "previous" identical to "current" (0 changes nothing),
      // and every player would show rankMovement "same" instead of the
      // real shift t-middle caused.
      resultRow("p1", 0, "t-final"),
      resultRow("p2", 0, "t-final"),
      resultRow("p3", 0, "t-final"),
    ]);
    mockListBySeasonId.mockResolvedValue([]);
    mockListCompleted.mockResolvedValue([
      tournament({ id: "t-oldest", start_at: "2026-04-01T18:00:00.000Z" }),
      tournament({ id: "t-middle", start_at: "2026-05-01T18:00:00.000Z" }),
      tournament({ id: "t-final", start_at: "2026-06-01T18:00:00.000Z", is_final: true }),
    ]);

    const { leaderboard } = await getOfficialSeasonLeaderboardWithMovement("s1");
    const byPlayer = new Map(leaderboard.map((e) => [e.player_id, e]));

    expect(byPlayer.get("p3")).toMatchObject({ officialRank: 1, rankMovement: { type: "up", places: 2 } });
    expect(byPlayer.get("p1")).toMatchObject({ officialRank: 2, rankMovement: { type: "down", places: 1 } });
    expect(byPlayer.get("p2")).toMatchObject({ officialRank: 3, rankMovement: { type: "down", places: 1 } });
  });

  it("a completed Final Month with no other completed tournament in the season -> no rating-eligible 'latest' tournament exists, every ranked player is NEW (same defensive fallback as an empty season)", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("p1", 0, "t-final"),
      resultRow("p2", 0, "t-final"),
    ]);
    mockListBySeasonId.mockResolvedValue([]);
    mockListCompleted.mockResolvedValue([
      tournament({ id: "t-final", start_at: "2026-06-01T18:00:00.000Z", is_final: true }),
    ]);

    const { leaderboard } = await getOfficialSeasonLeaderboardWithMovement("s1");

    expect(leaderboard.every((e) => e.rankMovement.type === "new")).toBe(true);
  });

  it("4. #3 -> #5 => down 2", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("p1", 1000, "t-old"),
      resultRow("p2", 900, "t-old"),
      resultRow("p3", 800, "t-old"),
      resultRow("p4", 700, "t-old"),
      resultRow("p5", 600, "t-old"),
      resultRow("p6", 500, "t-old"),
      resultRow("p4", 250, "t-new"),
      resultRow("p5", 250, "t-new"),
    ]);
    mockListBySeasonId.mockResolvedValue([]);
    mockListCompleted.mockResolvedValue([
      tournament({ id: "t-old", start_at: "2026-05-01T18:00:00.000Z" }),
      tournament({ id: "t-new", start_at: "2026-06-01T18:00:00.000Z" }),
    ]);

    const { leaderboard } = await getOfficialSeasonLeaderboardWithMovement("s1");
    const p3 = leaderboard.find((e) => e.player_id === "p3")!;

    expect(p3.officialRank).toBe(5);
    expect(p3.rankMovement).toEqual({ type: "down", places: 2 });
  });

  it("5. unchanged official rank => same", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("p1", 500, "t-old"),
      resultRow("p2", 300, "t-old"),
      resultRow("p1", 50, "t-new"),
    ]);
    mockListBySeasonId.mockResolvedValue([]);
    mockListCompleted.mockResolvedValue([
      tournament({ id: "t-old", start_at: "2026-05-01T18:00:00.000Z" }),
      tournament({ id: "t-new", start_at: "2026-06-01T18:00:00.000Z" }),
    ]);

    const { leaderboard } = await getOfficialSeasonLeaderboardWithMovement("s1");

    expect(leaderboard.find((e) => e.player_id === "p1")?.rankMovement).toEqual({ type: "same" });
    expect(leaderboard.find((e) => e.player_id === "p2")?.rankMovement).toEqual({ type: "same" });
  });

  it("6. the latest tournament's own rows are excluded from the previous snapshot (not double counted)", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("p1", 100, "t-old"),
      resultRow("p1", 900, "t-new"), // huge boost, ONLY from the latest tournament
      resultRow("p2", 200, "t-old"),
    ]);
    mockListBySeasonId.mockResolvedValue([]);
    mockListCompleted.mockResolvedValue([
      tournament({ id: "t-old", start_at: "2026-05-01T18:00:00.000Z" }),
      tournament({ id: "t-new", start_at: "2026-06-01T18:00:00.000Z" }),
    ]);

    const { leaderboard } = await getOfficialSeasonLeaderboardWithMovement("s1");
    const p1 = leaderboard.find((e) => e.player_id === "p1")!;

    // If the latest tournament's 900 were wrongly included in "previous"
    // too, p1's previous total would also be 1000 (rank 1, same as
    // current) -- this would show "same", not "up". Correctly excluding it
    // leaves p1's previous total at 100 (rank 2, behind p2's 200).
    expect(p1.officialRank).toBe(1);
    expect(p1.rankMovement).toEqual({ type: "up", places: 1 });
  });

  it("7. older (non-latest) tournaments remain fully included and SUMMED in the previous snapshot", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("p1", 100, "t-old-1"),
      resultRow("p1", 100, "t-old-2"),
      resultRow("p2", 150, "t-old-1"),
    ]);
    mockListBySeasonId.mockResolvedValue([]);
    mockListCompleted.mockResolvedValue([
      tournament({ id: "t-old-1", start_at: "2026-04-01T18:00:00.000Z" }),
      tournament({ id: "t-old-2", start_at: "2026-05-01T18:00:00.000Z" }),
      // Latest tournament contributes nothing new for either player --
      // movement should reflect BOTH older tournaments summed for
      // "previous", not just the most recent of the two older ones.
      tournament({ id: "t-new", start_at: "2026-06-01T18:00:00.000Z" }),
    ]);

    const { leaderboard } = await getOfficialSeasonLeaderboardWithMovement("s1");

    // p1's previous total is 100+100=200 (rank 1, ahead of p2's 150) --
    // same as current (no latest-tournament rows exist at all for either
    // player) -- so both stay "same". If t-old-1 were wrongly dropped, p1's
    // previous total would be only 100 (rank 2, behind p2), making this
    // incorrectly report "up" instead of "same".
    expect(leaderboard.find((e) => e.player_id === "p1")?.rankMovement).toEqual({ type: "same" });
    expect(leaderboard.find((e) => e.player_id === "p2")?.rankMovement).toEqual({ type: "same" });
  });

  it("8. movement is derived from the persisted rating_points values exactly as given, never re-derived", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("p1", 123, "t-old"),
      resultRow("p2", 45, "t-old"),
      resultRow("p1", 7, "t-new"),
    ]);
    mockListBySeasonId.mockResolvedValue([]);
    mockListCompleted.mockResolvedValue([
      tournament({ id: "t-old", start_at: "2026-05-01T18:00:00.000Z" }),
      tournament({ id: "t-new", start_at: "2026-06-01T18:00:00.000Z" }),
    ]);

    const { leaderboard } = await getOfficialSeasonLeaderboardWithMovement("s1");

    expect(leaderboard.find((e) => e.player_id === "p1")?.rating).toBe(130);
  });

  it("9. no rating engine / place / KO / entries input is ever read -- only the persisted rating_points field the mocked rows carry", async () => {
    // These rows deliberately carry NO place/knockouts/entries/addons
    // fields at all -- if the implementation tried to read any of them for
    // a recalculation it would silently get `undefined`, not a thrown
    // error, so this test's real assertion is that the OUTPUT still
    // matches a hand-computed rating_points-only sum.
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("p1", 42, "t-old"),
      resultRow("p2", 17, "t-old"),
    ]);
    mockListBySeasonId.mockResolvedValue([]);
    mockListCompleted.mockResolvedValue([tournament({ id: "t-old" })]);

    const { leaderboard } = await getOfficialSeasonLeaderboardWithMovement("s1");

    expect(leaderboard.map((e) => e.rating)).toEqual([42, 17]);
  });

  it("10. the latest tournament is chosen by canonical chronology (start_at desc), never by array/insertion order", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("p1", 300, "t-early"),
      resultRow("p1", 100, "t-late"),
      resultRow("p2", 100, "t-early"),
    ]);
    mockListBySeasonId.mockResolvedValue([]);
    // Deliberately fed in ASCENDING order (earliest first) -- the opposite
    // of what listCompleted() normally returns -- to prove the function
    // sorts by start_at itself rather than trusting array index 0.
    mockListCompleted.mockResolvedValue([
      tournament({ id: "t-early", start_at: "2026-01-01T00:00:00.000Z" }),
      tournament({ id: "t-late", start_at: "2026-06-01T00:00:00.000Z" }),
    ]);

    const { leaderboard } = await getOfficialSeasonLeaderboardWithMovement("s1");

    // p2 has no row in t-late at all. If t-early were wrongly treated as
    // "latest" (array index 0), t-early's rows would be excluded from
    // "previous", leaving p2 with NO previous row -> NEW. Correctly
    // treating t-late as latest keeps t-early (p2's only tournament) in
    // "previous", so p2's rank is unchanged -> same.
    expect(leaderboard.find((e) => e.player_id === "p2")?.rankMovement).toEqual({ type: "same" });
  });

  it("11. a non-completed tournament (draft/open/closed) can never become the comparison tournament, even with a later start_at", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("p1", 100, "t-old"),
      resultRow("p2", 150, "t-old"),
      resultRow("p1", 200, "t-real-latest"), // p1 pulls ahead: 100 -> 300
    ]);
    mockListBySeasonId.mockResolvedValue([]);
    // A non-completed tournament with a LATER start_at than the real
    // latest completed one, and (realistically) no result rows of its own
    // -- listCompleted() itself would never actually return a non-
    // completed row, but this proves the function's own defense-in-depth
    // status check, not just reliance on that upstream contract.
    mockListCompleted.mockResolvedValue([
      tournament({ id: "t-old", start_at: "2026-04-01T00:00:00.000Z", status: "completed" }),
      tournament({ id: "t-real-latest", start_at: "2026-05-01T00:00:00.000Z", status: "completed" }),
      tournament({ id: "t-open", start_at: "2026-06-01T00:00:00.000Z", status: "open" }),
    ]);

    const { leaderboard } = await getOfficialSeasonLeaderboardWithMovement("s1");

    // Correct: "t-real-latest" is excluded from "previous" -> previous
    // p1=100 (rank 2), p2=150 (rank 1); current p1=300 (rank 1), p2=150
    // (rank 2) -> p1 up 1, p2 down 1. If "t-open" (no rows of its own,
    // later date) were wrongly picked instead, excluding it would be a
    // no-op -- previous would equal current exactly and BOTH would
    // incorrectly show "same".
    expect(leaderboard.find((e) => e.player_id === "p1")?.rankMovement).toEqual({ type: "up", places: 1 });
    expect(leaderboard.find((e) => e.player_id === "p2")?.rankMovement).toEqual({ type: "down", places: 1 });
  });

  it("12. a completed tournament from a DIFFERENT season is never chosen, even with a later start_at", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("p1", 300, "t-s1-old"),
      resultRow("p2", 100, "t-s1-old"),
    ]);
    mockListBySeasonId.mockResolvedValue([]);
    mockListCompleted.mockResolvedValue([
      tournament({ id: "t-s1-old", season_id: "s1", start_at: "2026-05-01T00:00:00.000Z" }),
      // A later-dated completed tournament, but a DIFFERENT season --
      // findWithPlayerBySeasonId("s1") would never return rows tagged with
      // this id anyway, but this proves the tournament-selection step
      // itself also ignores it.
      tournament({ id: "t-s2-new", season_id: "s2", start_at: "2026-07-01T00:00:00.000Z" }),
    ]);

    const { leaderboard } = await getOfficialSeasonLeaderboardWithMovement("s1");

    // t-s1-old is season s1's only tournament -> first tournament of the
    // season for both players -> NEW, not "same" (which would happen if
    // t-s2-new were wrongly treated as "the latest" and t-s1-old were
    // excluded from "previous" instead).
    expect(leaderboard.map((e) => e.rankMovement)).toEqual([{ type: "new" }, { type: "new" }]);
  });

  it("13. an OOC (Вне зачёта) player gets no rankMovement at all", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("owner", 900, "t-old"),
      resultRow("p1", 100, "t-old"),
      resultRow("owner", 50, "t-new"),
    ]);
    mockListBySeasonId.mockResolvedValue([exclusion("owner")]);
    mockListCompleted.mockResolvedValue([
      tournament({ id: "t-old", start_at: "2026-05-01T00:00:00.000Z" }),
      tournament({ id: "t-new", start_at: "2026-06-01T00:00:00.000Z" }),
    ]);

    const { leaderboard, outOfCompetition } = await getOfficialSeasonLeaderboardWithMovement("s1");

    expect(leaderboard.every((e) => e.player_id !== "owner")).toBe(true);
    const ownerRow = outOfCompetition.find((e) => e.player_id === "owner");
    expect(ownerRow).toBeDefined();
    expect(ownerRow).not.toHaveProperty("rankMovement");
  });

  it("14. OOC players never consume an official rank slot in EITHER the current or the previous snapshot", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("owner", 10000, "t-old"), // highest rating by far, but OOC
      resultRow("p1", 500, "t-old"),
      resultRow("p2", 400, "t-old"),
      resultRow("owner", 10, "t-new"),
      resultRow("p1", 10, "t-new"),
    ]);
    mockListBySeasonId.mockResolvedValue([exclusion("owner")]);
    mockListCompleted.mockResolvedValue([
      tournament({ id: "t-old", start_at: "2026-05-01T00:00:00.000Z" }),
      tournament({ id: "t-new", start_at: "2026-06-01T00:00:00.000Z" }),
    ]);

    const { leaderboard } = await getOfficialSeasonLeaderboardWithMovement("s1");

    // p1 must be officialRank 1 in both snapshots (owner never occupies
    // rank 1 despite having the highest raw rating) -- so p1 stays "same",
    // not shifted by owner's presence.
    const p1 = leaderboard.find((e) => e.player_id === "p1")!;
    expect(p1.officialRank).toBe(1);
    expect(p1.rankMovement).toEqual({ type: "same" });
  });

  it("15. equal CURRENT rating among ranked players => movement unavailable for both, rendered neutral", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("p1", 100, "t-old"),
      resultRow("p2", 50, "t-old"),
      resultRow("p1", 50, "t-new"), // p1: 100 -> 150
      resultRow("p2", 100, "t-new"), // p2: 50 -> 150, now tied with p1
    ]);
    mockListBySeasonId.mockResolvedValue([]);
    mockListCompleted.mockResolvedValue([
      tournament({ id: "t-old", start_at: "2026-05-01T00:00:00.000Z" }),
      tournament({ id: "t-new", start_at: "2026-06-01T00:00:00.000Z" }),
    ]);

    const { leaderboard } = await getOfficialSeasonLeaderboardWithMovement("s1");

    expect(leaderboard.find((e) => e.player_id === "p1")?.rankMovement).toEqual({ type: "unavailable" });
    expect(leaderboard.find((e) => e.player_id === "p2")?.rankMovement).toEqual({ type: "unavailable" });
  });

  it("16. equal PREVIOUS rating among ranked players => movement unavailable, even though current ratings differ", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("p1", 100, "t-old"),
      resultRow("p2", 100, "t-old"), // tied previously
      resultRow("p1", 50, "t-new"), // p1 pulls ahead now: 150 vs 100
    ]);
    mockListBySeasonId.mockResolvedValue([]);
    mockListCompleted.mockResolvedValue([
      tournament({ id: "t-old", start_at: "2026-05-01T00:00:00.000Z" }),
      tournament({ id: "t-new", start_at: "2026-06-01T00:00:00.000Z" }),
    ]);

    const { leaderboard } = await getOfficialSeasonLeaderboardWithMovement("s1");

    expect(leaderboard.find((e) => e.player_id === "p1")?.rankMovement).toEqual({ type: "unavailable" });
    expect(leaderboard.find((e) => e.player_id === "p2")?.rankMovement).toEqual({ type: "unavailable" });
  });

  it("17. tie handling never changes the canonical official leaderboard order/ranks -- identical to plain getOfficialSeasonLeaderboard for the same input", async () => {
    mockFindWithPlayerBySeasonId.mockResolvedValue([
      resultRow("p1", 100, "t-old"),
      resultRow("p2", 100, "t-old"),
      resultRow("p3", 50, "t-old"),
    ]);
    mockListBySeasonId.mockResolvedValue([]);
    mockListCompleted.mockResolvedValue([tournament({ id: "t-old" })]);

    const plain = await getOfficialSeasonLeaderboard("s1");
    const withMovement = await getOfficialSeasonLeaderboardWithMovement("s1");

    expect(withMovement.leaderboard.map((e) => ({ player_id: e.player_id, officialRank: e.officialRank, rating: e.rating }))).toEqual(
      plain.leaderboard.map((e) => ({ player_id: e.player_id, officialRank: e.officialRank, rating: e.rating }))
    );
  });

  it("does not mutate the rows/exclusions/tournaments arrays it reads", async () => {
    const rows = [resultRow("p1", 100, "t-old"), resultRow("p1", 50, "t-new")];
    const rowsSnapshot = rows.map((r) => ({ ...r }));
    mockFindWithPlayerBySeasonId.mockResolvedValue(rows);
    mockListBySeasonId.mockResolvedValue([]);
    const tournaments = [
      tournament({ id: "t-old", start_at: "2026-05-01T00:00:00.000Z" }),
      tournament({ id: "t-new", start_at: "2026-06-01T00:00:00.000Z" }),
    ];
    const tournamentsSnapshot = tournaments.map((t) => ({ ...t }));
    mockListCompleted.mockResolvedValue(tournaments);

    await getOfficialSeasonLeaderboardWithMovement("s1");

    expect(rows).toEqual(rowsSnapshot);
    expect(tournaments).toEqual(tournamentsSnapshot);
  });
});
