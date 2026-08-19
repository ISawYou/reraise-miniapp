// Single source of truth for the achievement system. Both the backend
// (features/achievements.ts, lib/achievement-engine) and the frontend
// (achievement UI components) import from here — nothing about an
// achievement (name, description, icon, target) should be declared a
// second time anywhere else.
//
// Style note: this file follows the project's existing convention for
// closed sets of string values — plain string-literal union types (see
// types/domain.ts's RegistrationStatus, TournamentKind, TournamentType) —
// plus a matching `as const` object of named constants so call sites never
// have to retype the literal by hand. No real TypeScript `enum` is used
// anywhere in this codebase, and this file doesn't introduce one either.

// "automatic" achievements are recalculated by syncPlayerAchievements from
// player stats. "manual" is for achievements a human (admin) grants
// directly, through features/achievements.ts's grantManualAchievement /
// revokeManualAchievement path — see app/api/admin/achievements/manual.
//
// IMPORTANT: `type` (automatic/manual) is an independent axis from
// `category` (see ACHIEVEMENT_CATEGORY below) — LEGENDARY does NOT imply
// MANUAL. Royal Flush is category=LEGENDARY + type=MANUAL; Headhunter,
// Number One and Marco Reus are category=LEGENDARY + type=AUTOMATIC. Both
// axes are read independently everywhere (ManualEvaluator.supports() and
// the admin moderation guard in features/achievements.ts both check
// `type` only, never `category`).
export const ACHIEVEMENT_TYPE = {
  AUTOMATIC: "automatic",
  MANUAL: "manual",
} as const;
export type AchievementType = (typeof ACHIEVEMENT_TYPE)[keyof typeof ACHIEVEMENT_TYPE];

// The raw player stats the Achievement Engine currently knows how to
// compute. Every automatic achievement's progress is a single one of
// these, capped at `target`. Adding a metric here requires a matching case
// in features/achievements.ts's stats collector and an evaluator that
// reads it (see lib/achievement-engine/evaluators/).
export const ACHIEVEMENT_METRIC = {
  TOURNAMENTS_PLAYED: "tournaments_played",
  TOURNAMENTS_WON: "tournaments_won",
  RATING_POINTS: "rating_points",
  // Ordinary knockouts only (results.knockouts) — the "Terminator"
  // progression. Boss knockouts are a separate, non-overlapping metric
  // (BOSS_KNOCKOUTS below), never summed together.
  KNOCKOUTS: "knockouts",
  ITM_FINISHES: "itm_finishes",
  REFERRALS: "referrals",
  // "Boss Hunter" progression — cumulative lifetime results.boss_knockouts.
  BOSS_KNOCKOUTS: "boss_knockouts",
  // "Headhunter" — NOT cumulative. Max ORDINARY knockouts in a single
  // tournament/result (see features/achievements.ts). Boss knockouts and
  // Mystery Bounty never count here.
  MAX_KNOCKOUTS_SINGLE_TOURNAMENT: "max_knockouts_single_tournament",
  // "Tournament Streak" — longest run of consecutive completed club
  // tournaments a player attended (results.arrived = true), NOT calendar
  // weeks. Max, not current — an already-reached streak is never lost
  // after a later miss. See lib/tournament-streak.ts.
  MAX_TOURNAMENT_STREAK: "max_tournament_streak",
  // "Marco Reus" — lifetime count of times a player finished exactly one
  // place after a tournament's rating zone (the "bubble"). Rating zone
  // size = getExpectedPrizePlaces(arrived field size of that tournament)
  // — the same canonical function Rating Engine v1/v2 both already use,
  // not a second formula. See features/achievements.ts /
  // ResultRepository.findArrivedPlacementsByPlayerId.
  BUBBLE_COUNT: "bubble_count",
} as const;
export type AchievementMetric = (typeof ACHIEVEMENT_METRIC)[keyof typeof ACHIEVEMENT_METRIC];

