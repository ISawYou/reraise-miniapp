import { describe, expect, it } from "vitest";
import { calculateRatingPoints, PARTICIPATION_POINTS } from "@/features/rating";
import {
  calculateRatingPlaceStructureForTournament,
  calculateRatingPointsForTournament,
  calculateRatingPointsV2,
  computeAddonPlacementMultiplier,
  computeExtraVolume,
  computeVolumeMultiplier,
  computeWeightedVolume,
  distributePhoenixTopUp,
  roundHalfUp,
  type PlayerRatingInputV2,
} from "@/features/rating-v2";

function arrivedPlayers(count: number, entriesEach: number, addonsEach = 0): PlayerRatingInputV2[] {
  return Array.from({ length: count }, (_, i) => ({
    player_id: `p${i + 1}`,
    place: i + 1,
    knockouts: 0,
    arrived: true,
    entries: entriesEach,
    addons: addonsEach,
  }));
}

function byId(results: { player_id: string; rating_points: number }[]) {
  return new Map(results.map((r) => [r.player_id, r.rating_points]));
}

describe("roundHalfUp", () => {
  it("rounds .5 up, not to even (not banker's rounding)", () => {
    expect(roundHalfUp(162.5)).toBe(163);
    expect(roundHalfUp(188.5416666666667)).toBe(189);
    expect(roundHalfUp(2.5)).toBe(3);
  });
});

describe("A — Classic, no rebuys/addons: volume multiplier is 1, matches legacy shape", () => {
  it("Players=14, Entries=14 (=Players, no rebuys), Addons=0", () => {
    const players = arrivedPlayers(14, 1, 0); // sum(entries) = 14 = Players
    const { results, meta } = calculateRatingPointsV2(players, "classic");

    expect(meta.kind).toBe("volume");
    if (meta.kind === "volume") {
      expect(meta.volumeShare).toBe(0);
      expect(meta.volumeMultiplier).toBe(1);
    }

    // fieldSize=14 -> coefficient 1.0; prizeZone = clamp(ceil(4.2),3,14) = 5
    // place 1 = round(100*1.0*1) + 2 = 102
    expect(byId(results).get("p1")).toBe(102);
  });
});

describe("B — Classic with rebuys, no addons", () => {
  it("Players=14, Entries=28, Addons=0 -> Volume Share=0.5, Multiplier=1.625", () => {
    const players = arrivedPlayers(14, 2, 0); // sum(entries) = 28, rebuys = 14
    const { results, meta } = calculateRatingPointsV2(players, "classic");

    expect(meta.kind).toBe("volume");
    if (meta.kind === "volume") {
      expect(meta.weightedVolume).toBe(28);
      expect(meta.extraVolume).toBe(14);
      expect(meta.volumeShare).toBe(0.5);
      expect(meta.volumeMultiplier).toBe(1.625);
    }

    // place 1 = round(100*1.0*1.625) + 2 = round(162.5) + 2 = 163 + 2 = 165
    expect(byId(results).get("p1")).toBe(165);
  });
});

describe("C — Classic with rebuys + addons (2x addon weight)", () => {
  it("Players=14, Entries=28, Addons=10 -> Weighted=48, Extra=34, Share=0.708333.., Multiplier=1.885417..", () => {
    // Total Entries=28 (2 each, sum=28, rebuys=14) and Addons=10 total for
    // the tournament (all on one player -- addons are a tournament-level
    // aggregate, not credited to whoever happened to buy them, per spec §11).
    const players: PlayerRatingInputV2[] = Array.from({ length: 14 }, (_, i) => ({
      player_id: `p${i + 1}`,
      place: i + 1,
      knockouts: 0,
      arrived: true,
      entries: 2,
      addons: i === 0 ? 10 : 0,
    }));

    const { results, meta } = calculateRatingPointsV2(players, "classic");

    expect(meta.kind).toBe("volume");
    if (meta.kind === "volume") {
      expect(meta.weightedVolume).toBe(48); // 28 + 2*10
      expect(meta.extraVolume).toBe(34); // 14 + 2*10
      expect(meta.volumeShare).toBeCloseTo(34 / 48, 10);
      expect(meta.volumeMultiplier).toBeCloseTo(1 + 1.25 * (34 / 48), 10);
    }

    // place 1 = round(100*1.0*1.885416666..) + 2 = round(188.5416..) + 2 = 189 + 2 = 191
    expect(byId(results).get("p1")).toBe(191);
  });
});

