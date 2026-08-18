import { describe, expect, it } from "vitest";
import { calculateRatingPoints, type RatingPointsBreakdown } from "@/features/rating";
import {
  calculateRatingPointsForTournament,
  calculateRatingPointsV2,
  type RatingPointsV2Result,
} from "@/features/rating-v2";

// Proves the core invariant this feature exists to guarantee:
//   rating_points === participation_points + knockout_points
//     + boss_bounty_points + mystery_bounty_points + itm_points
// for every result row the breakdown-aware calculators produce, across
// legacy and v2, every tournament format, and both arrived states.
function assertBreakdownSumsToTotal(
  row: { rating_points: number } & RatingPointsBreakdown
) {
  const sum =
    row.participation_points +
    row.knockout_points +
    row.boss_bounty_points +
    row.mystery_bounty_points +
    row.itm_points;
  expect(sum).toBe(row.rating_points);
}

describe("Rating Breakdown — legacy (calculateRatingPoints)", () => {
  it("classic: itm_points carries the placement value, sum matches rating_points", () => {
    const [a, b, c] = calculateRatingPoints(
      [
        { player_id: "a", place: 1, knockouts: 0, arrived: true },
        { player_id: "b", place: 2, knockouts: 0, arrived: true },
        { player_id: "c", place: 3, knockouts: 0, arrived: false },
      ],
      "classic"
    );

    // Same golden values as features/__tests__/rating.test.ts's "classic"
    // case -- proves the total is unchanged by this refactor, not just
    // that the new fields sum correctly.
    expect(a.rating_points).toBe(72);
    expect(a.itm_points).toBe(70);
    expect(a.participation_points).toBe(2);
    expect(a.knockout_points).toBe(0);
    expect(a.boss_bounty_points).toBe(0);
    expect(a.mystery_bounty_points).toBe(0);

    expect(b.rating_points).toBe(55);
    expect(c.rating_points).toBe(0);
    expect(c.itm_points).toBe(0);
    expect(c.participation_points).toBe(0);

    [a, b, c].forEach(assertBreakdownSumsToTotal);
  });

  it("bounty: knockout_points is isolated from itm_points (no double counting)", () => {
    const [a] = calculateRatingPoints(
      [{ player_id: "a", place: 1, knockouts: 3, arrived: true }],
      "bounty"
    );

    // Matches rating.test.ts's "bounty" case: 70 (place) + 2 + 15 (3*5) = 87.
    expect(a.rating_points).toBe(87);
    expect(a.itm_points).toBe(70);
    expect(a.knockout_points).toBe(15);
    expect(a.boss_bounty_points).toBe(0);
    assertBreakdownSumsToTotal(a);
  });

  it("boss_bounty: boss_bounty_points is isolated from both knockout_points and itm_points", () => {
    const [a] = calculateRatingPoints(
      [{ player_id: "a", place: 1, knockouts: 1, boss_knockouts: 2, arrived: true }],
      "boss_bounty"
    );

    // Matches rating.test.ts's "boss_bounty" case: 70 + 2 + 5 + 20 = 97.
    expect(a.rating_points).toBe(97);
    expect(a.itm_points).toBe(70);
    expect(a.knockout_points).toBe(5);
    expect(a.boss_bounty_points).toBe(20);
    assertBreakdownSumsToTotal(a);
  });

  it("mystery_bounty: mystery_bounty_points matches the existing frozen column, no double counting with itm_points", () => {
    const [a] = calculateRatingPoints(
      [{ player_id: "a", place: 1, knockouts: 0, arrived: true, mystery_bounty_points: 60 }],
      "mystery_bounty"
    );

    // Matches rating.test.ts's mystery cases: 70 + 2 + 60 = 132.
    expect(a.rating_points).toBe(132);
    expect(a.itm_points).toBe(70);
    expect(a.mystery_bounty_points).toBe(60);
    expect(a.knockout_points).toBe(0);
    assertBreakdownSumsToTotal(a);
  });

  it("phoenix (legacy x1.20 multiplier): the multiplier's effect lands entirely in itm_points", () => {
    const [a] = calculateRatingPoints(
      [{ player_id: "a", place: 1, knockouts: 0, arrived: true }],
      "phoenix"
    );

    // fieldSize=1 -> coefficient 0.7; legacy phoenix multiplier x1.20:
    // round(100*0.7*1.2) = round(84) = 84, + 2 participation = 86.
    expect(a.rating_points).toBe(86);
    expect(a.itm_points).toBe(84);
    expect(a.participation_points).toBe(2);
    assertBreakdownSumsToTotal(a);
  });

  it("arrived === false: every component, including rating_points, is exactly 0", () => {
    const [a] = calculateRatingPoints(
      [{ player_id: "a", place: 1, knockouts: 5, boss_knockouts: 5, mystery_bounty_points: 5, arrived: false }],
      "boss_bounty"
    );

    expect(a.rating_points).toBe(0);
    expect(a.participation_points).toBe(0);
    expect(a.knockout_points).toBe(0);
    expect(a.boss_bounty_points).toBe(0);
    expect(a.mystery_bounty_points).toBe(0);
    expect(a.itm_points).toBe(0);
    assertBreakdownSumsToTotal(a);
  });
});

