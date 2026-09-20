// Shared club-wide ranked statistics (RELEASE C1) -- the ONE feature-layer
// entry point behind both the Rating -> Статистика tab
// (app/leaderboard/page.tsx) and achievement-detail "Лучшие результаты
// клуба" (app/players/[id]/achievements/page.tsx). Never a second query
// implementation per UI -- both read through getClubStatisticTop /
// getAchievementHolders below.
//
// The leaderboard is always based on the underlying metric, never on
// whether a player currently owns a specific achievement tier -- a player
// with 47 knockouts appears in the "knockouts" leaderboard even if the
// next Terminator threshold is 50, because this reads results.knockouts
// directly, not player_achievements.
import "server-only";

import { clubStatisticsRepository } from "@/lib/repositories";
import { getAllTimeLeaderboard } from "@/features/leaderboard";
import { CLUB_STATISTIC_METRIC, type ClubStatisticMetric } from "@/lib/club-statistics-metrics";

// Re-exported for existing server-side callers (e.g. the API route) that
// import the enum from here -- the canonical definition lives in
// lib/club-statistics-metrics.ts (client-safe, no "server-only"), see that
// file's doc comment for why.
export { CLUB_STATISTIC_METRIC, CLUB_STATISTIC_METRICS, type ClubStatisticMetric } from "@/lib/club-statistics-metrics";

export type ClubStatisticTopPlayer = {
  playerId: string;
  displayName: string;
  username: string | null;
  telegramAvatarUrl: string | null;
  customAvatarUrl: string | null;
  value: number;
  // Sequential rank (1-based) over the already-deterministically-ordered
  // rows -- same convention as getOfficialSeasonLeaderboard's officialRank
  // (features/leaderboard.ts), never a "shared rank on tie" scheme.
  rank: number;
};

const TOP_LIMIT = 10;

function toTopPlayers(
  rows: readonly {
    player_id: string;
    display_name: string;
    username: string | null;
    telegram_avatar_url: string | null;
    custom_avatar_url: string | null;
    value: number;
  }[]
): ClubStatisticTopPlayer[] {
  return rows.map((row, index) => ({
    playerId: row.player_id,
    displayName: row.display_name,
    username: row.username,
    telegramAvatarUrl: row.telegram_avatar_url,
    customAvatarUrl: row.custom_avatar_url,
    value: row.value,
    rank: index + 1,
  }));
}

// lifetime_rating reuses getAllTimeLeaderboard's exact SUM(rating_points)
// values -- no second interpretation of "all-time rating" is computed
// here. getAllTimeLeaderboard's own doc comment states equal-rating order
// is not guaranteed stable; a stable secondary sort by player_id is
// applied ONLY to break presentation ties deterministically, same
// convention as every other metric here -- the rating VALUES themselves
// are never altered.
async function getLifetimeRatingTop(): Promise<ClubStatisticTopPlayer[]> {
  const all = await getAllTimeLeaderboard();
  const sorted = [...all].sort((a, b) => b.rating - a.rating || a.player_id.localeCompare(b.player_id));

  return sorted.slice(0, TOP_LIMIT).map((entry, index) => ({
    playerId: entry.player_id,
    displayName: entry.display_name,
    username: entry.username,
    telegramAvatarUrl: entry.telegram_avatar_url,
    customAvatarUrl: entry.custom_avatar_url,
    value: entry.rating,
    rank: index + 1,
  }));
}

export async function getClubStatisticTop(metric: ClubStatisticMetric): Promise<ClubStatisticTopPlayer[]> {
  switch (metric) {
    case CLUB_STATISTIC_METRIC.TOURNAMENTS_PLAYED:
      return toTopPlayers(await clubStatisticsRepository.getTournamentsPlayedTop(TOP_LIMIT));
    case CLUB_STATISTIC_METRIC.WINS:
      return toTopPlayers(await clubStatisticsRepository.getWinsTop(TOP_LIMIT));
    case CLUB_STATISTIC_METRIC.ITM:
      return toTopPlayers(await clubStatisticsRepository.getItmTop(TOP_LIMIT));
    case CLUB_STATISTIC_METRIC.REFERRALS:
      return toTopPlayers(await clubStatisticsRepository.getReferralsTop(TOP_LIMIT));
    case CLUB_STATISTIC_METRIC.KNOCKOUTS:
      return toTopPlayers(await clubStatisticsRepository.getKnockoutsTop(TOP_LIMIT));
    case CLUB_STATISTIC_METRIC.BOSS_KNOCKOUTS:
      return toTopPlayers(await clubStatisticsRepository.getBossKnockoutsTop(TOP_LIMIT));
    case CLUB_STATISTIC_METRIC.HEADHUNTER:
      return toTopPlayers(await clubStatisticsRepository.getHeadhunterTop(TOP_LIMIT));
    case CLUB_STATISTIC_METRIC.LIFETIME_RATING:
      return getLifetimeRatingTop();
    default: {
      const exhaustiveCheck: never = metric;
      throw new Error(`Unknown club statistic metric: ${String(exhaustiveCheck)}`);
    }
  }
}

export type AchievementHolder = {
  playerId: string;
  displayName: string;
  username: string | null;
  telegramAvatarUrl: string | null;
  customAvatarUrl: string | null;
  completedAt: string;
};

const HOLDERS_LIMIT = 50;

// Simple "Обладатели" ownership list for a MANUAL/event-based achievement
// (Royal Flush, Number One) -- no ranking, no value, per this release's
// explicit scope (do not fabricate a ranked metric where none exists).
// Callers validate achievementCode against a fixed allowlist before
// calling this (see app/api/achievements/holders/route.ts) -- this
// function itself accepts any code and simply returns an empty list for
// one with no holders.
export async function getAchievementHolders(achievementCode: string): Promise<AchievementHolder[]> {
  const rows = await clubStatisticsRepository.getAchievementHolders(achievementCode, HOLDERS_LIMIT);
  return rows.map((row) => ({
    playerId: row.player_id,
    displayName: row.display_name,
    username: row.username,
    telegramAvatarUrl: row.telegram_avatar_url,
    customAvatarUrl: row.custom_avatar_url,
    completedAt: row.completed_at,
  }));
}
