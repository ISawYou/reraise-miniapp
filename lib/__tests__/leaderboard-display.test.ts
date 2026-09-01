import { describe, expect, it } from "vitest";
import {
  filterArchivableSeasons,
  getLeaderboardPlaceTone,
  getPodiumOrder,
  LEADERBOARD_GRID_CLASS,
  resolvePlayerStanding,
} from "@/lib/leaderboard-display";

describe("leaderboard display", () => {
  it("marks exactly places 1-9 as podium or finalists", () => {
    expect([1, 2, 3, 4, 9, 10].map((place) => getLeaderboardPlaceTone(place, false)))
      .toEqual(["gold", "silver", "bronze", "finalist", "finalist", "default"]);
  });

  it("keeps current player highlight and a shrinkable nickname column", () => {
    expect(getLeaderboardPlaceTone(7, true)).toBe("current");
    expect(LEADERBOARD_GRID_CLASS).toContain("minmax(0,1fr)");
  });
});

function row(id: string, rating: number) {
  return { player_id: id, rating };
}

describe("getPodiumOrder -- TOP-3 extraction/order", () => {
  it("orders a full TOP-3 as [second, first, third]", () => {
    const [p1, p2, p3] = [row("first", 100), row("second", 80), row("third", 60)];
    expect(getPodiumOrder([p1, p2, p3])).toEqual([p2, p1, p3]);
  });

  it("works with fewer than 3 players -- missing slots are null, not a placeholder", () => {
    const [p1] = [row("first", 100)];
    expect(getPodiumOrder([p1])).toEqual([null, p1, null]);

    const [a, b] = [row("first", 100), row("second", 80)];
    expect(getPodiumOrder([a, b])).toEqual([b, a, null]);
  });

  it("works with zero players", () => {
    expect(getPodiumOrder([])).toEqual([null, null, null]);
  });
});

describe("filterArchivableSeasons", () => {
  it("excludes the currently active season -- it's 'Текущий', never an archive option", () => {
    const seasons = [
      { id: "active", title: "Осень 2026", isActive: true },
      { id: "old", title: "Открытие", isActive: false },
    ];
    expect(filterArchivableSeasons(seasons)).toEqual([{ id: "old", title: "Открытие", isActive: false }]);
  });
});

describe("resolvePlayerStanding", () => {
  const leaderboard = [
    { player_id: "p1", officialRank: 1, rating: 100 },
    { player_id: "p2", officialRank: 2, rating: 80 },
  ];
  const outOfCompetition = [{ player_id: "owner", rating: 1000 }];

  it("resolves an officially ranked player's rank and points correctly", () => {
    expect(resolvePlayerStanding(leaderboard, outOfCompetition, "p2")).toEqual({
      rank: 2,
      points: 80,
      isOutOfCompetition: false,
    });
  });

  it("a player with no row at all -> rank null, 0 points, not OOC", () => {
    expect(resolvePlayerStanding(leaderboard, outOfCompetition, "nobody")).toEqual({
      rank: null,
      points: 0,
      isOutOfCompetition: false,
    });
  });

  it("a null playerId (viewer not resolved yet) -> the same zero state, never throws", () => {
    expect(resolvePlayerStanding(leaderboard, outOfCompetition, null)).toEqual({
      rank: null,
      points: 0,
      isOutOfCompetition: false,
    });
  });

  it("an OOC player gets their real points but NEVER a fake rank", () => {
    const standing = resolvePlayerStanding(leaderboard, outOfCompetition, "owner");
    expect(standing.rank).toBeNull();
    expect(standing.points).toBe(1000);
    expect(standing.isOutOfCompetition).toBe(true);
  });
});
