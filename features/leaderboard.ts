import { resultRepository, seasonRatingExclusionRepository } from "@/lib/repositories";

export type LeaderboardEntry = {
  player_id: string;
  username: string | null;
  display_name: string;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
  rating: number;
};

export type OfficialLeaderboardEntry = LeaderboardEntry & { officialRank: number };

export type OfficialSeasonLeaderboard = {
  // Eligible players only, ranked 1..N -- what "ТОП-9" / Number One /
  // official standings mean. Excluded ("Вне зачёта") players never consume
  // a rank number here, even though their rating_points are unchanged.
  leaderboard: OfficialLeaderboardEntry[];
  // Excluded players, same descending rating order, but deliberately
  // WITHOUT an official rank -- "убрать из рейтинга, но не убрать
  // рейтинг": their points stay visible/transparent, just outside
  // qualification.
  outOfCompetition: LeaderboardEntry[];
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

// "Вне зачёта" applied ON TOP of the raw calculation above -- reuses
// getSeasonLeaderboard unchanged (one underlying accumulation, not a second
// rating formula) and only partitions the already-sorted result by
// season_rating_exclusions. This is the canonical entry point for anything
// that means "official season standing": the public leaderboard route AND
// season finalization (features/seasons.ts::closeSeason) both read from
// here, so TOP-9/Number One/pagination all agree on the exact same rule.
export async function getOfficialSeasonLeaderboard(seasonId: string): Promise<OfficialSeasonLeaderboard> {
  const [raw, exclusions] = await Promise.all([
    getSeasonLeaderboard(seasonId),
    seasonRatingExclusionRepository.listBySeasonId(seasonId),
  ]);

  const excludedPlayerIds = new Set(exclusions.map((row) => row.player_id));

  const leaderboard: OfficialLeaderboardEntry[] = [];
  const outOfCompetition: LeaderboardEntry[] = [];

  for (const entry of raw) {
    if (excludedPlayerIds.has(entry.player_id)) {
      outOfCompetition.push(entry);
    } else {
      leaderboard.push({ ...entry, officialRank: leaderboard.length + 1 });
    }
  }

  return { leaderboard, outOfCompetition };
}

// All-time: cumulative RAW rating_points across every completed result ever
// recorded, regardless of season. Deliberately NOT season-filtered and
// deliberately NOT aware of season_rating_exclusions -- "Вне зачёта" is a
// season-specific official-standings exclusion (features/leaderboard.ts's
// getOfficialSeasonLeaderboard doc comment), not a historical erasure. A
// player excluded from one season's official ranks keeps every point they
// earned in this total. No second rating formula: this sums the exact same
// frozen result.rating_points the season leaderboards already sum, just
// without a season_id filter.
export async function getAllTimeLeaderboard(): Promise<LeaderboardEntry[]> {
  const results = await resultRepository.findAllTimeWithPlayer();

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
