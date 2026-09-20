import type { AchievementFamily } from "@/config/achievements";
import { CLUB_STATISTIC_METRIC, type ClubStatisticMetric } from "@/lib/club-statistics-metrics";

// RELEASE C1: which club-statistics metric backs each achievement family's
// "Лучшие результаты клуба" leaderboard -- the underlying metric, NOT
// whether a player currently owns a tier (a player with 47 knockouts
// appears in the "knockouts" leaderboard even if the next Terminator
// threshold is 50, since features/club-statistics.ts reads
// results.knockouts directly, never player_achievements). Streak is
// intentionally absent -- out of C1 scope.
export const FAMILY_METRIC: Partial<Record<AchievementFamily, ClubStatisticMetric>> = {
  in_game: CLUB_STATISTIC_METRIC.TOURNAMENTS_PLAYED,
  triumphator: CLUB_STATISTIC_METRIC.WINS,
  player_path: CLUB_STATISTIC_METRIC.LIFETIME_RATING,
  itm: CLUB_STATISTIC_METRIC.ITM,
  community: CLUB_STATISTIC_METRIC.REFERRALS,
  terminator: CLUB_STATISTIC_METRIC.KNOCKOUTS,
  boss_hunter: CLUB_STATISTIC_METRIC.BOSS_KNOCKOUTS,
};

// Legendary codes with a ranked metric (Headhunter). Bubble Boy
// (marco_reus) is intentionally absent -- deferred to a follow-up release,
// same as Streak.
export const LEGENDARY_METRIC: Partial<Record<string, ClubStatisticMetric>> = {
  headhunter: CLUB_STATISTIC_METRIC.HEADHUNTER,
};

// MANUAL/event-based achievements with no underlying metric at all -- a
// simple "Обладатели" ownership list, never a fabricated ranking.
export const HOLDERS_ONLY_CODES = new Set(["royal_flush", "number_one"]);