// Purely descriptive grouping, not read by any evaluator or the UI today.
// Reserved for when the achievements page (or a future admin view) wants to
// group cards by category.
export const ACHIEVEMENT_CATEGORY = {
  PARTICIPATION: "participation",
  COMPETITION: "competition",
  RATING: "rating",
  KNOCKOUTS: "knockouts",
  ITM: "itm",
  REFERRAL: "referral",
  ATTENDANCE: "attendance",
  LEGENDARY: "legendary",
} as const;
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORY)[keyof typeof ACHIEVEMENT_CATEGORY];

// Where the underlying metric is computed from. Purely descriptive today.
// RESULTS is kept for the two pre-existing rating achievements exactly as
// they were before this catalog fill-in; every newly-added achievement
// uses AUTOMATIC/MANUAL to mirror its `type`.
export const ACHIEVEMENT_SOURCE = {
  RESULTS: "results",
  AUTOMATIC: "automatic",
  MANUAL: "manual",
} as const;
export type AchievementSource = (typeof ACHIEVEMENT_SOURCE)[keyof typeof ACHIEVEMENT_SOURCE];

// Icon keys the catalog may reference. The catalog stores only the key (no
// JSX, so it stays importable from server code); components/achievements/
// achievement-icons.tsx resolves each key to its rendered SVG through a
// Record<AchievementIconKey, ReactNode> — which makes that mapping
// exhaustive: adding a key here without wiring its icon there is a compile
// error, not a silently-blank icon.
export const ACHIEVEMENT_ICON = {
  PLAY: "play",
  STACK: "stack",
  TROPHY: "trophy",
  USER: "user",
  AWARD: "award",
} as const;
export type AchievementIconKey = (typeof ACHIEVEMENT_ICON)[keyof typeof ACHIEVEMENT_ICON];

// Product tier metadata for progression families (Terminator, Boss Hunter,
// Tournament Streak — see ACHIEVEMENT_FAMILY below). Deliberately NOT a
// player_achievements column or a DB migration: each threshold stays its
// own achievement_code/row exactly as before (e.g. Terminator's 4 tiers
// are still ten_knockouts/fifty_knockouts/hundred_knockouts/
// two_hundred_fifty_knockouts, unchanged codes). `tier` is pure display
// metadata on the catalog definition, letting a future UI show "Bronze /
// Silver / Gold / Platinum" without any backend/schema change. Deliberate
// first-version decision, not an oversight.
export const ACHIEVEMENT_TIER = {
  BRONZE: "bronze",
  SILVER: "silver",
  GOLD: "gold",
  PLATINUM: "platinum",
} as const;
export type AchievementTierLevel = (typeof ACHIEVEMENT_TIER)[keyof typeof ACHIEVEMENT_TIER];

// Groups the per-threshold achievement codes of one progression together
// (e.g. every Terminator tier shares family: ACHIEVEMENT_FAMILY.TERMINATOR)
// so a future UI can render them as one card with 4 tiers instead of 4
// separate cards. Purely descriptive, like `category` — no evaluator reads
// it; `metric` alone already determines which evaluator owns a definition.
export const ACHIEVEMENT_FAMILY = {
  TERMINATOR: "terminator",
  BOSS_HUNTER: "boss_hunter",
  TOURNAMENT_STREAK: "tournament_streak",
} as const;
export type AchievementFamily = (typeof ACHIEVEMENT_FAMILY)[keyof typeof ACHIEVEMENT_FAMILY];

// Reserved for a future reward system (e.g. cosmetic unlocks, bonus
// re-entries). Not read by any code yet.
export type AchievementReward = {
  kind: string;
  value?: unknown;
};

export type AchievementDefinition = {
  id: string;
  code: string;
  name: string;
  description: string;
  category: AchievementCategory;
  icon: AchievementIconKey;
  type: AchievementType;
  source: AchievementSource;
  // Optional because Legendary manual achievements (Royal Flush) have
  // neither — they are granted directly, not computed against a
  // metric/threshold. Every "automatic" achievement below still sets both.
  metric?: AchievementMetric;
  target?: number;
  // Progression-family display metadata — see ACHIEVEMENT_TIER /
  // ACHIEVEMENT_FAMILY above. Optional: single-tier achievements (ITM,
  // Headhunter, Royal Flush, ...) set neither.
  tier?: AchievementTierLevel;
  family?: AchievementFamily;
  reward?: AchievementReward;
  hidden?: boolean;
  sortOrder: number;
};

