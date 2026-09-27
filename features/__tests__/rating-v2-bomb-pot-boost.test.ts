import { describe, expect, it } from "vitest";
import { PARTICIPATION_POINTS } from "@/features/rating";
import {
  applyPlacementPointsMultiplier,
  calculateRatingPlaceStructureForTournament,
  calculateRatingPointsForTournament,
  calculateRatingPointsV2,
  effectivePlacementPointsMultiplier,
  roundHalfUp,
  V2_ONLY_TOURNAMENT_TYPES,
  VOLUME_FORMATS,
  type PlayerRatingInputV2,
} from "@/features/rating-v2";
import { getExpectedPrizePlaces } from "@/lib/tournament-helpers";
import type { TournamentType } from "@/types/domain";

// 14 arrived players, 2 entries each (so volumeMultiplier > 1), the first
// one with add-ons and knockouts/boss/mystery inputs that must all be
// ignored by both new formats.
function field(): PlayerRatingInputV2[] {
  return Array.from({ length: 14 }, (_, i) => ({
    player_id: `p${i + 1}`,
    place: i + 1,
    knockouts: i === 0 ? 4 : 0,
    boss_knockouts: i === 0 ? 2 : 0,
    mystery_bounty_points: i === 0 ? 30 : 0,
    arrived: true,
    entries: 2,
    addons: i < 3 ? 1 : 0,
  }));
}

function sumOfComponents(r: {
  participation_points: number;
  knockout_points: number;
  boss_bounty_points: number;
  mystery_bounty_points: number;
  itm_points: number;
}) {
  return (
    r.participation_points +
    r.knockout_points +
    r.boss_bounty_points +
    r.mystery_bounty_points +
    r.itm_points
  );
}

describe("BOMB POT -- ordinary v2 volume format", () => {
  it("is a TournamentType in the canonical volume-format policy and v2-only", () => {
    const type: TournamentType = "bomb_pot";
    expect(VOLUME_FORMATS.has(type)).toBe(true);
    expect(V2_ONLY_TOURNAMENT_TYPES.has(type)).toBe(true);
  });

  it("uses the normal volumeMultiplier -- identical results/meta to classic", () => {
    const players = field();
    const classic = calculateRatingPointsV2(players, "classic");
    const bombPot = calculateRatingPointsV2(players, "bomb_pot");

    expect(bombPot).toEqual(classic);
    expect(bombPot.meta).toMatchObject({ kind: "volume", placementPointsMultiplier: 1 });
    if (bombPot.meta.kind !== "volume") throw new Error("expected volume meta");
    expect(bombPot.meta.volumeMultiplier).toBeGreaterThan(1);
  });

  it("standard rating zone, +2 participation, no KO/boss/mystery", () => {
    const { results } = calculateRatingPointsV2(field(), "bomb_pot");
    const zone = getExpectedPrizePlaces(14);

    results.forEach((r, i) => {
      expect(r.participation_points).toBe(PARTICIPATION_POINTS);
      expect(r.knockout_points).toBe(0);
      expect(r.boss_bounty_points).toBe(0);
      expect(r.mystery_bounty_points).toBe(0);
      expect(r.itm_points > 0).toBe(i + 1 <= zone);
      expect(r.rating_points).toBe(r.participation_points + r.itm_points);
    });
  });

  it("no Phoenix guarantee behavior even if a ratingGuarantee is passed", () => {
    const players = field();
    const plain = calculateRatingPointsV2(players, "bomb_pot");
    const withGuarantee = calculateRatingPointsV2(players, "bomb_pot", { ratingGuarantee: 100000 });
    expect(withGuarantee).toEqual(plain);
  });

  it("ignores a stray placement multiplier (boost is boost_rating-only)", () => {
    const players = field();
    expect(
      calculateRatingPointsV2(players, "bomb_pot", { placementPointsMultiplier: 2 })
    ).toEqual(calculateRatingPointsV2(players, "bomb_pot"));
  });
});

