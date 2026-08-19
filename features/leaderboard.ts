import { resultRepository } from "@/lib/repositories";

export type LeaderboardEntry = {
  player_id: string;
  username: string | null;
  display_name: string;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
  rating: number;
};

// Canonical leaderboard calculation for one season -- the single source of
// truth both app/api/leaderboard/route.ts (current/active season display)
// and features/seasons.ts::closeSeason (permanent Number One grant) read
// from. Extracted from the route unchanged (byte-identical SUM(rating_points)
// GROUP BY player_id, sorted descending) -- not a second formula, and the
// rating formula itself (Rating Engine v1/v2) is untouched.
//
// No deterministic tie-breaker for equal `rating` totals: neither
// PostgresResultRepository nor SupabaseResultRepository's
// findWithPlayerBySeasonId orders its rows, so the position of tied players
// in the returned array is not guaranteed stable across calls. Harmless for
// display (leaderboard.tsx just renders a list), but callers that need to
// pick a single winner (season finalization) MUST detect a tie at the rank
// that matters and refuse to guess -- see closeSeason.
export async function getSeasonLeaderboard(seasonId: string): Promise<LeaderboardEntry[]> {
  const results = await resultRepository.findWithPlayerBySeasonId(seasonId);

  const leaderboardMap = new Map<string, LeaderboardEntry>();

  for (const row of results) {
    const existing = leaderboardMap.get(row.player_id);
    if (existing) {
      existing.rating += row.rating_points ?? 0;
    } else {
      leaderboardMap.set(row.player_id, {
        player_id: row.player_id,
        username: row.username,
        display_name: row.display_name,
        telegram_avatar_url: row.telegram_avatar_url,
        custom_avatar_url: row.custom_avatar_url,
        rating: row.rating_points ?? 0,
      });
    }
  }

  return Array.from(leaderboardMap.values()).sort((a, b) => b.rating - a.rating);
}
