import type { RatingFormulaVersion, RatingPlace, TournamentType } from "@/types/domain";
import {
  calculateRatingPoints,
  getBasePlacePoints,
  getFieldCoefficient,
  PARTICIPATION_POINTS,
  type RatingPointsBreakdown,
} from "@/features/rating";
import {
  getExpectedPrizePlaces,
  supportsTournamentBossKnockouts,
  supportsTournamentKnockouts,
} from "@/lib/tournament-helpers";

// Rating Engine v2 -- pure, framework-free (no "use server", importable from
// both server route handlers and client components, same as features/rating.ts).
// Dispatched to only for tournaments with rating_formula_version = "v2";
// features/rating.ts (v1/"legacy") keeps its exact original rating_points
// arithmetic (see that file's calculateRatingPoints) and keeps producing
// historically-frozen results for every pre-existing tournament -- it now
// also returns the same total's frozen components (Rating Breakdown), but
// that is purely additive to what it already computed.
//
// Business rule confirmed explicitly: an add-on carries 2x the weight of a
// plain entry/rebuy in every volume/share calculation below (Weighted
// Volume, Extra Volume, Bounty/Boss Addon Share, and the Mystery Pool
// formula in lib/mystery-bounty.ts) -- not 1x.

export type PlayerRatingInputV2 = {
  player_id: string;
  place: number;
  knockouts: number;
  boss_knockouts?: number;
  mystery_bounty_points?: number;
  arrived: boolean;
  // Each player's TOTAL entries (initial entry + every rebuy) -- the same
  // admin-facing "Re-buy" field/convention already established for Mystery
  // Bounty (see lib/mystery-bounty.ts's totalEntriesCount doc comment). NOT
  // a rebuy-only count.
  entries: number;
  addons: number;
};

export type CalculateRatingPointsV2Options = {
  // Phoenix only. null/undefined = no guarantee, the natural pool applies
  // unchanged.
  ratingGuarantee?: number | null;
  // When Late Registration has already closed, this frozen placement
  // distribution replaces freshly-computed itm_points. Participation and
  // format-specific bounty components still come from this same engine.
  ratingPlaces?: readonly RatingPlace[];
};

export type RatingPointsV2Meta =
  | {
      kind: "volume";
      weightedVolume: number;
      extraVolume: number;
      volumeShare: number;
      volumeMultiplier: number;
    }
  | {
      kind: "addon_share";
      weightedVolume: number;
      addonShare: number;
      placementMultiplier: number;
    }
  | { kind: "mystery" }
  | {
      kind: "phoenix";
      weightedVolume: number;
      extraVolume: number;
      volumeShare: number;
      volumeMultiplier: number;
      naturalPool: number;
      guarantee: number | null;
      topUp: number;
      finalPool: number;
    };

// itm_points here is placement-only for every non-Phoenix format. For
// Phoenix specifically, when the Rating Guarantee triggers, its top-up is
// folded into itm_points too -- per the fixed product decision, the
// Guarantee is not a separate kind of points, only a mechanism for
// determining the rating-zone pool's final size, so its effect belongs
// wherever placement points already live. There is no separate
// phoenix_guarantee_points field, in the type or in the DB.
export type RatingPointsV2Result = {
  player_id: string;
  rating_points: number;
} & RatingPointsBreakdown;

// Explicit, language-independent round-half-up -- do not rely on Math.round
// (correct for our positive-only inputs, but the spec asks for a named
// helper rather than an implicit language behavior).
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export function computeWeightedVolume({
  totalEntries,
  addons,
}: {
  totalEntries: number;
  addons: number;
}): number {
  return totalEntries + 2 * addons;
}

export function computeExtraVolume({
  totalRebuys,
  addons,
}: {
  totalRebuys: number;
  addons: number;
}): number {
  return totalRebuys + 2 * addons;
}

export function computeVolumeMultiplier(volumeShare: number): number {
  return 1 + 1.25 * volumeShare;
}

export function computeAddonPlacementMultiplier(addonShare: number): number {
  return 1 + 1.25 * addonShare;
}

type PhoenixPlacementInput = {
  player_id: string;
  place: number;
  naturalPlacementPoints: number;
};

