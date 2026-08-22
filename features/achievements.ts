import {
  achievementRepository,
  playerRepository,
  resultRepository,
  tournamentRepository,
} from "@/lib/repositories";
import {
  ACHIEVEMENT_TYPE,
  ACHIEVEMENTS_CATALOG,
  getAchievementDefinition,
} from "@/config/achievements";
import { runAchievementEngine } from "@/lib/achievement-engine";
import type { PlayerAchievementMetrics } from "@/lib/achievement-engine";
import { computeMaxTournamentStreak } from "@/lib/tournament-streak";
import { getExpectedPrizePlaces } from "@/lib/tournament-helpers";
import { getAppSetting } from "@/lib/app-settings";
import { publishLegendaryAchievementEvent } from "@/features/club-activity";

// Same key/value app_settings store and the same "missing/anything-but-true
// means false" convention already used by show_email_link_prompt /
// include_admin_activity (see app/api/settings/route.ts) — not a new
// feature-flag system. No schema change: app_settings.key is already a
// free-text primary key.
const AUTOMATIC_ACHIEVEMENTS_SETTING_KEY = "automatic_achievements_enabled";

export async function isAutomaticAchievementsEnabled(): Promise<boolean> {
  const value = await getAppSetting(AUTOMATIC_ACHIEVEMENTS_SETTING_KEY);
  // Strict `=== true`: a missing row (null), any falsy value, or any
  // malformed/non-boolean value stored under this key all resolve to
  // false. This is what guarantees the safe default -- there is no branch
  // here that treats "no setting yet" as enabled.
  return value === true;
}

export async function getPlayerAchievements(playerId: string) {
  return achievementRepository.findByPlayerId(playerId);
}

