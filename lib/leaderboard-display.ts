import type { RankMovement } from "@/features/leaderboard";

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

// Podium slot order for the TOP-3 presentation: #2 left, #1 center
// (strongest emphasis), #3 right -- matches the reference layout. `null`
// for a missing slot (fewer than 3 ranked players) rather than throwing or
// reusing another player's card.
export function getPodiumOrder<T>(topThree: readonly T[]): [T | null, T | null, T | null] {
  return [topThree[1] ?? null, topThree[0] ?? null, topThree[2] ?? null];
}

// One canonical "where does this player stand" resolution, shared by the
// leaderboard screen (current/archive/all-time modes) and
// features/leaderboard.ts::getPlayerRatingSummary (profile) -- never
// re-derived independently. A player can be in exactly one of three
// states: officially ranked, "Вне зачёта" (excluded from official rank but
// keeps their points), or not present at all yet (0 points, no rank). For
// all-time mode (no OOC concept), callers simply pass an empty
// outOfCompetition array.
export type PlayerStanding = {
  rank: number | null;
  points: number;
  isOutOfCompetition: boolean;
};

// Archive mode's season selector -- the currently active season is
// "Текущий", never an archive option. Extracted as a pure function so the
// exclusion rule itself is testable without rendering the leaderboard page.
export function filterArchivableSeasons<T extends { isActive: boolean }>(seasons: readonly T[]): T[] {
  return seasons.filter((season) => !season.isActive);
}

export function resolvePlayerStanding(
  leaderboard: readonly { player_id: string; officialRank: number; rating: number }[],
  outOfCompetition: readonly { player_id: string; rating: number }[],
  playerId: string | null
): PlayerStanding {
  if (!playerId) {
    return { rank: null, points: 0, isOutOfCompetition: false };
  }

  const official = leaderboard.find((entry) => entry.player_id === playerId);
  if (official) {
    return { rank: official.officialRank, points: official.rating, isOutOfCompetition: false };
  }

  const excluded = outOfCompetition.find((entry) => entry.player_id === playerId);
  if (excluded) {
    // Never a fake rank -- "Вне зачёта" means excluded from official
    // standing, the points themselves are never hidden or zeroed.
    return { rank: null, points: excluded.rating, isOutOfCompetition: true };
  }

  return { rank: null, points: 0, isOutOfCompetition: false };
}

export type RankMovementDisplay = {
  label: string;
  tone: "up" | "down" | "same" | "new";
};

// Pure formatting only -- current-mode leaderboard rows/podium/"Ваша
// позиция" all call this on the SAME rankMovement value the API already
// computed (features/leaderboard.ts::getOfficialSeasonLeaderboardWithMovement),
// never recalculating it. `undefined`/`null` covers both "Вне зачёта" (no
// rankMovement field at all) and archive/all-time mode (never populated) --
// callers render nothing for those, not a fallback badge.
export function describeRankMovement(
  movement: RankMovement | null | undefined
): RankMovementDisplay | null {
  if (!movement) return null;

  switch (movement.type) {
    case "up":
      return { label: `↑${movement.places}`, tone: "up" };
    case "down":
      return { label: `↓${movement.places}`, tone: "down" };
    case "new":
      return { label: "NEW", tone: "new" };
    case "same":
    case "unavailable":
      // "unavailable" (an equal-rating tie makes the exact previous/current
      // sequential position ambiguous) renders identically to "same" -- a
      // neutral "—", never a fake ↑/↓ built on arbitrary tie order.
      return { label: "—", tone: "same" };
  }
}