describe("Rating Breakdown — v2 (calculateRatingPointsV2)", () => {
  it("classic (no volume): matches the legacy shape when there's no rebuy/addon volume", () => {
    const { results } = calculateRatingPointsV2(
      [
        { player_id: "a", place: 1, knockouts: 0, arrived: true, entries: 1, addons: 0 },
        { player_id: "b", place: 2, knockouts: 0, arrived: true, entries: 1, addons: 0 },
      ],
      "classic"
    );
    const [a, b] = results;

    // fieldSize=2 -> coefficient 0.7, volumeMultiplier=1 (no rebuys/addons):
    // same numbers as the legacy classic test above.
    expect(a.rating_points).toBe(72);
    expect(a.itm_points).toBe(70);
    expect(b.rating_points).toBe(55);

    [a, b].forEach(assertBreakdownSumsToTotal);
  });

  it("bounty: knockout_points stays flat (x5) and separate from the addon-driven itm_points multiplier", () => {
    const { results } = calculateRatingPointsV2(
      [{ player_id: "a", place: 1, knockouts: 3, arrived: true, entries: 1, addons: 0 }],
      "bounty"
    );
    const [a] = results;

    expect(a.rating_points).toBe(87);
    expect(a.itm_points).toBe(70);
    expect(a.knockout_points).toBe(15);
    expect(a.boss_bounty_points).toBe(0);
    assertBreakdownSumsToTotal(a);
  });

  it("boss_bounty: boss_bounty_points stays flat (x10), separate from knockout_points and itm_points", () => {
    const { results } = calculateRatingPointsV2(
      [
        {
          player_id: "a",
          place: 1,
          knockouts: 1,
          boss_knockouts: 2,
          arrived: true,
          entries: 1,
          addons: 0,
        },
      ],
      "boss_bounty"
    );
    const [a] = results;

    expect(a.rating_points).toBe(97);
    expect(a.itm_points).toBe(70);
    expect(a.knockout_points).toBe(5);
    expect(a.boss_bounty_points).toBe(20);
    assertBreakdownSumsToTotal(a);
  });

  it("mystery_bounty: no volume multiplier applied to itm_points, mystery_bounty_points passed through", () => {
    const { results } = calculateRatingPointsV2(
      [
        {
          player_id: "a",
          place: 1,
          knockouts: 0,
          arrived: true,
          entries: 1,
          addons: 0,
          mystery_bounty_points: 60,
        },
      ],
      "mystery_bounty"
    );
    const [a] = results;

    // Matches rating-v2.test.ts test G: 70 + 2 + 60 = 132.
    expect(a.rating_points).toBe(132);
    expect(a.itm_points).toBe(70);
    expect(a.mystery_bounty_points).toBe(60);
    assertBreakdownSumsToTotal(a);
  });

  it("phoenix, guarantee NOT triggered: itm_points is the plain placement value, no top-up folded in", () => {
    const players = [
      { player_id: "a", place: 1, knockouts: 0, arrived: true, entries: 1, addons: 0 },
      { player_id: "b", place: 2, knockouts: 0, arrived: true, entries: 1, addons: 0 },
      { player_id: "c", place: 3, knockouts: 0, arrived: true, entries: 1, addons: 0 },
    ];

    const { results, meta } = calculateRatingPointsV2(players, "phoenix", {
      ratingGuarantee: null,
    });

    expect(meta.kind).toBe("phoenix");
    if (meta.kind === "phoenix") {
      expect(meta.topUp).toBe(0);
    }

    const byId = new Map(results.map((r) => [r.player_id, r]));
    // fieldSize=3 -> coefficient 0.7, volumeMultiplier=1 (no volume):
    // place1: round(100*0.7)=70, place2: round(75*0.7)=53, place3: round(55*0.7)=39.
    expect(byId.get("a")?.itm_points).toBe(70);
    expect(byId.get("a")?.rating_points).toBe(72);
    expect(byId.get("b")?.itm_points).toBe(53);
    expect(byId.get("c")?.itm_points).toBe(39);
    results.forEach(assertBreakdownSumsToTotal);
  });

  it("phoenix, guarantee TRIGGERED: the top-up is folded into itm_points, not a separate component", () => {
    const players = [
      { player_id: "a", place: 1, knockouts: 0, arrived: true, entries: 1, addons: 0 },
      { player_id: "b", place: 2, knockouts: 0, arrived: true, entries: 1, addons: 0 },
      { player_id: "c", place: 3, knockouts: 0, arrived: true, entries: 1, addons: 0 },
    ];

    // Natural pool = 72 + 55 + 41 = 168 < guarantee=200 -> triggers, topUp=32,
    // distributed 14/10/8 by Largest Remainder (see features/rating-v2.ts's
    // distributePhoenixTopUp) -- same scenario shape as the existing
    // Phoenix guarantee test in rating-v2.test.ts (test L: 168/200 -> 32).
    const { results, meta } = calculateRatingPointsV2(players, "phoenix", {
      ratingGuarantee: 200,
    });

    expect(meta.kind).toBe("phoenix");
    if (meta.kind === "phoenix") {
      expect(meta.topUp).toBe(32);
      expect(meta.finalPool).toBe(200);
    }

    const byId = new Map(results.map((r) => [r.player_id, r]));

    expect(byId.get("a")?.rating_points).toBe(86);
    expect(byId.get("a")?.itm_points).toBe(84); // 70 (placement) + 14 (top-up share)
    expect(byId.get("b")?.rating_points).toBe(65);
    expect(byId.get("b")?.itm_points).toBe(63); // 53 + 10
    expect(byId.get("c")?.rating_points).toBe(49);
    expect(byId.get("c")?.itm_points).toBe(47); // 39 + 8

    const totalPool = results.reduce((sum, r) => sum + r.rating_points, 0);
    expect(totalPool).toBe(200); // matches the Guarantee exactly

    // The invariant holds even with the Guarantee's effect folded in --
    // there is no separate phoenix_guarantee_points field anywhere in this
    // sum.
    results.forEach(assertBreakdownSumsToTotal);
  });

  it("arrived === false: every component, including rating_points, is exactly 0 even with a Guarantee set", () => {
    const { results } = calculateRatingPointsV2(
      [
        {
          player_id: "a",
          place: 1,
          knockouts: 5,
          boss_knockouts: 5,
          mystery_bounty_points: 5,
          arrived: false,
          entries: 5,
          addons: 5,
        },
      ],
      "phoenix",
      { ratingGuarantee: 1000 }
    );
    const [a] = results;

    expect(a.rating_points).toBe(0);
    expect(a.participation_points).toBe(0);
    expect(a.itm_points).toBe(0);
    assertBreakdownSumsToTotal(a);
  });
});