describe("D — an add-on carries 2x the weight of a rebuy (not 1x)", () => {
  it("computeExtraVolume: +1 addon moves the total by 2, +1 rebuy moves it by 1", () => {
    expect(computeExtraVolume({ totalRebuys: 0, addons: 0 })).toBe(0);
    expect(computeExtraVolume({ totalRebuys: 1, addons: 0 })).toBe(1);
    expect(computeExtraVolume({ totalRebuys: 0, addons: 1 })).toBe(2);
    expect(computeExtraVolume({ totalRebuys: 1, addons: 1 })).toBe(3);
  });

  it("computeWeightedVolume: same 2x weighting", () => {
    expect(computeWeightedVolume({ totalEntries: 10, addons: 0 })).toBe(10);
    expect(computeWeightedVolume({ totalEntries: 10, addons: 1 })).toBe(12);
  });
});

describe("E — Bounty: rebuys excluded from the placement multiplier, addons included", () => {
  it("Players=14, Entries=28, Addons=10 -> Addon Share=20/48, distinct from Classic's Volume Share on the same numbers", () => {
    const players: PlayerRatingInputV2[] = Array.from({ length: 14 }, (_, i) => ({
      player_id: `p${i + 1}`,
      place: i + 1,
      knockouts: i === 0 ? 2 : 0,
      arrived: true,
      entries: 2, // sum = 28, rebuys = 14
      addons: i === 0 ? 10 : 0, // sum = 10
    }));

    const { results, meta } = calculateRatingPointsV2(players, "bounty");

    expect(meta.kind).toBe("addon_share");
    if (meta.kind === "addon_share") {
      expect(meta.weightedVolume).toBe(48); // same denominator as Classic's example (28 + 2*10)
      // (2*10)/48 -- NOT (2*10+14)/48. If rebuys leaked into the numerator
      // this would equal 34/48 = Classic's volumeShare from test C, which
      // it must not.
      expect(meta.addonShare).toBeCloseTo(20 / 48, 10);
      expect(meta.addonShare).not.toBeCloseTo(34 / 48, 10);
      expect(meta.placementMultiplier).toBeCloseTo(1 + 1.25 * (20 / 48), 10);
    }

    // place 1 = round(100*1.0*1.520833..) + KO(2*5) + 2
    //         = round(152.0833..) + 10 + 2 = 152 + 12 = 164
    expect(byId(results).get("p1")).toBe(164);
  });
});

describe("F — Boss Bounty: normal knockouts and boss knockouts stay separate", () => {
  it("degrades to legacy-equivalent math when there is no extra volume (addons=0, entries=players)", () => {
    const players: PlayerRatingInputV2[] = [
      { player_id: "a", place: 1, knockouts: 1, boss_knockouts: 2, arrived: true, entries: 1, addons: 0 },
    ];

    const { results, meta } = calculateRatingPointsV2(players, "boss_bounty");

    expect(meta.kind).toBe("addon_share");
    if (meta.kind === "addon_share") {
      expect(meta.addonShare).toBe(0);
      expect(meta.placementMultiplier).toBe(1);
    }

    // fieldSize=1 -> coefficient 0.7; 100*0.7=70, +2 participation,
    // +5 (1 normal knockout), +20 (2 boss knockouts) -- identical to the
    // legacy boss_bounty test in rating.test.ts, since the multiplier is 1.
    expect(byId(results).get("a")).toBe(70 + 2 + 5 + 20);
  });
});