// Largest Remainder Method (spec §17): deterministic integer distribution of
// `topUp` proportional to each prize-zone player's NATURAL PLACEMENT points
// (participation is never part of this proportion, and is never itself
// modified -- spec §16). Tie-break on equal fractional remainder: the
// better (lower-numbered) finishing place wins the extra point.
export function distributePhoenixTopUp(
  placements: PhoenixPlacementInput[],
  topUp: number
): Map<string, number> {
  const result = new Map<string, number>();

  if (topUp <= 0 || placements.length === 0) {
    placements.forEach((p) => result.set(p.player_id, 0));
    return result;
  }

  const totalNatural = placements.reduce((sum, p) => sum + p.naturalPlacementPoints, 0);

  if (totalNatural <= 0) {
    // No positive placement points to distribute proportionally to --
    // shouldn't occur for a real triggered guarantee, but guard against
    // divide-by-zero rather than assume it can't happen.
    placements.forEach((p) => result.set(p.player_id, 0));
    return result;
  }

  const shares = placements.map((p) => {
    const exact = (p.naturalPlacementPoints / totalNatural) * topUp;
    const floor = Math.floor(exact);
    return {
      player_id: p.player_id,
      place: p.place,
      floor,
      remainder: exact - floor,
    };
  });

  const alreadyDistributed = shares.reduce((sum, s) => sum + s.floor, 0);
  let remaining = topUp - alreadyDistributed;

  const byRemainderDesc = [...shares].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.place - b.place; // better (lower) place wins ties
  });

  for (const share of byRemainderDesc) {
    if (remaining <= 0) break;
    share.floor += 1;
    remaining -= 1;
  }

  shares.forEach((s) => result.set(s.player_id, s.floor));
  return result;
}

const VOLUME_FORMATS = new Set<TournamentType>([
  "classic",
  "deep_stack",
  "win_the_button",
  "phoenix",
]);

