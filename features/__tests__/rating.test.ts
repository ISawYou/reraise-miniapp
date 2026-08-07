import { describe, expect, it } from "vitest";
import { calculateRatingPoints } from "@/features/rating";

describe("calculateRatingPoints — existing formats unchanged", () => {
  it("classic: place + field coefficient + participation bonus, no mystery bounty term", () => {
    const players = [
      { player_id: "a", place: 1, knockouts: 0, arrived: true },
      { player_id: "b", place: 2, knockouts: 0, arrived: true },
      { player_id: "c", place: 3, knockouts: 0, arrived: false },
    ];

    const result = calculateRatingPoints(players, "classic");
    const byId = new Map(result.map((r) => [r.player_id, r.rating_points]));

    // fieldSize = 2 arrived -> coefficient 0.7; place 1 = 100*0.7+2 = 72
    expect(byId.get("a")).toBe(72);
    // place 2 = 75*0.7 rounded (52.5 -> 53) + 2 = 55
    expect(byId.get("b")).toBe(55);
    // did not arrive -> flat 0, regardless of anything else
    expect(byId.get("c")).toBe(0);
  });

  it("bounty: knockouts still worth +5 each with no mystery_bounty_points passed", () => {
    const players = [{ player_id: "a", place: 1, knockouts: 3, arrived: true }];
    const result = calculateRatingPoints(players, "bounty");
    // fieldSize=1 -> coefficient 0.7; 100*0.7=70, +2 participation, +15 knockouts
    expect(result[0].rating_points).toBe(70 + 2 + 15);
  });

  it("boss_bounty: unaffected by the new optional field being absent", () => {
    const players = [
      { player_id: "a", place: 1, knockouts: 1, boss_knockouts: 2, arrived: true },
    ];
    const result = calculateRatingPoints(players, "boss_bounty");
    // fieldSize=1 -> coefficient 0.7; 100*0.7=70, +2, +5 (knockout), +20 (boss knockouts)
    expect(result[0].rating_points).toBe(70 + 2 + 5 + 20);
  });
});

describe("calculateRatingPoints — mystery_bounty_points is purely additive", () => {
  it("adds mystery_bounty_points on top of the normal formula", () => {
    const withoutBounty = calculateRatingPoints(
      [{ player_id: "a", place: 1, knockouts: 0, arrived: true }],
      "mystery_bounty"
    )[0].rating_points;

    const withBounty = calculateRatingPoints(
      [{ player_id: "a", place: 1, knockouts: 0, arrived: true, mystery_bounty_points: 60 }],
      "mystery_bounty"
    )[0].rating_points;

    expect(withBounty).toBe(withoutBounty + 60);
  });

  it("does not award mystery_bounty_points to a player who did not arrive", () => {
    const result = calculateRatingPoints(
      [{ player_id: "a", place: 1, knockouts: 0, arrived: false, mystery_bounty_points: 60 }],
      "mystery_bounty"
    );
    expect(result[0].rating_points).toBe(0);
  });

  it("mystery_bounty tournaments still get placement + participation points as usual", () => {
    const result = calculateRatingPoints(
      [{ player_id: "a", place: 1, knockouts: 0, arrived: true, mystery_bounty_points: 0 }],
      "mystery_bounty"
    );
    // fieldSize=1 -> coefficient 0.7; 100*0.7=70, +2 participation, +0 bounty
    expect(result[0].rating_points).toBe(72);
  });
});
