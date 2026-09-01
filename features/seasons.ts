import { seasonRepository, tournamentRepository } from "@/lib/repositories";
import { getOfficialSeasonLeaderboard } from "@/features/leaderboard";
import { grantEventAutomaticAchievement } from "@/features/achievements";
import {
  resolveSeasonForCalendarDate,
  toMoscowCalendarDate,
  validateSeasonRanges,
} from "@/lib/season-resolver";
import type { SeasonFullRow } from "@/lib/repositories/season/SeasonRepository";

const NUMBER_ONE_CODE = "number_one";

// Player-safe season shape -- id/title/active status ONLY. start_date/
// end_date are internal admin configuration (see lib/season-resolver.ts's
// module comment) and must never reach a public API payload or
// player-facing component prop.
export type PublicSeason = {
  id: string;
  title: string;
  isActive: boolean;
};

function toPublicSeason(season: SeasonFullRow): PublicSeason {
  return { id: season.id, title: season.title, isActive: season.is_active };
}

// Super-Admin-only (see app/api/admin/seasons/route.ts -- not on the
// operator allowlist in lib/admin-permissions.ts, so middleware.ts denies
// operator by default). Full rows, internal dates included.
export async function listSeasonsAdmin(): Promise<SeasonFullRow[]> {
  const seasons = await seasonRepository.listAll();
  return [...seasons].sort((a, b) => a.start_date.localeCompare(b.start_date));
}

// Player-safe listing -- for any future archive-season picker UI.
export async function listSeasonsPublic(): Promise<PublicSeason[]> {
  const seasons = await listSeasonsAdmin();
  return seasons.map(toPublicSeason);
}

// THE canonical tournament -> season lookup (see lib/season-resolver.ts).
// Searches every season, active or not -- a future, still-inactive season
// (e.g. "Осень 2026" created while "Открытие" is still active) must be
// resolvable. Never falls back to the active season.
export async function resolveSeasonForTournamentDate(startAt: string | Date): Promise<SeasonFullRow> {
  const seasons = await seasonRepository.listAll();
  const calendarDate = toMoscowCalendarDate(startAt);
  return resolveSeasonForCalendarDate(calendarDate, seasons);
}

export class SeasonEditRejectedError extends Error {
  constructor(message: string, public readonly affectedTournamentIds: string[]) {
    super(message);
    this.name = "SeasonEditRejectedError";
  }
}

// Every NON-completed tournament must still resolve to exactly one season
// under `candidateSeasons` -- called before actually writing a season
// create/edit so a bad range never makes an existing upcoming tournament's
// date unresolvable or ambiguous (see this task's "reject the season edit"
// requirement). Completed tournaments are historical and are deliberately
// NOT checked here -- their season_id is frozen regardless of later range
// edits.
async function assertUpcomingTournamentsStillResolve(candidateSeasons: SeasonFullRow[]): Promise<void> {
  const upcoming = await tournamentRepository.listExcludingStatus("completed");
  const broken: string[] = [];

  for (const tournament of upcoming) {
    try {
      resolveSeasonForCalendarDate(toMoscowCalendarDate(tournament.start_at), candidateSeasons);
    } catch {
      broken.push(tournament.id);
    }
  }

  if (broken.length > 0) {
    throw new SeasonEditRejectedError(
      `Изменение конфигурации сезонов сделало бы ${broken.length} предстоящих турниров нерешаемыми по дате (без сезона или с несколькими подходящими сезонами) — отклонено`,
      broken
    );
  }
}

export type SeasonWriteInput = {
  title: string;
  start_date: string;
  end_date: string | null;
};

// Super-Admin-only (route-level, same as listSeasonsAdmin). Validates the
// FULL resulting season set (existing + this new one) before writing --
// overlap or open-ended-range violations are rejected, not silently
// resolved "first row wins".
// Returns the resync summary alongside the new season (see this task's
// "prefer running resync automatically after a successful season date
// create/update" requirement) -- e.g. creating "Осень 2026" immediately
// reports how many already-created September tournaments just moved into
// it, without a separate manual resync call.
export async function createSeason(
  input: SeasonWriteInput
): Promise<{ season: SeasonFullRow; resync: ResyncResult }> {
  const existing = await seasonRepository.listAll();
  const candidate: SeasonFullRow = {
    id: "candidate",
    title: input.title,
    start_date: input.start_date,
    end_date: input.end_date,
    is_active: false,
    created_at: new Date().toISOString(),
  };

  validateSeasonRanges([...existing, candidate]);
  await assertUpcomingTournamentsStillResolve([...existing, candidate]);

  const season = await seasonRepository.insert({
    title: input.title,
    start_date: input.start_date,
    end_date: input.end_date,
    is_active: false,
  });

  const resync = await resyncUpcomingTournamentSeasonAssignments();

  return { season, resync };
}