export function calculateRatingPointsV2(
  players: PlayerRatingInputV2[],
  tournamentType: TournamentType,
  options: CalculateRatingPointsV2Options = {}
): { results: RatingPointsV2Result[]; meta: RatingPointsV2Meta } {
  const arrivedPlayers = players.filter((p) => p.arrived);
  const fieldSize = arrivedPlayers.length;
  const ratingZoneSize = getExpectedPrizePlaces(fieldSize);
  const fieldCoefficient = getFieldCoefficient(fieldSize);
  const hasKnockouts = supportsTournamentKnockouts(tournamentType);
  const hasBossKnockouts = supportsTournamentBossKnockouts(tournamentType);
  const isMystery = tournamentType === "mystery_bounty";
  const isKnockoutFormat = tournamentType === "bounty" || tournamentType === "boss_bounty";
  const isVolumeFormat = VOLUME_FORMATS.has(tournamentType);

  const totalEntries = arrivedPlayers.reduce((sum, p) => sum + Math.max(0, p.entries), 0);
  const totalAddons = arrivedPlayers.reduce((sum, p) => sum + Math.max(0, p.addons), 0);
  const totalRebuys = Math.max(0, totalEntries - fieldSize);

  const weightedVolume = computeWeightedVolume({ totalEntries, addons: totalAddons });
  const extraVolume = computeExtraVolume({ totalRebuys, addons: totalAddons });
  const volumeShare = weightedVolume > 0 ? extraVolume / weightedVolume : 0;
  const volumeMultiplier = computeVolumeMultiplier(volumeShare);

  // Rebuys are deliberately excluded here (spec §9) -- only the 2x-weighted
  // addon term contributes to Bounty/Boss Bounty's placement multiplier, so
  // an extra entry doesn't get counted twice (once via a knockout bonus,
  // once via a placement multiplier).
  const addonShare = weightedVolume > 0 ? (2 * totalAddons) / weightedVolume : 0;
  const placementMultiplier = computeAddonPlacementMultiplier(addonShare);

  function placementPointsFor(place: number): number {
    if (place > ratingZoneSize) {
      return 0;
    }

    const base = getBasePlacePoints(place);

    if (isVolumeFormat) {
      return roundHalfUp(base * fieldCoefficient * volumeMultiplier);
    }

    if (isKnockoutFormat) {
      return roundHalfUp(base * fieldCoefficient * placementMultiplier);
    }

    // mystery_bounty: no multiplier -- its volume is already captured by the
    // separate Mystery Pool (lib/mystery-bounty.ts), not by placement.
    return roundHalfUp(base * fieldCoefficient);
  }

  const naturalResults = players.map((player) => {
    if (!player.arrived) {
      return {
        player_id: player.player_id,
        natural: 0,
        naturalPlacement: 0,
        participation_points: 0,
        knockout_points: 0,
        boss_bounty_points: 0,
        mystery_bounty_points: 0,
        itm_points: 0,
      };
    }

    const placement = placementPointsFor(player.place);
    const knockoutPoints = hasKnockouts ? player.knockouts * 5 : 0;
    const bossKnockoutPoints = hasBossKnockouts ? (player.boss_knockouts ?? 0) * 10 : 0;
    const mysteryPoints = isMystery ? player.mystery_bounty_points ?? 0 : 0;
    const participationPoints = PARTICIPATION_POINTS;

    // Participation +2 stays flat/unmultiplied for every format, exactly
    // like v1 (spec §19).
    const natural = placement + knockoutPoints + bossKnockoutPoints + participationPoints + mysteryPoints;
    return {
      player_id: player.player_id,
      natural,
      naturalPlacement: placement,
      participation_points: participationPoints,
      knockout_points: knockoutPoints,
      boss_bounty_points: bossKnockoutPoints,
      mystery_bounty_points: mysteryPoints,
      // Pre-Phoenix-topUp value. For Phoenix specifically this gets the
      // Guarantee top-up folded in below when it triggers; every other
      // format returns this as-is.
      itm_points: placement,
    };
  });

  if (tournamentType !== "phoenix") {
    const meta: RatingPointsV2Meta = isMystery
      ? { kind: "mystery" }
      : isKnockoutFormat
        ? { kind: "addon_share", weightedVolume, addonShare, placementMultiplier }
        : { kind: "volume", weightedVolume, extraVolume, volumeShare, volumeMultiplier };

    return {
      results: naturalResults.map((r) => ({
        player_id: r.player_id,
        rating_points: r.natural,
        participation_points: r.participation_points,
        knockout_points: r.knockout_points,
        boss_bounty_points: r.boss_bounty_points,
        mystery_bounty_points: r.mystery_bounty_points,
        itm_points: r.itm_points,
      })),
      meta,
    };
  }

  // Phoenix: apply the Rating Guarantee top-up on top of the natural
  // (volume-multiplier) pool computed above.
  const naturalPool = naturalResults.reduce((sum, r) => sum + r.natural, 0);
  const guarantee = options.ratingGuarantee ?? null;
  const triggered = guarantee != null && naturalPool < guarantee;
  const topUp = triggered ? guarantee - naturalPool : 0;

  let finalResults = naturalResults;

  if (triggered) {
    const prizeZonePlacements: PhoenixPlacementInput[] = players
      .filter((p) => p.arrived && p.place <= ratingZoneSize)
      .map((p) => {
        const natural = naturalResults.find((r) => r.player_id === p.player_id);
        return {
          player_id: p.player_id,
          place: p.place,
          naturalPlacementPoints: natural?.naturalPlacement ?? 0,
        };
      });

    const topUpMap = distributePhoenixTopUp(prizeZonePlacements, topUp);

    finalResults = naturalResults.map((r) => {
      const share = topUpMap.get(r.player_id) ?? 0;
      return {
        ...r,
        natural: r.natural + share,
        // Guarantee top-up only ever reaches prize-zone (arrived,
        // place <= ratingZoneSize) rows -- distributePhoenixTopUp is called
        // with exactly that filtered list above -- so folding it into
        // itm_points here can never turn a non-ITM/non-arrived row's
        // itm_points positive.
        itm_points: r.itm_points + share,
      };
    });
  }

  const finalPool = finalResults.reduce((sum, r) => sum + r.natural, 0);

  return {
    results: finalResults.map((r) => ({
      player_id: r.player_id,
      rating_points: r.natural,
      participation_points: r.participation_points,
      knockout_points: r.knockout_points,
      boss_bounty_points: r.boss_bounty_points,
      mystery_bounty_points: r.mystery_bounty_points,
      itm_points: r.itm_points,
    })),
    meta: {
      kind: "phoenix",
      weightedVolume,
      extraVolume,
      volumeShare,
      volumeMultiplier,
      naturalPool,
      guarantee,
      topUp,
      finalPool,
    },
  };
}