// `as const satisfies` keeps every entry's literal types (so `code` below
// is the literal "first_tournament", not a widened `string`) while still
// checking each entry's shape against AchievementDefinition. AchievementCode
// is derived from that literal data instead of being hand-maintained, so it
// can never drift from the catalog it describes.
export const ACHIEVEMENTS_CATALOG = [
  // --- Participation (tournaments_played) ---------------------------------
  {
    id: "first_tournament",
    code: "first_tournament",
    name: "Дебют",
    description: "Сыграть 1 турнир",
    category: ACHIEVEMENT_CATEGORY.PARTICIPATION,
    icon: ACHIEVEMENT_ICON.PLAY,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.TOURNAMENTS_PLAYED,
    target: 1,
    hidden: false,
    sortOrder: 0,
  },
  {
    id: "ten_tournaments",
    code: "ten_tournaments",
    name: "В игре",
    description: "Сыграть 10 турниров",
    category: ACHIEVEMENT_CATEGORY.PARTICIPATION,
    icon: ACHIEVEMENT_ICON.STACK,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.TOURNAMENTS_PLAYED,
    target: 10,
    hidden: false,
    sortOrder: 1,
  },
  {
    id: "twenty_five_tournaments",
    code: "twenty_five_tournaments",
    name: "25 турниров",
    description: "Сыграть 25 турниров",
    category: ACHIEVEMENT_CATEGORY.PARTICIPATION,
    icon: ACHIEVEMENT_ICON.STACK,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.TOURNAMENTS_PLAYED,
    target: 25,
    hidden: false,
    sortOrder: 2,
  },
  {
    id: "hundred_tournaments",
    code: "hundred_tournaments",
    name: "100 турниров",
    description: "Сыграть 100 турниров",
    category: ACHIEVEMENT_CATEGORY.PARTICIPATION,
    icon: ACHIEVEMENT_ICON.STACK,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.TOURNAMENTS_PLAYED,
    target: 100,
    hidden: false,
    sortOrder: 3,
  },

  // --- Competition (tournaments_won) ---------------------------------------
  {
    id: "first_win",
    code: "first_win",
    name: "Первая победа",
    description: "Победить в одном турнире",
    category: ACHIEVEMENT_CATEGORY.COMPETITION,
    icon: ACHIEVEMENT_ICON.TROPHY,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.TOURNAMENTS_WON,
    target: 1,
    hidden: false,
    sortOrder: 4,
  },
  {
    id: "ten_wins",
    code: "ten_wins",
    name: "10 побед",
    description: "Победить в 10 турнирах",
    category: ACHIEVEMENT_CATEGORY.COMPETITION,
    icon: ACHIEVEMENT_ICON.TROPHY,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.TOURNAMENTS_WON,
    target: 10,
    hidden: false,
    sortOrder: 5,
  },
  {
    id: "twenty_five_wins",
    code: "twenty_five_wins",
    name: "25 побед",
    description: "Победить в 25 турнирах",
    category: ACHIEVEMENT_CATEGORY.COMPETITION,
    icon: ACHIEVEMENT_ICON.TROPHY,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.TOURNAMENTS_WON,
    target: 25,
    hidden: false,
    sortOrder: 6,
  },
  {
    id: "hundred_wins",
    code: "hundred_wins",
    name: "100 побед",
    description: "Победить в 100 турнирах",
    category: ACHIEVEMENT_CATEGORY.COMPETITION,
    icon: ACHIEVEMENT_ICON.TROPHY,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.TOURNAMENTS_WON,
    target: 100,
    hidden: false,
    sortOrder: 7,
  },

  // --- Rating (rating_points) ----------------------------------------------
  {
    id: "rookie_100_rating",
    code: "rookie_100_rating",
    name: "Новичок",
    description: "Набрать 100 очков",
    category: ACHIEVEMENT_CATEGORY.RATING,
    icon: ACHIEVEMENT_ICON.USER,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.RESULTS,
    metric: ACHIEVEMENT_METRIC.RATING_POINTS,
    target: 100,
    hidden: false,
    sortOrder: 8,
  },
  {
    id: "pro_1000_rating",
    code: "pro_1000_rating",
    name: "Профи",
    description: "Набрать 1000 очков",
    category: ACHIEVEMENT_CATEGORY.RATING,
    icon: ACHIEVEMENT_ICON.AWARD,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.RESULTS,
    metric: ACHIEVEMENT_METRIC.RATING_POINTS,
    target: 1000,
    hidden: false,
    sortOrder: 9,
  },

  // --- Terminator (knockouts) — ordinary knockouts progression -------------
  // Codes unchanged from before this pass (ten_knockouts/fifty_knockouts/
  // hundred_knockouts/two_hundred_fifty_knockouts) — only name/tier/family
  // updated so a future UI can render them as one "Terminator" progression
  // card. Metric/target/category/source untouched; KnockoutsEvaluator
  // (which reads ACHIEVEMENT_METRIC.KNOCKOUTS) is unaffected.
  {
    id: "ten_knockouts",
    code: "ten_knockouts",
    name: "Terminator: Бронза",
    description: "Выбить 10 соперников",
    category: ACHIEVEMENT_CATEGORY.KNOCKOUTS,
    icon: ACHIEVEMENT_ICON.AWARD,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.KNOCKOUTS,
    target: 10,
    tier: ACHIEVEMENT_TIER.BRONZE,
    family: ACHIEVEMENT_FAMILY.TERMINATOR,
    hidden: false,
    sortOrder: 10,
  },
  {
    id: "fifty_knockouts",
    code: "fifty_knockouts",
    name: "Terminator: Серебро",
    description: "Выбить 50 соперников",
    category: ACHIEVEMENT_CATEGORY.KNOCKOUTS,
    icon: ACHIEVEMENT_ICON.AWARD,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.KNOCKOUTS,
    target: 50,
    tier: ACHIEVEMENT_TIER.SILVER,
    family: ACHIEVEMENT_FAMILY.TERMINATOR,
    hidden: false,
    sortOrder: 11,
  },
  {
    id: "hundred_knockouts",
    code: "hundred_knockouts",
    name: "Terminator: Золото",
    description: "Выбить 100 соперников",
    category: ACHIEVEMENT_CATEGORY.KNOCKOUTS,
    icon: ACHIEVEMENT_ICON.AWARD,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.KNOCKOUTS,
    target: 100,
    tier: ACHIEVEMENT_TIER.GOLD,
    family: ACHIEVEMENT_FAMILY.TERMINATOR,
    hidden: false,
    sortOrder: 12,
  },
  {
    id: "two_hundred_fifty_knockouts",
    code: "two_hundred_fifty_knockouts",
    name: "Terminator: Платина",
    description: "Выбить 250 соперников",
    category: ACHIEVEMENT_CATEGORY.KNOCKOUTS,
    icon: ACHIEVEMENT_ICON.AWARD,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.KNOCKOUTS,
    target: 250,
    tier: ACHIEVEMENT_TIER.PLATINUM,
    family: ACHIEVEMENT_FAMILY.TERMINATOR,
    hidden: false,
    sortOrder: 13,
  },

  // --- ITM (itm_finishes) ---------------------------------------------------
  // ITM = results.itm_points > 0, exclusively (Rating Breakdown) — see
  // ResultRepository.countItmFinishesByPlayerId / ITMEvaluator.
  {
    id: "first_itm",
    code: "first_itm",
    name: "Первый ITM",
    description: "Попасть в призы 1 раз",
    category: ACHIEVEMENT_CATEGORY.ITM,
    icon: ACHIEVEMENT_ICON.STACK,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.ITM_FINISHES,
    target: 1,
    hidden: false,
    sortOrder: 14,
  },
  {
    id: "ten_itm",
    code: "ten_itm",
    name: "10 ITM",
    description: "Попасть в призы 10 раз",
    category: ACHIEVEMENT_CATEGORY.ITM,
    icon: ACHIEVEMENT_ICON.STACK,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.ITM_FINISHES,
    target: 10,
    hidden: false,
    sortOrder: 15,
  },
  {
    id: "twenty_five_itm",
    code: "twenty_five_itm",
    name: "25 ITM",
    description: "Попасть в призы 25 раз",
    category: ACHIEVEMENT_CATEGORY.ITM,
    icon: ACHIEVEMENT_ICON.STACK,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.ITM_FINISHES,
    target: 25,
    hidden: false,
    sortOrder: 16,
  },
  {
    id: "hundred_itm",
    code: "hundred_itm",
    name: "100 ITM",
    description: "Попасть в призы 100 раз",
    category: ACHIEVEMENT_CATEGORY.ITM,
    icon: ACHIEVEMENT_ICON.STACK,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.ITM_FINISHES,
    target: 100,
    hidden: false,
    sortOrder: 17,
  },

  // --- Referral (referrals) -------------------------------------------------
  {
    id: "first_referral",
    code: "first_referral",
    name: "Первый приглашённый друг",
    description: "Пригласить первого друга",
    category: ACHIEVEMENT_CATEGORY.REFERRAL,
    icon: ACHIEVEMENT_ICON.USER,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.REFERRALS,
    target: 1,
    hidden: false,
    sortOrder: 18,
  },
  {
    id: "five_referrals",
    code: "five_referrals",
    name: "5 приглашённых друзей",
    description: "Пригласить 5 друзей",
    category: ACHIEVEMENT_CATEGORY.REFERRAL,
    icon: ACHIEVEMENT_ICON.USER,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.REFERRALS,
    target: 5,
    hidden: false,
    sortOrder: 19,
  },
  {
    id: "ten_referrals",
    code: "ten_referrals",
    name: "10 приглашённых друзей",
    description: "Пригласить 10 друзей",
    category: ACHIEVEMENT_CATEGORY.REFERRAL,
    icon: ACHIEVEMENT_ICON.USER,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.REFERRALS,
    target: 10,
    hidden: false,
    sortOrder: 20,
  },
  {
    id: "twenty_five_referrals",
    code: "twenty_five_referrals",
    name: "25 приглашённых друзей",
    description: "Пригласить 25 друзей",
    category: ACHIEVEMENT_CATEGORY.REFERRAL,
    icon: ACHIEVEMENT_ICON.USER,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.REFERRALS,
    target: 25,
    hidden: false,
    sortOrder: 21,
  },

  // --- Boss Hunter (boss_knockouts) — cumulative boss-knockout progression -
  // New. Replaces the old standalone manual "boss_hunter" placeholder — no
  // player_achievements rows existed for that code in production (checked
  // before removing it), so no historical data was lost.
  {
    id: "five_boss_knockouts",
    code: "five_boss_knockouts",
    name: "Boss Hunter: Бронза",
    description: "Выбить 5 Boss-соперников",
    category: ACHIEVEMENT_CATEGORY.KNOCKOUTS,
    icon: ACHIEVEMENT_ICON.AWARD,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.BOSS_KNOCKOUTS,
    target: 5,
    tier: ACHIEVEMENT_TIER.BRONZE,
    family: ACHIEVEMENT_FAMILY.BOSS_HUNTER,
    hidden: false,
    sortOrder: 22,
  },
  {
    id: "twenty_five_boss_knockouts",
    code: "twenty_five_boss_knockouts",
    name: "Boss Hunter: Серебро",
    description: "Выбить 25 Boss-соперников",
    category: ACHIEVEMENT_CATEGORY.KNOCKOUTS,
    icon: ACHIEVEMENT_ICON.AWARD,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.BOSS_KNOCKOUTS,
    target: 25,
    tier: ACHIEVEMENT_TIER.SILVER,
    family: ACHIEVEMENT_FAMILY.BOSS_HUNTER,
    hidden: false,
    sortOrder: 23,
  },
  {
    id: "fifty_boss_knockouts",
    code: "fifty_boss_knockouts",
    name: "Boss Hunter: Золото",
    description: "Выбить 50 Boss-соперников",
    category: ACHIEVEMENT_CATEGORY.KNOCKOUTS,
    icon: ACHIEVEMENT_ICON.AWARD,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.BOSS_KNOCKOUTS,
    target: 50,
    tier: ACHIEVEMENT_TIER.GOLD,
    family: ACHIEVEMENT_FAMILY.BOSS_HUNTER,
    hidden: false,
    sortOrder: 24,
  },
  {
    id: "hundred_boss_knockouts",
    code: "hundred_boss_knockouts",
    name: "Boss Hunter: Платина",
    description: "Выбить 100 Boss-соперников",
    category: ACHIEVEMENT_CATEGORY.KNOCKOUTS,
    icon: ACHIEVEMENT_ICON.AWARD,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.BOSS_KNOCKOUTS,
    target: 100,
    tier: ACHIEVEMENT_TIER.PLATINUM,
    family: ACHIEVEMENT_FAMILY.BOSS_HUNTER,
    hidden: false,
    sortOrder: 25,
  },

  // --- Tournament Streak (max_tournament_streak) ----------------------------
  // Replaces the old calendar-week "consecutive_weeks" metric (4 codes:
  // two_consecutive_weeks/four_consecutive_weeks/eight_consecutive_weeks/
  // sixteen_consecutive_weeks) — semantics changed completely (club
  // tournaments in sequence, not calendar weeks), so new codes were minted
  // rather than silently repurposing the old ones. No player_achievements
  // rows existed for the old codes in production (checked before removal).
  {
    id: "tournament_streak_bronze",
    code: "tournament_streak_bronze",
    name: "Tournament Streak: Бронза",
    description: "Сыграть 3 турнира клуба подряд",
    category: ACHIEVEMENT_CATEGORY.ATTENDANCE,
    icon: ACHIEVEMENT_ICON.PLAY,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.MAX_TOURNAMENT_STREAK,
    target: 3,
    tier: ACHIEVEMENT_TIER.BRONZE,
    family: ACHIEVEMENT_FAMILY.TOURNAMENT_STREAK,
    hidden: false,
    sortOrder: 26,
  },
  {
    id: "tournament_streak_silver",
    code: "tournament_streak_silver",
    name: "Tournament Streak: Серебро",
    description: "Сыграть 5 турниров клуба подряд",
    category: ACHIEVEMENT_CATEGORY.ATTENDANCE,
    icon: ACHIEVEMENT_ICON.PLAY,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.MAX_TOURNAMENT_STREAK,
    target: 5,
    tier: ACHIEVEMENT_TIER.SILVER,
    family: ACHIEVEMENT_FAMILY.TOURNAMENT_STREAK,
    hidden: false,
    sortOrder: 27,
  },
  {
    id: "tournament_streak_gold",
    code: "tournament_streak_gold",
    name: "Tournament Streak: Золото",
    description: "Сыграть 10 турниров клуба подряд",
    category: ACHIEVEMENT_CATEGORY.ATTENDANCE,
    icon: ACHIEVEMENT_ICON.PLAY,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.MAX_TOURNAMENT_STREAK,
    target: 10,
    tier: ACHIEVEMENT_TIER.GOLD,
    family: ACHIEVEMENT_FAMILY.TOURNAMENT_STREAK,
    hidden: false,
    sortOrder: 28,
  },
  {
    id: "tournament_streak_platinum",
    code: "tournament_streak_platinum",
    name: "Tournament Streak: Платина",
    description: "Сыграть 20 турниров клуба подряд",
    category: ACHIEVEMENT_CATEGORY.ATTENDANCE,
    icon: ACHIEVEMENT_ICON.PLAY,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.MAX_TOURNAMENT_STREAK,
    target: 20,
    tier: ACHIEVEMENT_TIER.PLATINUM,
    family: ACHIEVEMENT_FAMILY.TOURNAMENT_STREAK,
    hidden: false,
    sortOrder: 29,
  },

  // --- Legendary --------------------------------------------------------
  // category = LEGENDARY does NOT imply type = MANUAL (see the ACHIEVEMENT_TYPE
  // comment above) — Royal Flush is the only manual one here; Headhunter,
  // Number One and Marco Reus are automatic, just rare/hidden like Royal Flush.
  {
    id: "royal_flush",
    code: "royal_flush",
    name: "Royal Flush",
    description: "Собрать комбинацию Роял-флэш за столом",
    category: ACHIEVEMENT_CATEGORY.LEGENDARY,
    icon: ACHIEVEMENT_ICON.AWARD,
    type: ACHIEVEMENT_TYPE.MANUAL,
    source: ACHIEVEMENT_SOURCE.MANUAL,
    hidden: true,
    sortOrder: 30,
  },
  {
    id: "number_one",
    code: "number_one",
    name: "Number One",
    description: "Занять первое место в итоговом рейтинге завершённого сезона",
    category: ACHIEVEMENT_CATEGORY.LEGENDARY,
    icon: ACHIEVEMENT_ICON.AWARD,
    // Event-based automatic (see docs/ACHIEVEMENT_SYSTEM.md): type =
    // AUTOMATIC, but deliberately NO `metric`/`target` — this achievement
    // is not computed by the Engine on every sync, it's granted once, as
    // the outcome of a season actually closing (features/seasons.ts::
    // closeSeason), which today only happens through an explicit admin
    // action. The absence of `metric` is exactly what routes grants
    // through grantEventAutomaticAchievement instead of an evaluator, and
    // is exactly what keeps a normal resync from ever touching this row
    // (no evaluator's `supports()` matches a metric-less definition) --
    // see features/achievements.ts's grant-helpers comment for the full
    // reasoning.
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    hidden: true,
    sortOrder: 31,
  },
  {
    id: "headhunter",
    code: "headhunter",
    name: "Headhunter",
    description: "Выбить 10 и более соперников за один турнир",
    category: ACHIEVEMENT_CATEGORY.LEGENDARY,
    icon: ACHIEVEMENT_ICON.AWARD,
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.MAX_KNOCKOUTS_SINGLE_TOURNAMENT,
    target: 10,
    hidden: true,
    sortOrder: 32,
  },
  {
    id: "marco_reus",
    code: "marco_reus",
    name: "Marco Reus",
    description: "Занять место сразу за рейтинговой зоной турнира (bubble)",
    category: ACHIEVEMENT_CATEGORY.LEGENDARY,
    icon: ACHIEVEMENT_ICON.AWARD,
    // Automated as of this pass -- results.arrived (Rating Breakdown) makes
    // the historical field size, and therefore the rating-zone boundary
    // (getExpectedPrizePlaces), reconstructible for every tournament. See
    // ResultRepository.findArrivedPlacementsByPlayerId / MarcoReusEvaluator.
    type: ACHIEVEMENT_TYPE.AUTOMATIC,
    source: ACHIEVEMENT_SOURCE.AUTOMATIC,
    metric: ACHIEVEMENT_METRIC.BUBBLE_COUNT,
    target: 1,
    hidden: true,
    sortOrder: 33,
  },
] as const satisfies readonly AchievementDefinition[];

// Closed union of every achievement code that actually exists in the
// catalog today — derived, not hand-maintained. Adding a catalog entry
// automatically extends this type; nothing to keep in sync manually.
export type AchievementCode = (typeof ACHIEVEMENTS_CATALOG)[number]["code"];

export function getAchievementDefinition(
  code: string
): AchievementDefinition | undefined {
  return ACHIEVEMENTS_CATALOG.find((achievement) => achievement.code === code);
}

export function getAchievementsSorted(): AchievementDefinition[] {
  return [...ACHIEVEMENTS_CATALOG].sort((a, b) => a.sortOrder - b.sortOrder);
}