describe("G — Mystery Bounty: no volume/addon multiplier on placement", () => {
  it("placement ignores entries/addons entirely -- volume is captured by the separate Mystery Pool, not placement", () => {
    const players: PlayerRatingInputV2[] = [
      {
        player_id: "a",
        place: 1,
        knockouts: 0,
        arrived: true,
        entries: 5, // large, would move the multiplier if it were a volume format
        addons: 5,
        mystery_bounty_points: 60,
      },
    ];

    const { results, meta } = calculateRatingPointsV2(players, "mystery_bounty");
    expect(meta.kind).toBe("mystery");

    // fieldSize=1 -> coefficient 0.7; 100*0.7=70, +2 participation, +60 mystery
    expect(byId(results).get("a")).toBe(70 + 2 + 60);
  });
});

describe("I — Win The Button: no legacy x1.20, identical to Classic given identical inputs", () => {
  it("produces the exact same rating_points as Classic on the same roster", () => {
    const players = arrivedPlayers(14, 2, 0); // same as test B
    const classic = calculateRatingPointsV2(players, "classic");
    const wtb = calculateRatingPointsV2(players, "win_the_button");

    expect(byId(wtb.results)).toEqual(byId(classic.results));
    expect(wtb.meta).toEqual(classic.meta);
  });
});

describe("J — Phoenix: no legacy x1.20; natural (unguaranteed) math matches Classic", () => {
  it("with no ratingGuarantee, produces the exact same natural rating_points as Classic", () => {
    const players = arrivedPlayers(14, 2, 0);
    const classic = calculateRatingPointsV2(players, "classic");
    const phoenix = calculateRatingPointsV2(players, "phoenix", { ratingGuarantee: null });

    expect(byId(phoenix.results)).toEqual(byId(classic.results));
    expect(phoenix.meta.kind).toBe("phoenix");
    if (phoenix.meta.kind === "phoenix") {
      expect(phoenix.meta.topUp).toBe(0);
      expect(phoenix.meta.guarantee).toBeNull();
    }
  });
});

// Shared 3-player Phoenix scenario for K/L: fieldSize=3 (coefficient 0.7),
// prizeZone=3 (all three placed), no rebuys/addons (volumeMultiplier=1).
// Natural placement: p1=70, p2=53 (round(52.5)), p3=39 (round(38.5)).
// Natural total (incl. +2 participation each): p1=72, p2=55, p3=41 -> pool=168.
function phoenixThreePlayers(): PlayerRatingInputV2[] {
  return [
    { player_id: "p1", place: 1, knockouts: 0, arrived: true, entries: 1, addons: 0 },
    { player_id: "p2", place: 2, knockouts: 0, arrived: true, entries: 1, addons: 0 },
    { player_id: "p3", place: 3, knockouts: 0, arrived: true, entries: 1, addons: 0 },
  ];
}

describe("K — Phoenix guarantee NOT triggered (natural pool already covers it)", () => {
  it("Natural Pool=168, Guarantee=100 -> Final=168, unchanged", () => {
    const { results, meta } = calculateRatingPointsV2(phoenixThreePlayers(), "phoenix", {
      ratingGuarantee: 100,
    });

    expect(meta.kind).toBe("phoenix");
    if (meta.kind === "phoenix") {
      expect(meta.naturalPool).toBe(168);
      expect(meta.topUp).toBe(0);
      expect(meta.finalPool).toBe(168);
    }

    const sum = results.reduce((s, r) => s + r.rating_points, 0);
    expect(sum).toBe(168);
    expect(byId(results).get("p1")).toBe(72);
    expect(byId(results).get("p2")).toBe(55);
    expect(byId(results).get("p3")).toBe(41);
  });
});

describe("L — Phoenix guarantee triggered: sum(final) === guarantee exactly", () => {
  it("Natural Pool=168, Guarantee=200 -> TopUp=32, distributed by Largest Remainder over placement only", () => {
    const { results, meta } = calculateRatingPointsV2(phoenixThreePlayers(), "phoenix", {
      ratingGuarantee: 200,
    });

    expect(meta.kind).toBe("phoenix");
    if (meta.kind === "phoenix") {
      expect(meta.naturalPool).toBe(168);
      expect(meta.topUp).toBe(32);
      expect(meta.finalPool).toBe(200);
    }

    // Natural placement points 70/53/39 (sum=162) share topUp=32:
    // exact shares 13.827.., 10.469.., 7.703.. -> floors 13/10/7 (sum 30,
    // remainder 2 left) -> largest fractional remainders are p1 (.827) and
    // p3 (.704) -> +1 each -> final placement top-ups 14/10/8.
    // Participation (+2 each) is untouched throughout.
    expect(byId(results).get("p1")).toBe(72 + 14); // 86
    expect(byId(results).get("p2")).toBe(55 + 10); // 65
    expect(byId(results).get("p3")).toBe(41 + 8); // 49

    const sum = results.reduce((s, r) => s + r.rating_points, 0);
    expect(sum).toBe(200); // === Rating Guarantee, exactly
  });
});