// Super-Admin-only. Title/date-range edits only -- `is_active` is never
// touched here (that's exclusively closeSeason/rolloverSeason's job, kept
// as one canonical state-transition path). Re-validates the full season
// set AND every non-completed tournament's resolvability with the proposed
// change applied, fails closed on either.
export async function updateSeason(
  seasonId: string,
  input: Partial<SeasonWriteInput>
): Promise<{ season: SeasonFullRow; resync: ResyncResult }> {
  const existing = await seasonRepository.listAll();
  const current = existing.find((season) => season.id === seasonId);

  if (!current) {
    throw new Error(`Сезон "${seasonId}" не найден`);
  }

  const proposed: SeasonFullRow = {
    ...current,
    title: input.title ?? current.title,
    start_date: input.start_date ?? current.start_date,
    end_date: input.end_date !== undefined ? input.end_date : current.end_date,
  };
  const candidateSet = existing.map((season) => (season.id === seasonId ? proposed : season));

  validateSeasonRanges(candidateSet);
  await assertUpcomingTournamentsStillResolve(candidateSet);

  const season = await seasonRepository.update(seasonId, {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.start_date !== undefined ? { start_date: input.start_date } : {}),
    ...(input.end_date !== undefined ? { end_date: input.end_date } : {}),
  });

  const resync = await resyncUpcomingTournamentSeasonAssignments();

  return { season, resync };
}

export type ResyncResult = {
  checked: number;
  reassigned: number;
  reassignments: Array<{ tournamentId: string; fromSeasonId: string | null; toSeasonId: string }>;
  unresolved: Array<{ tournamentId: string; reason: string }>;
};