// Single dispatch point shared by every call site that completes a
// tournament (app/api/admin/tournaments/[id]/complete-free/route.ts and
// features/tournaments.ts::completeTournamentFromLiveEntries) -- keeps the
// legacy/v2 branch in exactly one place rather than duplicated per call
// site (spec §25's "единый rating engine").
//
// `ratingEligible` (default true, so every pre-existing caller keeps
// behaving exactly as before): pass
// lib/tournament-helpers.ts::isRatingEligibleTournament(tournament) here at
// every call site. false short-circuits BEFORE the legacy/v2 branch or the
// frozen-itm-points override below even run -- a Final Month championship
// (tournament.is_final) gets a flat zero for every component
// (participation/knockout/boss/mystery/itm/total), regardless of
// tournament_type or rating_formula_version, never partially zeroed.
export function calculateRatingPointsForTournament(
  players: PlayerRatingInputV2[],
  tournamentType: TournamentType,
  ratingFormulaVersion: RatingFormulaVersion,
  options: CalculateRatingPointsV2Options = {},
  ratingEligible = true
): { results: RatingPointsV2Result[]; meta: RatingPointsV2Meta | null } {
  if (!ratingEligible) {
    return {
      results: players.map((player) => ({
        player_id: player.player_id,
        rating_points: 0,
        participation_points: 0,
        knockout_points: 0,
        boss_bounty_points: 0,
        mystery_bounty_points: 0,
        itm_points: 0,
      })),
      meta: null,
    };
  }

  let calculated: { results: RatingPointsV2Result[]; meta: RatingPointsV2Meta | null };

  if (ratingFormulaVersion === "legacy") {
    // features/rating.ts::calculateRatingPoints -- its `rating_points`
    // arithmetic is untouched (same operations, same operands, same order);
    // the only change since Rating Breakdown was added is that it also
    // returns the components that arithmetic is built from, alongside the
    // total. features/__tests__/rating.test.ts's pre-existing golden values
    // and features/__tests__/rating-breakdown.test.ts both assert the
    // returned `rating_points` is numerically identical to before.
    const results = calculateRatingPoints(
      players.map((p) => ({
        player_id: p.player_id,
        place: p.place,
        knockouts: p.knockouts,
        boss_knockouts: p.boss_knockouts,
        mystery_bounty_points: p.mystery_bounty_points,
        arrived: p.arrived,
      })),
      tournamentType
    );
    calculated = { results, meta: null };
  } else {
    calculated = calculateRatingPointsV2(players, tournamentType, options);
  }

  if (!options.ratingPlaces) {
    return calculated;
  }

  const pointsByPlace = new Map(options.ratingPlaces.map((item) => [item.place, item.points]));
  return {
    ...calculated,
    results: calculated.results.map((result, index) => {
      const player = players[index];
      const frozenItmPoints = player?.arrived ? pointsByPlace.get(player.place) ?? 0 : 0;

      return {
        ...result,
        itm_points: frozenItmPoints,
        rating_points:
          result.participation_points +
          result.knockout_points +
          result.boss_bounty_points +
          result.mystery_bounty_points +
          frozenItmPoints,
      };
    }),
  };
}

// Builds the points-per-place structure by feeding synthetic finishers into
// the exact same dispatcher completion uses. Player identity and final
// places are irrelevant at Late Registration close; only authoritative
// field/entry/add-on aggregates and tournament formula settings matter.
// `ratingEligible` (see calculateRatingPointsForTournament above) -- a
// Final Month's frozen rating_places snapshot is every place at 0 points,
// not skipped/omitted, so anything reading the snapshot later sees a real
// zero rather than having to know to ignore it.
export function calculateRatingPlaceStructureForTournament(
  entries: Array<{ entries: number; addons: number }>,
  tournamentType: TournamentType,
  ratingFormulaVersion: RatingFormulaVersion,
  options: CalculateRatingPointsV2Options = {},
  ratingEligible = true
): RatingPlace[] {
  const players: PlayerRatingInputV2[] = entries.map((entry, index) => ({
    player_id: `rating-place-${index + 1}`,
    place: index + 1,
    knockouts: 0,
    boss_knockouts: 0,
    mystery_bounty_points: 0,
    arrived: true,
    entries: entry.entries,
    addons: entry.addons,
  }));
  const { results } = calculateRatingPointsForTournament(
    players,
    tournamentType,
    ratingFormulaVersion,
    { ratingGuarantee: options.ratingGuarantee },
    ratingEligible
  );
  const ratingPlacesCount = getExpectedPrizePlaces(players.length);

  return results.slice(0, ratingPlacesCount).map((result, index) => ({
    place: index + 1,
    points: result.itm_points,
  }));
}
