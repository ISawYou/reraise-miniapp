// Club-wide ranked statistics metric enum (RELEASE C1) -- deliberately NOT
// in features/club-statistics.ts (which is "server-only") so both server
// code (the API route, the feature layer) and client components (the
// Rating -> Статистика tab, achievement-detail leaderboards) can import
// this same enum without pulling server-only DB access into a client
// bundle.
//
// Streak and Bubble Boy are intentionally excluded from this release (see
// C1 scope) -- both require a batch computation over each player's full
// chronological tournament history, not a single GROUP BY, and are left
// for a follow-up release.
export const CLUB_STATISTIC_METRIC = {
  TOURNAMENTS_PLAYED: "tournaments_played",
  WINS: "wins",
  LIFETIME_RATING: "lifetime_rating",
  ITM: "itm",
  REFERRALS: "referrals",
  KNOCKOUTS: "knockouts",
  BOSS_KNOCKOUTS: "boss_knockouts",
  HEADHUNTER: "headhunter",
} as const;
export type ClubStatisticMetric = (typeof CLUB_STATISTIC_METRIC)[keyof typeof CLUB_STATISTIC_METRIC];

export const CLUB_STATISTIC_METRICS: readonly ClubStatisticMetric[] = Object.values(CLUB_STATISTIC_METRIC);