// Idempotent reconciliation: every NON-completed tournament's season_id is
// recomputed from its date against the current season configuration.
// Already-correct rows are a no-op. Never touches a completed tournament,
// never touches results/rating_points/achievements. A tournament whose
// date no longer resolves (0 or >1 matching season) is left exactly as it
// was and reported in `unresolved` -- never silently cleared or guessed.
export async function resyncUpcomingTournamentSeasonAssignments(): Promise<ResyncResult> {
  const [seasons, upcoming] = await Promise.all([
    seasonRepository.listAll(),
    tournamentRepository.listExcludingStatus("completed"),
  ]);

  const result: ResyncResult = { checked: 0, reassigned: 0, reassignments: [], unresolved: [] };

  for (const tournament of upcoming) {
    result.checked += 1;
    let resolved: SeasonFullRow;
    try {
      resolved = resolveSeasonForCalendarDate(toMoscowCalendarDate(tournament.start_at), seasons);
    } catch (error) {
      result.unresolved.push({
        tournamentId: tournament.id,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (tournament.season_id !== resolved.id) {
      await tournamentRepository.patch(tournament.id, { season_id: resolved.id });
      result.reassignments.push({
        tournamentId: tournament.id,
        fromSeasonId: tournament.season_id,
        toSeasonId: resolved.id,
      });
      result.reassigned += 1;
    }
  }

  return result;
}

export type CloseSeasonResult =
  | {
      status: "closed";
      seasonId: string;
      winnerPlayerId: string;
      winnerRating: number;
    }
  | { status: "no_results"; seasonId: string }
  | { status: "tie"; seasonId: string; tiedPlayerIds: string[]; rating: number };

type SeasonOutcome =
  | { status: "no_results" }
  | { status: "tie"; tiedPlayerIds: string[]; rating: number }
  | { status: "closed"; winnerPlayerId: string; winnerRating: number };

// Shared by closeSeason and rolloverSeason -- the ONE winner-determination
// implementation (see this module's original doc comment, preserved
// below). Never touches `is_active`; callers decide what to do with the
// outcome. getOfficialSeasonLeaderboard has no dependency on is_active, so
// this is safe to call for an already-inactive season too (rolloverSeason's
// retry path).
async function determineAndGrantSeasonOutcome(seasonId: string): Promise<SeasonOutcome> {
  const { leaderboard } = await getOfficialSeasonLeaderboard(seasonId);

  if (leaderboard.length === 0) {
    return { status: "no_results" };
  }

  const [first, second] = leaderboard;

  if (second && second.rating === first.rating) {
    const tiedPlayerIds = leaderboard
      .filter((entry) => entry.rating === first.rating)
      .map((entry) => entry.player_id);

    return { status: "tie", tiedPlayerIds, rating: first.rating };
  }

  // Grant BEFORE the caller marks anything closed/inactive: idempotent
  // (features/achievements.ts), so a retry after a later failure never
  // double-grants or loses the original winner.
  await grantEventAutomaticAchievement(first.player_id, NUMBER_ONE_CODE);

  return { status: "closed", winnerPlayerId: first.player_id, winnerRating: first.rating };
}

// Season finalization — an explicit, one-time, admin-triggered event (see
// app/api/admin/seasons/[id]/close/route.ts), NOT a cron job, NOT
// Date.now() > end_date, NOT tied to the ordinary achievement resync.
// "Season closed" in this codebase has no existing signal beyond
// `seasons.is_active` -- this function IS that signal: it flips
// `is_active` to false itself, once, as the last step of a successful
// finalization.
//
// Winner determination reuses the exact same canonical OFFICIAL calculation
// the public leaderboard uses (features/leaderboard.ts::
// getOfficialSeasonLeaderboard) -- not a second formula, and the rating
// formula itself (features/rating.ts / features/rating-v2.ts) is untouched.
// A player marked "Вне зачёта" keeps their rating_points but is excluded
// from THIS leaderboard entirely, so they can never become `first`/`second`
// and are correctly ignored by both winner selection and tie detection --
// exactly the same rule the public standings apply.
//
// Tie handling: the underlying raw calculation has no deterministic
// tie-breaker for equal totals (see getSeasonLeaderboard's own doc comment).
// A tie for rank 1 (among ELIGIBLE players) aborts with status: "tie"
// instead: nothing is granted, the season is NOT closed, every tied
// player_id is reported so a human can decide.
export async function closeSeason(seasonId: string): Promise<CloseSeasonResult> {
  const seasons = await seasonRepository.listAll();
  const season = seasons.find((s) => s.id === seasonId);

  if (!season) {
    throw new Error(`Сезон "${seasonId}" не найден`);
  }

  // Finalization is a one-time event, not idempotently re-triggerable --
  // an already-closed season (is_active = false) refuses a second close
  // rather than silently recomputing. Explicit re-opening is not supported
  // by this function.
  if (!season.is_active) {
    throw new Error(
      `Сезон "${season.title}" уже закрыт (is_active = false) — повторное закрытие запрещено`
    );
  }

  const outcome = await determineAndGrantSeasonOutcome(seasonId);

  if (outcome.status === "tie") {
    return { status: "tie", seasonId, tiedPlayerIds: outcome.tiedPlayerIds, rating: outcome.rating };
  }

  await seasonRepository.setActive(seasonId, false);

  if (outcome.status === "no_results") {
    return { status: "no_results", seasonId };
  }

  return {
    status: "closed",
    seasonId,
    winnerPlayerId: outcome.winnerPlayerId,
    winnerRating: outcome.winnerRating,
  };
}

export type RolloverResult =
  | { status: "closed"; seasonId: string; nextSeasonId: string; winnerPlayerId: string; winnerRating: number }
  | { status: "no_results"; seasonId: string; nextSeasonId: string }
  | { status: "tie"; seasonId: string; tiedPlayerIds: string[]; rating: number }
  // Next season was already active -- a prior rollover call already fully
  // succeeded. Idempotent no-op, not an error.
  | { status: "already_active"; seasonId: string; nextSeasonId: string };

// First-class current-season -> next-season transition (see this task's
// spec). Reuses determineAndGrantSeasonOutcome -- NOT a second winner
// calculation. Retry-safe: calling this again after a partial failure
// (current already deactivated, next not yet activated) resumes cleanly
// instead of erroring on "season already closed" (which the standalone
// closeSeason() would do) or double-granting Number One (grant is
// idempotent regardless).
//
// old/new active-state mutation is one DB transaction
// (SeasonRepository.setActivePair) so a crash between the two updates
// cannot leave production with zero OR two active seasons.
export async function rolloverSeason(currentSeasonId: string, nextSeasonId: string): Promise<RolloverResult> {
  if (currentSeasonId === nextSeasonId) {
    throw new Error("Текущий и следующий сезон не могут совпадать");
  }

  const seasons = await seasonRepository.listAll();
  const current = seasons.find((s) => s.id === currentSeasonId);
  const next = seasons.find((s) => s.id === nextSeasonId);

  if (!current) {
    throw new Error(`Текущий сезон "${currentSeasonId}" не найден`);
  }
  if (!next) {
    throw new Error(`Следующий сезон "${nextSeasonId}" не найден`);
  }

  if (next.is_active) {
    return { status: "already_active", seasonId: currentSeasonId, nextSeasonId };
  }

  if (next.start_date <= current.start_date) {
    throw new Error(
      `Следующий сезон "${next.title}" должен начинаться позже текущего сезона "${current.title}"`
    );
  }

  const outcome = await determineAndGrantSeasonOutcome(currentSeasonId);

  if (outcome.status === "tie") {
    // Nothing mutated: current stays active (or stays however it was),
    // next stays inactive. Same "refuse to guess" contract as closeSeason.
    return { status: "tie", seasonId: currentSeasonId, tiedPlayerIds: outcome.tiedPlayerIds, rating: outcome.rating };
  }

  // If `current` is already inactive here, this is a resumed retry after a
  // prior attempt closed it but failed before activating `next` -- skip
  // re-deactivating (already false) and just finish the transition.
  await seasonRepository.setActivePair(current.is_active ? currentSeasonId : null, nextSeasonId);

  if (outcome.status === "no_results") {
    return { status: "no_results", seasonId: currentSeasonId, nextSeasonId };
  }

  return {
    status: "closed",
    seasonId: currentSeasonId,
    nextSeasonId,
    winnerPlayerId: outcome.winnerPlayerId,
    winnerRating: outcome.winnerRating,
  };
}
