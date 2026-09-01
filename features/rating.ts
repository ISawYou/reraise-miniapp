import type { TournamentType } from "@/types/domain";
import {
  getExpectedPrizePlaces,
  getTournamentTypeMultiplier,
  supportsTournamentBossKnockouts,
  supportsTournamentKnockouts,
} from "@/lib/tournament-helpers";

export type PlayerRatingInput = {
  player_id: string;
  place: number;
  knockouts: number;
  boss_knockouts?: number;
  // Mystery Bounty: sum of physical envelope values a player drew. Added
  // on top of the existing formula unconditionally — for every other
  // tournament type this is always undefined/0, so the formula's output
  // for classic/phoenix/bounty/boss_bounty/etc. is byte-for-byte unchanged.
  mystery_bounty_points?: number;
  arrived: boolean;
};

// Frozen components of rating_points (results.participation_points /
// knockout_points / boss_bounty_points / mystery_bounty_points / itm_points
// — see lib/db/schema/results.ts). Shared by v1 (below) and v2
// (features/rating-v2.ts) so there is exactly one definition of what each
// component means, and both formulas are checked against the same shape.
//
// Invariant every caller can rely on:
//   rating_points === participation_points + knockout_points
//     + boss_bounty_points + mystery_bounty_points + itm_points
// enforced at the DB layer by results_rating_points_breakdown_check, and by
// construction here: `rating_points` below is computed as the sum of these
// same five values, not a separately-derived number.
export type RatingPointsBreakdown = {
  participation_points: number;
  knockout_points: number;
  boss_bounty_points: number;
  mystery_bounty_points: number;
  itm_points: number;
};

const BASE_PLACE_POINTS: Record<number, number> = {
  1: 100,
  2: 75,
  3: 55,
  4: 40,
  5: 30,
  6: 24,
  7: 19,
  8: 15,
  9: 12,
  10: 10,
  11: 8,
  12: 6,
};

// Exported (in addition to being used locally below) so features/rating-v2.ts
// can reuse the exact same base-place table and field-coefficient buckets
// instead of duplicating them -- purely additive, zero behavior change to
// calculateRatingPoints() itself.
export function getBasePlacePoints(place: number): number {
  return BASE_PLACE_POINTS[place] ?? 5;
}

// Canonical +2 participation points -- flat, unmultiplied, for every
// arrived player. Matches the literal `2` calculateRatingPoints (v1/legacy,
// below) has always used -- that historical function is intentionally left
// byte-for-byte untouched, so this constant is not wired into it. Exported
// so features/rating-v2.ts::calculateRatingPointsV2 (the current engine)
// and the live ReRaise->Poker Clock integration (see
// features/late-registration.ts::getTournamentStateForIntegration) share
// one named definition instead of each hardcoding the literal.
export const PARTICIPATION_POINTS = 2;

export function getFieldCoefficient(fieldSize: number): number {
  if (fieldSize <= 7) return 0.7;
  if (fieldSize <= 11) return 0.85;
  if (fieldSize <= 15) return 1.0;
  if (fieldSize <= 19) return 1.1;
  if (fieldSize <= 24) return 1.2;
  if (fieldSize <= 29) return 1.3;
  if (fieldSize <= 35) return 1.4;
  return 1.5;
}

export function calculateRatingPoints(
  players: PlayerRatingInput[],
  tournamentType: TournamentType
): Array<{ player_id: string; rating_points: number } & RatingPointsBreakdown> {
  const fieldSize = players.filter((p) => p.arrived).length;
  const ratingZoneSize = getExpectedPrizePlaces(fieldSize);
  const fieldCoefficient = getFieldCoefficient(fieldSize);
  const tournamentMultiplier = getTournamentTypeMultiplier(tournamentType);
  const hasKnockouts = supportsTournamentKnockouts(tournamentType);

  return players.map((player) => {
    if (!player.arrived) {
      return {
        player_id: player.player_id,
        rating_points: 0,
        participation_points: 0,
        knockout_points: 0,
        boss_bounty_points: 0,
        mystery_bounty_points: 0,
        itm_points: 0,
      };
    }

    const basePlacePoints =
      player.place <= ratingZoneSize ? getBasePlacePoints(player.place) : 0;
    const knockoutPoints = hasKnockouts ? player.knockouts * 5 : 0;
    const bossKnockoutPoints = supportsTournamentBossKnockouts(tournamentType)
      ? (player.boss_knockouts ?? 0) * 10
      : 0;
    // Renamed from the original `placePoints` local -- same expression,
    // same value, now returned as the ITM component instead of only being
    // folded into the total inline.
    const itmPoints =
      basePlacePoints > 0
        ? Math.round(basePlacePoints * fieldCoefficient * tournamentMultiplier)
        : 0;
    const participationPoints = 2;
    const mysteryBountyPoints = player.mystery_bounty_points ?? 0;

    return {
      player_id: player.player_id,
      // Same sum as before, just built from the now-named components below
      // instead of inline literals -- addition is commutative/associative
      // over integers, so this produces the identical rating_points value.
      rating_points:
        participationPoints + knockoutPoints + bossKnockoutPoints + mysteryBountyPoints + itmPoints,
      participation_points: participationPoints,
      knockout_points: knockoutPoints,
      boss_bounty_points: bossKnockoutPoints,
      mystery_bounty_points: mysteryBountyPoints,
      itm_points: itmPoints,
    };
  });
}
