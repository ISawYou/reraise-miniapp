import { describe, expect, it } from "vitest";
import { getLeaderboardPlaceTone, LEADERBOARD_GRID_CLASS } from "@/lib/leaderboard-display";

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