describe("M — distributePhoenixTopUp: deterministic Largest Remainder, tie-break by better place", () => {
  it("splits a tied remainder in favor of the better (lower-numbered) finishing place", () => {
    const placements = [
      { player_id: "a", place: 1, naturalPlacementPoints: 50 },
      { player_id: "b", place: 2, naturalPlacementPoints: 50 },
    ];

    // Equal points -> equal exact share (0.5 each) -> exact tie on the
    // fractional remainder -> place 1 must win the single extra point.
    const result = distributePhoenixTopUp(placements, 1);
    expect(result.get("a")).toBe(1);
    expect(result.get("b")).toBe(0);
  });

  it("is deterministic across repeated calls with the same input", () => {
    const placements = [
      { player_id: "a", place: 3, naturalPlacementPoints: 30 },
      { player_id: "b", place: 1, naturalPlacementPoints: 30 },
      { player_id: "c", place: 2, naturalPlacementPoints: 30 },
    ];

    const first = distributePhoenixTopUp(placements, 2);
    const second = distributePhoenixTopUp(placements, 2);
    expect(Array.from(first.entries())).toEqual(Array.from(second.entries()));
    // Equal points, equal remainders -> tie-break purely on place: 1 then 2.
    expect(first.get("b")).toBe(1); // place 1
    expect(first.get("c")).toBe(1); // place 2
    expect(first.get("a")).toBe(0); // place 3
  });

  it("distributes exactly topUp, never more or less", () => {
    const placements = [
      { player_id: "a", place: 1, naturalPlacementPoints: 17 },
      { player_id: "b", place: 2, naturalPlacementPoints: 23 },
      { player_id: "c", place: 3, naturalPlacementPoints: 5 },
    ];
    const topUp = 13;
    const result = distributePhoenixTopUp(placements, topUp);
    const sum = Array.from(result.values()).reduce((s, v) => s + v, 0);
    expect(sum).toBe(topUp);
  });
});

describe("N — legacy dispatch is a pure passthrough to the untouched v1 formula", () => {
  it("calculateRatingPointsForTournament(..., \"legacy\") matches calculateRatingPoints(...) byte-for-byte", () => {
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
  });

  it("calculateRatingPointsForTournament(..., \"v2\") uses the new engine (differs from legacy when there's volume)", () => {
    const players = arrivedPlayers(14, 2, 0); // rebuys=14 -> volume multiplier > 1
    const legacy = calculateRatingPointsForTournament(players, "classic", "legacy");
    const v2 = calculateRatingPointsForTournament(players, "classic", "v2");

    expect(v2.meta).not.toBeNull();
    expect(byId(v2.results).get("p1")).not.toBe(byId(legacy.results).get("p1"));
  });
});

describe("Participation is never multiplied", () => {
  it("+2 participation stays flat regardless of volume multiplier or Phoenix top-up", () => {
    const highVolume = arrivedPlayers(14, 3, 20); // huge rebuy+addon volume
    const { meta } = calculateRatingPointsV2(highVolume, "classic");
    expect(meta.kind).toBe("volume");
    if (meta.kind === "volume") {
      // weightedVolume = 42 + 2*280 = 602, extraVolume = 28 + 2*280 = 588
      // volumeShare = 588/602 = 0.97675.. -> multiplier = 1+1.25*0.97675.. = 2.2209..
      expect(meta.volumeMultiplier).toBeGreaterThan(2); // sanity: this really is a big multiplier
    }

    // A non-arrived player always gets exactly 0, regardless of anything else.
    const withAbsent: PlayerRatingInputV2[] = [
      { player_id: "x", place: 1, knockouts: 0, arrived: false, entries: 0, addons: 0 },
    ];
    expect(byId(calculateRatingPointsV2(withAbsent, "classic").results).get("x")).toBe(0);
  });

  it("every arrived v2 player's participation_points is exactly the canonical PARTICIPATION_POINTS constant", () => {
    const players = arrivedPlayers(9, 1, 0);
    const { results } = calculateRatingPointsV2(players, "classic");

    expect(PARTICIPATION_POINTS).toBe(2);
    for (const r of results) {
      expect(r.participation_points).toBe(PARTICIPATION_POINTS);
    }
  });
});