describe("BOOST RATING -- volume placement × placement_points_multiplier", () => {
  const players = field();
  const classic = calculateRatingPointsV2(players, "classic");

  function boost(multiplier: number) {
    return calculateRatingPointsV2(players, "boost_rating", { placementPointsMultiplier: multiplier });
  }

  it("spec example: natural 226 × 2 = 452; with +2 participation = 454", () => {
    expect(applyPlacementPointsMultiplier(226, 2)).toBe(452);
    expect(applyPlacementPointsMultiplier(226, 2) + PARTICIPATION_POINTS).toBe(454);
  });

  it("multiplier 1.0 = exactly the ordinary volume placement result", () => {
    const { results, meta } = boost(1);
    expect(results).toEqual(classic.results);
    expect(meta).toMatchObject({ kind: "volume", placementPointsMultiplier: 1 });
  });

  it.each([1.5, 2])("multiplier %s: itm = roundHalfUp(naturalItm × m), everything else unchanged", (m) => {
    const { results, meta } = boost(m);
    expect(meta).toMatchObject({ kind: "volume", placementPointsMultiplier: m });
    if (meta.kind !== "volume" || classic.meta.kind !== "volume") throw new Error("expected volume meta");
    expect(meta.volumeMultiplier).toBe(classic.meta.volumeMultiplier);

    results.forEach((r, i) => {
      const natural = classic.results[i];
      expect(r.itm_points).toBe(roundHalfUp(natural.itm_points * m));
      expect(r.participation_points).toBe(PARTICIPATION_POINTS);
      expect(r.knockout_points).toBe(0);
      expect(r.boss_bounty_points).toBe(0);
      expect(r.mystery_bounty_points).toBe(0);
      // Rating Breakdown invariant.
      expect(r.rating_points).toBe(sumOfComponents(r));
    });
  });

  it("multiplier 2.0 doubles every in-zone itm and never multiplies participation", () => {
    const { results } = boost(2);
    results.forEach((r, i) => {
      expect(r.itm_points).toBe(classic.results[i].itm_points * 2);
      expect(r.rating_points).toBe(classic.results[i].itm_points * 2 + PARTICIPATION_POINTS);
    });
  });

  it("outside the rating zone: itm 0, participation 2, total exactly 2", () => {
    const zone = getExpectedPrizePlaces(14);
    const { results } = boost(2);
    const outside = results.slice(zone);
    expect(outside.length).toBeGreaterThan(0);
    for (const r of outside) {
      expect(r).toMatchObject({ itm_points: 0, participation_points: 2, rating_points: 2 });
    }
  });

  it("non-arrived player gets nothing", () => {
    const withAbsent = [...players, { ...players[13], player_id: "absent", place: 0, arrived: false }];
    const absent = calculateRatingPointsV2(withAbsent, "boost_rating", {
      placementPointsMultiplier: 2,
    }).results.at(-1)!;
    expect(absent.rating_points).toBe(0);
  });

  it("rounds half up in exact hundredths (no binary-float .5 loss)", () => {
    // 30 × 1.15 = 34.5 exactly -> 35 (naive float gives 34.499999...).
    expect(applyPlacementPointsMultiplier(30, 1.15)).toBe(35);
    expect(applyPlacementPointsMultiplier(3, 1.5)).toBe(5);
    expect(applyPlacementPointsMultiplier(0, 2)).toBe(0);
  });

  it("missing multiplier on boost_rating = 1; invalid multiplier fails closed", () => {
    expect(effectivePlacementPointsMultiplier("boost_rating", null)).toBe(1);
    expect(effectivePlacementPointsMultiplier("boost_rating", undefined)).toBe(1);
    expect(() => effectivePlacementPointsMultiplier("boost_rating", 0)).toThrow();
    expect(() => effectivePlacementPointsMultiplier("boost_rating", -1)).toThrow();
    expect(() => effectivePlacementPointsMultiplier("boost_rating", Number.NaN)).toThrow();
    expect(effectivePlacementPointsMultiplier("classic", 2)).toBe(1);
  });
});

describe("Late Registration structure + completion never boost twice", () => {
  const entries = Array.from({ length: 14 }, (_, i) => ({ entries: 2, addons: i < 3 ? 1 : 0 }));

  it("rating_places built with multiplier 2 are ALREADY boosted", () => {
    const plain = calculateRatingPlaceStructureForTournament(entries, "classic", "v2");
    const boosted = calculateRatingPlaceStructureForTournament(entries, "boost_rating", "v2", {
      placementPointsMultiplier: 2,
    });
    expect(boosted).toHaveLength(getExpectedPrizePlaces(14));
    expect(boosted).toEqual(plain.map((p) => ({ place: p.place, points: p.points * 2 })));
  });

  it("completion with a frozen (boosted) snapshot uses it verbatim -- not boosted again", () => {
    const frozen = calculateRatingPlaceStructureForTournament(entries, "boost_rating", "v2", {
      placementPointsMultiplier: 2,
    });
    const { results } = calculateRatingPointsForTournament(field(), "boost_rating", "v2", {
      placementPointsMultiplier: 2,
      ratingPlaces: frozen,
    });

    const zone = getExpectedPrizePlaces(14);
    results.forEach((r, i) => {
      expect(r.itm_points).toBe(i < zone ? frozen[i].points : 0);
      expect(r.rating_points).toBe(r.itm_points + PARTICIPATION_POINTS);
      expect(r.rating_points).toBe(sumOfComponents(r));
    });
  });

  it("completion without a snapshot boosts exactly once (fresh calculation)", () => {
    const fresh = calculateRatingPointsForTournament(field(), "boost_rating", "v2", {
      placementPointsMultiplier: 2,
    });
    const classic = calculateRatingPointsForTournament(field(), "classic", "v2");
    fresh.results.forEach((r, i) => {
      expect(r.itm_points).toBe(classic.results[i].itm_points * 2);
    });
  });
});

describe("V2-only safety", () => {
  it.each(["bomb_pot", "boost_rating"] as const)(
    "%s + legacy formula fails closed instead of computing legacy math",
    (type) => {
      expect(() => calculateRatingPointsForTournament(field(), type, "legacy")).toThrow(/v2/);
      expect(() =>
        calculateRatingPlaceStructureForTournament([{ entries: 1, addons: 0 }], type, "legacy")
      ).toThrow(/v2/);
    }
  );

  it("legacy formula for existing types is untouched", () => {
    expect(() => calculateRatingPointsForTournament(field(), "classic", "legacy")).not.toThrow();
  });
});
