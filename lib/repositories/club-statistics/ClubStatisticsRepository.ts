// Data-access boundary for club-wide ranked statistics (RELEASE C1) — the
// ONE shared query layer behind both the Rating -> Статистика tab and
// achievement-detail "Лучшие результаты клуба" leaderboards, per this
// release's explicit "do not duplicate SQL/query logic separately for the
// two UIs" requirement. Postgres-only, same scoping decision as Dealer
// Payroll / Admin Shifts (see lib/repositories/dealer/index.ts) — this is
// read-only aggregation over `results`/`players`/`player_achievements`,
// never a write path, so there is no Supabase parity obligation.
//
// Deliberately does NOT cover lifetime_rating: that metric is served by
// features/club-statistics.ts calling features/leaderboard.ts's existing
// getAllTimeLeaderboard() directly — reusing its exact SUM(rating_points)
// semantics rather than a second interpretation computed here.
export type ClubStatisticRow = {
  player_id: string;
  username: string | null;
  display_name: string;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
  value: number;
};

export type AchievementHolderRow = {
  player_id: string;
  username: string | null;
  display_name: string;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
  completed_at: string;
};

export interface ClubStatisticsRepository {
  // count(*) of results rows per player.
  getTournamentsPlayedTop(limit: number): Promise<ClubStatisticRow[]>;
  // count(*) WHERE place = 1.
  getWinsTop(limit: number): Promise<ClubStatisticRow[]>;
  // count(*) WHERE itm_points > 0 -- same "ITM" definition as
  // ResultRepository.countItmFinishesByPlayerId (itm_points = 0 and NULL
  // both correctly fall outside "> 0").
  getItmTop(limit: number): Promise<ClubStatisticRow[]>;
  // players.referral_count directly -- no join with results at all.
  getReferralsTop(limit: number): Promise<ClubStatisticRow[]>;
  // SUM(knockouts) -- ordinary knockouts only, never boss knockouts.
  getKnockoutsTop(limit: number): Promise<ClubStatisticRow[]>;
  // SUM(boss_knockouts) -- separate, non-overlapping counter from ordinary
  // knockouts (same distinction the Achievement Engine already enforces).
  getBossKnockoutsTop(limit: number): Promise<ClubStatisticRow[]>;
  // MAX(knockouts) per player across their results rows -- best single-
  // tournament knockout count ("Headhunter"), NOT a cumulative sum.
  getHeadhunterTop(limit: number): Promise<ClubStatisticRow[]>;
  // Simple ownership list ("Обладатели") for a MANUAL/event-based
  // achievement code (Royal Flush, Number One) -- earned holders only
  // (completed_at IS NOT NULL), ordered by earliest completion first. No
  // ranking/value, per this release's explicit "do not fabricate a ranked
  // metric for these" scope.
  getAchievementHolders(achievementCode: string, limit: number): Promise<AchievementHolderRow[]>;
}