// Stats collection: reads the player's raw results and reduces them to the
// metrics the Achievement Engine's evaluators are defined against. Adding a
// new metric here (and to AchievementMetric in config/achievements.ts, plus
// an evaluator that reads it) is the only step needed to unlock a new kind
// of automatic achievement.
async function getPlayerAchievementMetrics(
  playerId: string
): Promise<PlayerAchievementMetrics> {
  const [
    playedCount,
    winIds,
    ratingRows,
    referralFields,
    knockoutRows,
    itmFinishesCount,
    bossKnockoutRows,
    completedTournaments,
    arrivedTournamentRows,
    arrivedPlacements,
  ] = await Promise.all([
    resultRepository.countByPlayerId(playerId),
    resultRepository.findWinIdsByPlayerId(playerId),
    resultRepository.findRatingPointsByPlayerId(playerId),
    playerRepository.findReferralFieldsById(playerId),
    resultRepository.findKnockoutsByPlayerId(playerId),
    resultRepository.countItmFinishesByPlayerId(playerId),
    resultRepository.findBossKnockoutsByPlayerId(playerId),
    tournamentRepository.listCompleted(),
    resultRepository.findArrivedTournamentIdsByPlayerId(playerId),
    resultRepository.findArrivedPlacementsByPlayerId(playerId),
  ]);

  const ratingTotal = ratingRows.reduce(
    (sum, row) => sum + (row.rating_points ?? 0),
    0
  );

  const knockoutsTotal = knockoutRows.reduce(
    (sum, row) => sum + (row.knockouts ?? 0),
    0
  );

  // Headhunter: max ORDINARY knockouts in a single tournament, not
  // cumulative -- reuses knockoutRows (already fetched above for the
  // Terminator/`knockouts` sum) instead of a second query. boss_knockouts
  // deliberately excluded (separate counter, see BossKnockoutsRow).
  const maxKnockoutsSingleTournament = knockoutRows.reduce(
    (max, row) => Math.max(max, row.knockouts ?? 0),
    0
  );

  const bossKnockoutsTotal = bossKnockoutRows.reduce(
    (sum, row) => sum + (row.boss_knockouts ?? 0),
    0
  );

  // Tournament Streak: chronological order of every completed club
  // tournament (tournamentRepository.listCompleted() already filters to
  // status = "completed" -- cancelled/non-completed tournaments never
  // enter the sequence), re-sorted ascending with a deterministic
  // tie-breaker (start_at, then created_at, then id) since
  // listCompleted() itself only guarantees start_at DESC, not a stable
  // order for ties. "Participated" = results.arrived = true, the same
  // Rating Breakdown source of truth used everywhere else -- not
  // registrations (a registration doesn't mean the player showed up).
  const orderedTournamentIds = [...completedTournaments]
    .sort((a, b) => {
      if (a.start_at !== b.start_at) return a.start_at < b.start_at ? -1 : 1;
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((tournament) => tournament.id);

  const attendedTournamentIds = new Set(
    arrivedTournamentRows.map((row) => row.tournament_id)
  );

  const maxTournamentStreak = computeMaxTournamentStreak(
    orderedTournamentIds,
    attendedTournamentIds
  );

  // Marco Reus ("bubble"): reuses the exact same canonical rating-zone
  // formula Rating Engine v1/v2 both already call
  // (getExpectedPrizePlaces(fieldSize), lib/tournament-helpers.ts) --
  // not a second, independent formula. field_size here is a plain count
  // of arrived=true rows for that tournament (see
  // ResultRepository.findArrivedPlacementsByPlayerId), which Rating
  // Breakdown makes reconstructible for every historical tournament, not
  // just new ones.
  const bubbleCount = arrivedPlacements.reduce((count, row) => {
    const ratingZoneSize = getExpectedPrizePlaces(row.field_size);
    return row.place === ratingZoneSize + 1 ? count + 1 : count;
  }, 0);

  return {
    tournaments_played: playedCount,
    tournaments_won: winIds.length,
    rating_points: ratingTotal,
    // findReferralFieldsById returns null on a genuine "not found" or a
    // repository-level error (see PlayerRepository.ts) — both fall back to
    // 0 here, same as every other metric when its source has nothing yet.
    referrals: referralFields?.referral_count ?? 0,
    knockouts: knockoutsTotal,
    // ITM ("in the money") = itm_points > 0, exclusively -- Rating
    // Breakdown's frozen, already-decomposed field. No place/field-size/
    // Rating Engine computation here (see
    // ResultRepository.countItmFinishesByPlayerId).
    itm_finishes: itmFinishesCount,
    boss_knockouts: bossKnockoutsTotal,
    max_knockouts_single_tournament: maxKnockoutsSingleTournament,
    max_tournament_streak: maxTournamentStreak,
    bubble_count: bubbleCount,
  };
}

// Read-only: computes what each automatic achievement's progress would be
// right now, without touching player_achievements. Shared by
// syncPlayerAchievements (below) and by the admin resync preview
// (app/api/admin/achievements/resync/route.ts) — one computation, two
// callers, so a dry-run preview never risks drifting from what an actual
// sync would produce.
export async function getPlayerAchievementProgress(playerId: string) {
  const metrics = await getPlayerAchievementMetrics(playerId);

  // Only "automatic" definitions are recalculated here — "manual"
  // achievements (reserved, unused today — see ManualEvaluator) are meant
  // to be granted through a separate path and must not be silently
  // overwritten by this pull-model recompute.
  const automaticDefinitions = ACHIEVEMENTS_CATALOG.filter(
    (definition) => definition.type === ACHIEVEMENT_TYPE.AUTOMATIC
  );

  return runAchievementEngine(automaticDefinitions, metrics);
}

type AchievementSyncOptions = {
  publishActivityEvents?: boolean;
};

const CATALOG_CODES = new Set<string>(ACHIEVEMENTS_CATALOG.map((definition) => definition.code));

async function buildAchievementSyncPlan(playerId: string) {
  const [progress, existing] = await Promise.all([
    getPlayerAchievementProgress(playerId),
    achievementRepository.findSummariesByPlayerId(playerId),
  ]);
  const now = new Date().toISOString();
  const existingByCode = new Map(existing.map((row) => [row.achievement_code, row]));

  const payload = progress.map(({ code, currentValue, completed }) => {
    const existingRow = existingByCode.get(code);
    return {
      player_id: playerId,
      achievement_code: code,
      current_value: currentValue,
      completed_at: existingRow?.completed_at ?? (completed ? now : null),
      updated_at: now,
    };
  });

  const newlyCompletedCodes = progress
    .filter(({ code, completed }) => completed && !existingByCode.get(code)?.completed_at)
    .map(({ code }) => code);
  const changedRows = payload.filter((row) => {
    const previous = existingByCode.get(row.achievement_code);
    return !previous
      || previous.current_value !== row.current_value
      || previous.completed_at !== row.completed_at;
  });
  const projectedCodes = new Set(payload.map((row) => row.achievement_code));
  const untouchedExistingRows = existing.filter(
    (row) => !projectedCodes.has(row.achievement_code),
  ).length;

  return {
    existing,
    payload,
    changedPayload: changedRows,
    newlyCompletedCodes,
    projectedCompletedCodes: [...new Set([
      ...existing
        .filter((row) => row.completed_at != null)
        .map((row) => row.achievement_code),
      ...payload
        .filter((row) => row.completed_at != null)
        .map((row) => row.achievement_code),
    ])],
    currentRows: existing.length,
    projectedRows: new Set([
      ...existing.map((row) => row.achievement_code),
      ...payload.map((row) => row.achievement_code),
    ]).size,
    progressChanges: changedRows.length,
    unchanged: payload.length - changedRows.length + untouchedExistingRows,
    staleCodes: [...new Set(
      existing
        .map((row) => row.achievement_code)
        .filter((code) => !CATALOG_CODES.has(code)),
    )],
  };
}

export async function previewPlayerAchievementSync(playerId: string) {
  return buildAchievementSyncPlan(playerId);
}

export async function syncPlayerAchievements(
  playerId: string,
  options: AchievementSyncOptions = {},
) {
  const plan = await buildAchievementSyncPlan(playerId);
  await achievementRepository.upsertMany(plan.changedPayload);

  if (options.publishActivityEvents) {
    for (const code of plan.newlyCompletedCodes) {
      try {
        await publishLegendaryAchievementEvent(playerId, code);
      } catch (error) {
        console.error("[syncPlayerAchievements] Activity event failed:", error);
      }
    }
  }

  return plan;
}

export async function syncPlayersAchievements(
  playerIds: string[],
  options: AchievementSyncOptions = {},
) {
  const uniqueIds = Array.from(new Set(playerIds));
  await Promise.all(uniqueIds.map((playerId) => syncPlayerAchievements(playerId, options)));
}

// The ONLY entry point tournament completion (features/tournaments.ts) is
// meant to call -- the single choke point for "Automatic Achievements
// Enabled". While the setting is off, this is a true no-op: no metrics are
// read, no evaluator runs, no player_achievements row is touched -- not
// just a UI-level hide.
//
// Deliberately NOT baked into syncPlayerAchievements/syncPlayersAchievements
// themselves: those stay flag-agnostic and keep serving their other,
// explicit (non-"automatic") callers unchanged --
// app/api/admin/achievements/resync/route.ts's dry-run/apply is a
// human-triggered bulk recompute, not the automatic runtime path this flag
// governs, and must keep working exactly as before regardless of this
// setting (see the module comment above about not conflating the two).
export async function syncPlayersAchievementsIfEnabled(
  playerIds: string[],
  options: AchievementSyncOptions = {},
) {
  const enabled = await isAutomaticAchievementsEnabled();

  if (!enabled) {
    return;
  }

  await syncPlayersAchievements(playerIds, options);
}

// --- Grant helpers (manual admin moderation + event-based automatic) ---
//
// Two achievement kinds bypass the metric Engine entirely and are granted
// as a discrete fact rather than computed on every sync:
//   - "manual": a human (admin) grants it. Guarded by assertManualAchievement.
//   - "event-based automatic": type === AUTOMATIC but no `metric` set (e.g.
//     "number_one" — see features/seasons.ts::closeSeason). Guarded by
//     assertEventAutomaticAchievement. Still `type: AUTOMATIC` in the
//     catalog (per product decision: category/rarity and evaluation type
//     are independent axes, see config/achievements.ts's ACHIEVEMENT_TYPE
//     comment) — the distinguishing signal is the ABSENCE of `metric`, the
//     same way manual achievements already have no `metric`.
//
// Both share upsertGrantedAchievement (idempotent completed_at preservation
// — a second grant/finalization never resets an earlier completion date)
// and both go through upsertMany, never a hard DELETE: an automatic
// metric-based achievement's row already exists for every player
// regardless of completion (syncPlayerAchievements always upserts every
// automatic definition it has an evaluator for) — these two kinds now
// follow the same model instead of being a special case.
//
// Why a normal resync can never un-grant either kind: syncPlayerAchievements
// only ever includes a code in its upsertMany payload if
// runAchievementEngine actually returned progress for it, which requires
// evaluatorRegistry.resolve() to find a matching evaluator. No evaluator's
// supports() matches a manual achievement (all check type === AUTOMATIC
// first) or an event-based one (all check a specific `metric` value, which
// event-based achievements don't have) — so neither code ever appears in a
// resync's payload, and upsertMany never touches their row. This is the
// actual protection mechanism, not a special exception coded into sync.

async function upsertGrantedAchievement(playerId: string, code: string): Promise<boolean> {
  const existing = await achievementRepository.findSummariesByPlayerId(playerId);
  const existingRow = existing.find((row) => row.achievement_code === code);
  const now = new Date().toISOString();

  // Idempotent: a second grant/finalization keeps the first completed_at
  // (same preserve-on-conflict pattern as syncPlayerAchievements),
  // current_value stays 1 either way — neither manual nor event-based
  // achievements have numeric progress, "1" just marks "granted" distinctly
  // from the "0 / not granted" default.
  await achievementRepository.upsertMany([
    {
      player_id: playerId,
      achievement_code: code,
      current_value: 1,
      completed_at: existingRow?.completed_at ?? now,
      updated_at: now,
    },
  ]);

  return existingRow?.completed_at == null;
}

function assertManualAchievement(code: string) {
  const definition = getAchievementDefinition(code);

  if (!definition) {
    throw new Error(`Неизвестный код достижения: "${code}"`);
  }

  if (definition.type !== ACHIEVEMENT_TYPE.MANUAL) {
    throw new Error(
      `"${code}" — automatic-достижение, его нельзя выдать/снять вручную`
    );
  }

  return definition;
}

// Event-based automatic: type === AUTOMATIC, but no `metric` (that's what
// makes it "event-based" rather than "metric-based" -- see the module
// comment above). Rejects both manual codes (wrong `type`) and ordinary
// metric-based automatic codes (have a `metric`, must go through
// syncPlayerAchievements instead) -- this guard exists specifically so a
// caller can never accidentally hand-grant a metric-computed achievement
// like "ten_itm" and have it silently diverge from what the Engine would
// compute.
function assertEventAutomaticAchievement(code: string) {
  const definition = getAchievementDefinition(code);

  if (!definition) {
    throw new Error(`Неизвестный код достижения: "${code}"`);
  }

  if (definition.type !== ACHIEVEMENT_TYPE.AUTOMATIC || definition.metric !== undefined) {
    throw new Error(
      `"${code}" — не event-based automatic достижение (нет type=AUTOMATIC без metric)`
    );
  }

  return definition;
}

// Internal — not exposed through the manual admin API (assertManualAchievement
// would reject these codes anyway). Called by feature-level event triggers
// only (currently just features/seasons.ts::closeSeason for "number_one").
export async function grantEventAutomaticAchievement(playerId: string, code: string) {
  assertEventAutomaticAchievement(code);
  const firstCompletion = await upsertGrantedAchievement(playerId, code);
  if (firstCompletion) {
    try {
      await publishLegendaryAchievementEvent(playerId, code);
    } catch (error) {
      console.error("[grantEventAutomaticAchievement] Activity event failed:", error);
    }
  }
}

export async function getManualAchievementsForPlayer(playerId: string) {
  const summaries = await achievementRepository.findSummariesByPlayerId(playerId);
  const summaryByCode = new Map(summaries.map((row) => [row.achievement_code, row]));

  return ACHIEVEMENTS_CATALOG.filter(
    (definition) => definition.type === ACHIEVEMENT_TYPE.MANUAL
  ).map((definition) => {
    const summary = summaryByCode.get(definition.code);
    return {
      code: definition.code,
      name: definition.name,
      description: definition.description,
      granted: summary?.completed_at != null,
      completed_at: summary?.completed_at ?? null,
    };
  });
}

export async function grantManualAchievement(playerId: string, code: string) {
  assertManualAchievement(code);
  const firstCompletion = await upsertGrantedAchievement(playerId, code);
  if (firstCompletion) {
    try {
      await publishLegendaryAchievementEvent(playerId, code);
    } catch (error) {
      console.error("[grantManualAchievement] Activity event failed:", error);
    }
  }
}

export async function revokeManualAchievement(playerId: string, code: string) {
  assertManualAchievement(code);

  const now = new Date().toISOString();

  await achievementRepository.upsertMany([
    {
      player_id: playerId,
      achievement_code: code,
      current_value: 0,
      completed_at: null,
      updated_at: now,
    },
  ]);
}