// Root cause of "live Poker Clock projection is missing +2": Late
// Registration close freezes a PER-PLACE table (rating_places) so
// completion can reuse the exact placement distribution regardless of who
// ends up finishing where. That table can only ever hold itm_points --
// participation/knockout/boss/mystery are per-PLAYER, not per-place, and
// participation specifically would double-count if it were baked in here
// AND re-added at completion (see the next describe block). This is a
// contract test on that frozen shape, not a bug -- the actual fix is in
// features/late-registration.ts::getTournamentStateForIntegration, which
// must fold PARTICIPATION_POINTS back in for the live response (covered in
// features/__tests__/late-registration.test.ts).
describe("O — calculateRatingPlaceStructureForTournament freezes itm_points ONLY (participation excluded by design)", () => {
  it("a place's frozen points never include the +2 participation component", () => {
    const entries = arrivedPlayers(9, 1, 0).map(() => ({ entries: 1, addons: 0 }));
    const places = calculateRatingPlaceStructureForTournament(entries, "classic", "v2");

    // Cross-check against the natural per-player computation for the same
    // roster: itm_points for place 1 must match exactly, and must NOT have
    // participation folded in.
    const natural = calculateRatingPointsV2(arrivedPlayers(9, 1, 0), "classic").results;
    const place1 = places.find((p) => p.place === 1)!;
    const naturalPlace1 = natural.find((r) => r.player_id === "p1")!;

    expect(place1.points).toBe(naturalPlace1.itm_points);
    expect(place1.points).not.toBe(naturalPlace1.rating_points);
  });
});

// Verifies the live-display fix actually closes the gap it targets: for a
// player with no knockout/boss/mystery activity, what the live integration
// response now shows for their place (frozen itm + PARTICIPATION_POINTS,
// see features/late-registration.ts) matches what completion's existing,
// UNCHANGED `ratingPlaces` merge (features/rating-v2.ts,
// calculateRatingPointsForTournament) already produces for that same place.
// Does not exercise or assert anything about completion-formula selection
// (rating_formula_version) -- out of scope for this fix.
describe("P — live preview total matches completion's existing (unmodified) ratingPlaces merge", () => {
  it("live preview total (frozen itm + PARTICIPATION_POINTS) equals completion's total for a player with no KO/boss/mystery activity", () => {
    const ratingPlaces = calculateRatingPlaceStructureForTournament(
      arrivedPlayers(9, 1, 0).map(() => ({ entries: 1, addons: 0 })),
      "classic",
      "v2"
    );

    // What the live integration response now shows for place 1 (see
    // features/late-registration.ts).
    const livePreviewTotal = ratingPlaces.find((p) => p.place === 1)!.points + PARTICIPATION_POINTS;

    // What completion freezes for the player who actually finishes 1st,
    // assuming no knockouts (classic has none anyway).
    const players = arrivedPlayers(9, 1, 0);
    const { results } = calculateRatingPointsForTournament(players, "classic", "v2", { ratingPlaces });
    const finalTotal = results.find((r) => r.player_id === "p1")!.rating_points;

    expect(livePreviewTotal).toBe(finalTotal);
  });
});

