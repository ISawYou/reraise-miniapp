export const LEADERBOARD_GRID_CLASS =
  "grid-cols-[36px_minmax(0,1fr)_64px] sm:grid-cols-[48px_minmax(0,1fr)_90px]";

export function getLeaderboardPlaceTone(place: number, isCurrentPlayer: boolean) {
  if (isCurrentPlayer) return "current";
  if (place === 1) return "gold";
  if (place === 2) return "silver";
  if (place === 3) return "bronze";
  if (place >= 4 && place <= 9) return "finalist";
  return "default";
}
