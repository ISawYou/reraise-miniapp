import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindWithPlayerBySeasonId = vi.fn();
const mockFindAllTimeWithPlayer = vi.fn();
const mockListBySeasonId = vi.fn();

vi.mock("@/lib/repositories", () => ({
  resultRepository: {
    findWithPlayerBySeasonId: mockFindWithPlayerBySeasonId,
    findAllTimeWithPlayer: mockFindAllTimeWithPlayer,
  },
  seasonRatingExclusionRepository: { listBySeasonId: mockListBySeasonId },
}));

const { getSeasonLeaderboard, getOfficialSeasonLeaderboard, getAllTimeLeaderboard } = await import(
  "@/features/leaderboard"
);

function resultRow(playerId: string, ratingPoints: number) {
  return {
    player_id: playerId,
    rating_points: ratingPoints,
    username: playerId,
    display_name: playerId,
    telegram_avatar_url: null,
    custom_avatar_url: null,
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
