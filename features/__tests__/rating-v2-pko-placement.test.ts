import { describe, expect, it } from "vitest";
import {
  calculateRatingPointsForTournament,
  calculateRatingPointsV2,
  VOLUME_FORMATS,
  type PlayerRatingInputV2,
} from "@/features/rating-v2";

function field(entries: number, addons = 0): PlayerRatingInputV2[] {
  return Array.from({ length: 12 }, (_, index) => ({
    player_id: `p${index + 1}`,
    place: index + 1,
    knockouts: 0,
    arrived: true,
    entries: index === 0 ? entries - 11 : 1,
    addons: index === 0 ? addons : 0,
  }));
}

describe("PKO placement rating policy", () => {
  it("keeps PKO on the v2-only path without classifying it as ordinary volume", () => {
    expect(VOLUME_FORMATS.has("progressive_knockout")).toBe(false);
  });

  it("uses a 1x placement multiplier for 12 players, 24 entries and no addons", () => {
    const { results, meta } = calculateRatingPointsV2(field(24), "progressive_knockout");

    expect(meta).toMatchObject({ kind: "addon_share", addonShare: 0, placementMultiplier: 1 });
    expect(results[0]).toMatchObject({ itm_points: 100, rating_points: 102 });
  });

  it("does not increase placement points when only re-entries increase", () => {
    const oneRebuyRound = calculateRatingPointsV2(field(24), "progressive_knockout");
    const twoRebuyRounds = calculateRatingPointsV2(field(36), "progressive_knockout");

    expect(twoRebuyRounds.results.map((result) => result.itm_points)).toEqual(
      oneRebuyRound.results.map((result) => result.itm_points)
    );
  });

  it("uses only the weighted addon share when addons are present", () => {
    const { results, meta } = calculateRatingPointsV2(field(24, 6), "progressive_knockout");

    expect(meta).toMatchObject({
      kind: "addon_share",
      weightedVolume: 36,
      addonShare: 12 / 36,
      placementMultiplier: 1 + 1.25 * (12 / 36),
    });
    expect(results[0].itm_points).toBe(142);
  });

  it("matches Bounty and Boss Bounty placement points without importing their KO bonuses", () => {
    const pko = calculateRatingPointsV2(field(24, 6), "progressive_knockout");
    const bounty = calculateRatingPointsV2(field(24, 6), "bounty");
    const boss = calculateRatingPointsV2(field(24, 6), "boss_bounty");

    expect(pko.results.map((result) => result.itm_points)).toEqual(
      bounty.results.map((result) => result.itm_points)
    );
    expect(pko.results.map((result) => result.itm_points)).toEqual(
      boss.results.map((result) => result.itm_points)
    );
  });

  it("does not add fixed +5 KO points to PKO; the ledger remains separate", () => {
    const players = field(12).map((player) => ({ ...player, knockouts: player.place === 1 ? 3 : 0 }));
    const result = calculateRatingPointsV2(players, "progressive_knockout").results[0];

    expect(result).toMatchObject({ knockout_points: 0, itm_points: 100, rating_points: 102 });
  });

  it("keeps frozen placement points authoritative at completion", () => {
    const result = calculateRatingPointsForTournament(
      field(36, 6),
      "progressive_knockout",
      "v2",
      { ratingPlaces: [{ place: 1, points: 77 }] }
    ).results[0];

    expect(result).toMatchObject({ itm_points: 77, rating_points: 79 });
  });
});
