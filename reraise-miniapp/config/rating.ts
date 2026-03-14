export const RATING_POINTS = {
  firstPlace: 100,
  secondPlace: 70,
  thirdPlace: 50,
  participation: 20,
} as const;

export function getRatingPointsByPlace(place: number): number {
  if (place === 1) return RATING_POINTS.firstPlace;
  if (place === 2) return RATING_POINTS.secondPlace;
  if (place === 3) return RATING_POINTS.thirdPlace;
  return RATING_POINTS.participation;
}