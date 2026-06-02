export type PlayerRatingInput = {
  player_id: string;
  place: number;
  knockouts: number;
  arrived: boolean;
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

function getBasePlacePoints(place: number): number {
  return BASE_PLACE_POINTS[place] ?? 5;
}

function getFieldCoefficient(fieldSize: number): number {
  if (fieldSize <= 9) return 0.8;
  if (fieldSize <= 13) return 0.9;
  if (fieldSize <= 17) return 1.0;
  if (fieldSize <= 21) return 1.1;
  if (fieldSize <= 25) return 1.2;
  if (fieldSize <= 29) return 1.3;
  if (fieldSize <= 35) return 1.4;
  return 1.5;
}

export function calculateRatingPoints(
  players: PlayerRatingInput[],
  hasKnockouts: boolean
): Array<{ player_id: string; rating_points: number }> {
  const fieldSize = players.filter((p) => p.arrived).length;
  const ratingZoneSize = Math.max(3, Math.ceil(fieldSize * 0.3));
  const coefficient = getFieldCoefficient(fieldSize);

  return players.map((player) => {
    if (!player.arrived) {
      return { player_id: player.player_id, rating_points: 0 };
    }

    const basePlacePoints =
      player.place <= ratingZoneSize ? getBasePlacePoints(player.place) : 0;
    const knockoutPoints = hasKnockouts ? player.knockouts * 5 : 0;

    return {
      player_id: player.player_id,
      rating_points: Math.round(basePlacePoints * coefficient) + knockoutPoints + 2,
    };
  });
}
