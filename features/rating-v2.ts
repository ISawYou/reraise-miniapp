import type { RatingFormulaVersion, TournamentType } from "@/types/domain";
import { calculateRatingPoints, getBasePlacePoints, getFieldCoefficient } from "@/features/rating";
import {
  getExpectedPrizePlaces,
  supportsTournamentBossKnockouts,
  supportsTournamentKnockouts,
} from "@/lib/tournament-helpers";

// Rating Engine v2 -- pure, framework-free (no "use server", importable from
// both server route handlers and client components, same as features/rating.ts).
// Dispatched to only for tournaments with rating_formula_version = "v2";
// features/rating.ts (v1/"legacy") stays byte-for-byte unchanged and keeps
// producing historically-frozen results for every pre-existing tournament.
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

export type RatingPointsV2Result = {
  player_id: string;
  rating_points: number;
};

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
      return { player_id: player.player_id, natural: 0, naturalPlacement: 0 };
    }

    const placement = placementPointsFor(player.place);
    const knockoutPoints = hasKnockouts ? player.knockouts * 5 : 0;
    const bossKnockoutPoints = hasBossKnockouts ? (player.boss_knockouts ?? 0) * 10 : 0;
    const mysteryPoints = isMystery ? player.mystery_bounty_points ?? 0 : 0;

    // Participation +2 stays flat/unmultiplied for every format, exactly
    // like v1 (spec §19).
    const natural = placement + knockoutPoints + bossKnockoutPoints + 2 + mysteryPoints;
    return { player_id: player.player_id, natural, naturalPlacement: placement };
  });

  if (tournamentType !== "phoenix") {
    const meta: RatingPointsV2Meta = isMystery
      ? { kind: "mystery" }
      : isKnockoutFormat
        ? { kind: "addon_share", weightedVolume, addonShare, placementMultiplier }
        : { kind: "volume", weightedVolume, extraVolume, volumeShare, volumeMultiplier };

    return {
      results: naturalResults.map((r) => ({ player_id: r.player_id, rating_points: r.natural })),
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

    finalResults = naturalResults.map((r) => ({
      ...r,
      natural: r.natural + (topUpMap.get(r.player_id) ?? 0),
    }));
  }

  const finalPool = finalResults.reduce((sum, r) => sum + r.natural, 0);

  return {
    results: finalResults.map((r) => ({ player_id: r.player_id, rating_points: r.natural })),
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
export function calculateRatingPointsForTournament(
  players: PlayerRatingInputV2[],
  tournamentType: TournamentType,
  ratingFormulaVersion: RatingFormulaVersion,
  options: CalculateRatingPointsV2Options = {}
): { results: RatingPointsV2Result[]; meta: RatingPointsV2Meta | null } {
  if (ratingFormulaVersion === "legacy") {
    // features/rating.ts::calculateRatingPoints -- UNTOUCHED, byte-for-byte
    // identical to every historical tournament's original scoring.
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
    return { results, meta: null };
  }

  return calculateRatingPointsV2(players, tournamentType, options);
}