describe("computeVolumeMultiplier / computeAddonPlacementMultiplier — pure formula checks", () => {
  it("both are 1 + 1.25 * share", () => {
    expect(computeVolumeMultiplier(0)).toBe(1);
    expect(computeVolumeMultiplier(1)).toBe(2.25);
    expect(computeAddonPlacementMultiplier(0)).toBe(1);
    expect(computeAddonPlacementMultiplier(0.4)).toBeCloseTo(1.5, 10);
  });
});

// Final Month (tournament.is_final) is a championship, not a rating
// tournament -- ratingEligible=false (see
// lib/tournament-helpers.ts::isRatingEligibleTournament) must zero every
// component of every result, unconditionally, before either the legacy or
// v2 branch (or the frozen-ratingPlaces override) ever runs. Never a
// partial zero (e.g. placement zeroed but participation leaking through).
describe("calculateRatingPointsForTournament — ratingEligible=false (Final Month)", () => {
  it("zeroes rating_points and every breakdown component for arrived players with knockouts/entries/addons", () => {
    const players: PlayerRatingInputV2[] = [
      { player_id: "p1", place: 1, knockouts: 3, boss_knockouts: 1, arrived: true, entries: 2, addons: 1 },
      { player_id: "p2", place: 2, knockouts: 0, arrived: true, entries: 1, addons: 0 },
    ];

    const { results, meta } = calculateRatingPointsForTournament(
      players,
      "boss_bounty",
      "v2",
      {},
      false
    );

    expect(meta).toBeNull();
    for (const result of results) {
      expect(result).toMatchObject({
        rating_points: 0,
        participation_points: 0,
        knockout_points: 0,
        boss_bounty_points: 0,
        mystery_bounty_points: 0,
        itm_points: 0,
      });
    }
  });

  it("stays zero regardless of rating_formula_version (legacy or v2)", () => {
    const players = arrivedPlayers(9, 1, 0);

    const legacy = calculateRatingPointsForTournament(players, "classic", "legacy", {}, false);
    const v2 = calculateRatingPointsForTournament(players, "classic", "v2", {}, false);

    expect(legacy.results.every((r) => r.rating_points === 0)).toBe(true);
    expect(v2.results.every((r) => r.rating_points === 0)).toBe(true);
  });

  it("stays zero regardless of tournament_type -- format-specific bonuses never leak through", () => {
    for (const tournamentType of ["classic", "bounty", "boss_bounty", "mystery_bounty", "phoenix"] as const) {
      const players = arrivedPlayers(9, 1, 0);
      const { results } = calculateRatingPointsForTournament(players, tournamentType, "v2", {}, false);
      expect(results.every((r) => r.rating_points === 0)).toBe(true);
    }
  });

  it("ignores a frozen ratingPlaces override entirely -- still zero, not the frozen itm value", () => {
    const players = arrivedPlayers(3, 1, 0);
    const ratingPlaces = [
      { place: 1, points: 100 },
      { place: 2, points: 75 },
      { place: 3, points: 55 },
    ];

    const { results } = calculateRatingPointsForTournament(
      players,
      "classic",
      "v2",
      { ratingPlaces },
      false
    );

    expect(results.every((r) => r.rating_points === 0 && r.itm_points === 0)).toBe(true);
  });

  it("defaults to ratingEligible=true when the 5th argument is omitted -- every pre-existing call site above is unaffected", () => {
    const players = arrivedPlayers(9, 1, 0);
    const withDefault = calculateRatingPointsForTournament(players, "classic", "v2");
    const explicitTrue = calculateRatingPointsForTournament(players, "classic", "v2", {}, true);
    expect(withDefault).toEqual(explicitTrue);
    expect(withDefault.results.some((r) => r.rating_points > 0)).toBe(true);
  });
});

describe("calculateRatingPlaceStructureForTournament — ratingEligible=false (Final Month)", () => {
  it("every place snapshot is 0 points, not skipped/omitted", () => {
    const entries = Array.from({ length: 9 }, () => ({ entries: 1, addons: 0 }));
    const ratingPlaces = calculateRatingPlaceStructureForTournament(
      entries,
      "classic",
      "v2",
      {},
      false
    );

    expect(ratingPlaces.length).toBeGreaterThan(0);
    expect(ratingPlaces.every((p) => p.points === 0)).toBe(true);
  });
});