describe("Rating Breakdown — dispatcher (calculateRatingPointsForTournament)", () => {
  it("legacy dispatch returns the exact same breakdown as calling calculateRatingPoints directly", () => {
    const players = [
      { player_id: "a", place: 1, knockouts: 3, arrived: true, entries: 5, addons: 2 },
      { player_id: "b", place: 2, knockouts: 0, arrived: false, entries: 1, addons: 0 },
    ];

    const direct = calculateRatingPoints(
      players.map((p) => ({
        player_id: p.player_id,
        place: p.place,
        knockouts: p.knockouts,
        arrived: p.arrived,
      })),
      "bounty"
    );

    const dispatched = calculateRatingPointsForTournament(players, "bounty", "legacy");

    expect(dispatched.meta).toBeNull();
    expect(dispatched.results).toEqual(direct);
    (dispatched.results as RatingPointsV2Result[]).forEach(assertBreakdownSumsToTotal);
  });

  it("v2 dispatch returns the exact same breakdown as calling calculateRatingPointsV2 directly", () => {
    const players = [
      { player_id: "a", place: 1, knockouts: 2, boss_knockouts: 1, arrived: true, entries: 3, addons: 1 },
      { player_id: "b", place: 2, knockouts: 0, arrived: true, entries: 1, addons: 0 },
    ];

    const direct = calculateRatingPointsV2(players, "boss_bounty");
    const dispatched = calculateRatingPointsForTournament(players, "boss_bounty", "v2");

    expect(dispatched.results).toEqual(direct.results);
    expect(dispatched.meta).toEqual(direct.meta);
    dispatched.results.forEach(assertBreakdownSumsToTotal);
  });
});
