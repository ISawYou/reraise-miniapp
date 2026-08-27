// Dealer Payroll V1. A dealer is still an ordinary player (players.role
// stays 'player' | 'admin', untouched) -- dealer_profiles is an
// ADDITIONAL staff designation layered on top of the existing player base,
// not a new role. See lib/db/schema/dealers.ts for the storage model and
// PostgresDealerRepository.ts for why this domain is Postgres-only.
import {
  dealerRepository,
  playerRepository,
  tournamentRepository,
  DealerAlreadyOnShiftError,
} from "@/lib/repositories";
import type { DealerProfileRow, DealerShiftRow } from "@/lib/repositories";
import type { Player } from "@/types/domain";

export class InvalidTournamentIdError extends Error {
  constructor(tournamentId: string) {
    super(`Tournament ${tournamentId} not found`);
    this.name = "InvalidTournamentIdError";
  }
}

// Resolves a client-submitted tournament id server-side -- never trusts a
// title/date the client might send instead. `null`/empty means "Без
// турнира", a legitimate choice, not an error.
async function resolveTournamentIdOrThrow(tournamentId: string | null): Promise<string | null> {
  if (!tournamentId) {
    return null;
  }

  try {
    await tournamentRepository.findById(tournamentId);
  } catch {
    throw new InvalidTournamentIdError(tournamentId);
  }

  return tournamentId;
}

export { DealerAlreadyOnShiftError };

export const DEFAULT_DEALER_HOURLY_RATE_RUB = 500;

export class DealerNotFoundError extends Error {
  constructor(playerId: string) {
    super(`Dealer profile not found for player ${playerId}`);
    this.name = "DealerNotFoundError";
  }
}

export class DealerNotActiveError extends Error {
  constructor(playerId: string) {
    super(`Dealer ${playerId} is not active`);
    this.name = "DealerNotActiveError";
  }
}

export class DealerHasOpenShiftError extends Error {
  constructor(playerId: string) {
    super(`Dealer ${playerId} has an open shift and cannot be deactivated`);
    this.name = "DealerHasOpenShiftError";
  }
}

export class DealerShiftNotFoundError extends Error {
  constructor(shiftId: string) {
    super(`Dealer shift ${shiftId} not found`);
    this.name = "DealerShiftNotFoundError";
  }
}

export class DealerShiftAlreadyClosedError extends Error {
  constructor(shiftId: string) {
    super(`Dealer shift ${shiftId} is already closed`);
    this.name = "DealerShiftAlreadyClosedError";
  }
}

export class DealerShiftOpenError extends Error {
  constructor(shiftId: string) {
    super(`Dealer shift ${shiftId} is still open and cannot be edited as a completed shift`);
    this.name = "DealerShiftOpenError";
  }
}

export class InvalidShiftRangeError extends Error {
  constructor(message = "Время окончания должно быть позже времени начала") {
    super(message);
    this.name = "InvalidShiftRangeError";
  }
}

function getPreferredPlayerDisplayName(player: {
  admin_display_name?: string | null;
  display_name?: string | null;
}) {
  const adminDisplayName = player.admin_display_name?.trim();
  const displayName = player.display_name?.trim();
  return adminDisplayName || displayName || "Игрок";
}

// Exact rule: paid_hours = ceil(worked_minutes / 60), amount_rub =
// paid_hours * hourly_rate_rub. Worked minutes are rounded to the nearest
// whole minute (timestamps come from a minute-precision UI input, so this
// only absorbs incidental sub-minute noise, never masks a real rounding
// decision). Always computed server-side -- never trusts a client-supplied
// total.
export function computeShiftPayroll(
  startedAt: Date,
  endedAt: Date,
  hourlyRateRub: number
): { workedMinutes: number; paidHours: number; amountRub: number } {
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
    throw new InvalidShiftRangeError("Некорректная дата");
  }

  const diffMs = endedAt.getTime() - startedAt.getTime();

  if (diffMs <= 0) {
    throw new InvalidShiftRangeError();
  }

  const workedMinutes = Math.round(diffMs / 60000);

  if (workedMinutes <= 0) {
    throw new InvalidShiftRangeError();
  }

  const paidHours = Math.ceil(workedMinutes / 60);
  const amountRub = paidHours * hourlyRateRub;

  return { workedMinutes, paidHours, amountRub };
}

export type DealerOpenShift = {
  id: string;
  startedAt: string;
  tournamentId: string | null;
  tournamentTitle: string | null;
};

export type DealerStatus = {
  player: Player;
  hourlyRateRub: number;
  openShift: DealerOpenShift | null;
};

export async function listActiveDealers(): Promise<DealerStatus[]> {
  const profiles = await dealerRepository.listActiveProfiles();

  const statuses = await Promise.all(
    profiles.map(async (profile) => {
      const [player, openShift] = await Promise.all([
        playerRepository.findById(profile.player_id),
        dealerRepository.findOpenShiftByDealerId(profile.player_id),
      ]);

      if (!player) {
        return null;
      }

      let tournamentTitle: string | null = null;
      if (openShift?.tournament_id) {
        tournamentTitle = await tournamentRepository
          .findById(openShift.tournament_id)
          .then((t) => t.title)
          .catch(() => null);
      }

      return {
        player,
        hourlyRateRub: profile.hourly_rate_rub,
        openShift: openShift
          ? {
              id: openShift.id,
              startedAt: openShift.started_at,
              tournamentId: openShift.tournament_id,
              tournamentTitle,
            }
          : null,
      } satisfies DealerStatus;
    })
  );

  return statuses.filter((status): status is DealerStatus => status !== null);
}

// Idempotent: re-activating an already-active dealer is a harmless no-op
// (DB-level upsert). Re-activating a previously-deactivated dealer flips
// is_active back to true and PRESERVES the existing hourly_rate_rub --
// never resets it to the default, so a rate an admin had already set stays
// intact across deactivate/reactivate cycles. History (past shifts) is
// untouched either way -- this function never writes to dealer_shifts.
export async function activateDealer(playerId: string): Promise<DealerProfileRow> {
  await playerRepository.findByIdOrThrow(playerId);
  return dealerRepository.createProfile(playerId, DEFAULT_DEALER_HOURLY_RATE_RUB);
}

export async function deactivateDealer(playerId: string): Promise<void> {
  const profile = await dealerRepository.findProfileByPlayerId(playerId);
  if (!profile) {
    throw new DealerNotFoundError(playerId);
  }

  const openShift = await dealerRepository.findOpenShiftByDealerId(playerId);
  if (openShift) {
    throw new DealerHasOpenShiftError(playerId);
  }

  await dealerRepository.setProfileActive(playerId, false);
}

export async function updateDealerHourlyRate(
  playerId: string,
  hourlyRateRub: number
): Promise<DealerProfileRow> {
  if (!Number.isInteger(hourlyRateRub) || hourlyRateRub < 0) {
    throw new Error("Ставка должна быть неотрицательным целым числом");
  }

  const profile = await dealerRepository.findProfileByPlayerId(playerId);
  if (!profile) {
    throw new DealerNotFoundError(playerId);
  }

  // Only ever affects FUTURE shifts -- every existing shift already has its
  // own hourly_rate_rub snapshotted at start time and is never re-read
  // from this profile.
  return dealerRepository.setProfileHourlyRate(playerId, hourlyRateRub);
}

export async function startDealerShift(
  dealerPlayerId: string,
  startedAt: string,
  tournamentId: string | null,
  createdByPlayerId: string | null
): Promise<DealerShiftRow> {
  const startedDate = new Date(startedAt);
  if (Number.isNaN(startedDate.getTime())) {
    throw new InvalidShiftRangeError("Некорректное время прихода");
  }

  const profile = await dealerRepository.findProfileByPlayerId(dealerPlayerId);
  if (!profile || !profile.is_active) {
    throw new DealerNotActiveError(dealerPlayerId);
  }

  const existingOpenShift = await dealerRepository.findOpenShiftByDealerId(dealerPlayerId);
  if (existingOpenShift) {
    throw new DealerAlreadyOnShiftError(dealerPlayerId);
  }

  // Server-validated -- never trusts a client-supplied tournament
  // title/date. null/"" means "Без турнира", a legitimate, non-invented
  // choice.
  const validTournamentId = await resolveTournamentIdOrThrow(tournamentId);

  return dealerRepository.createShift({
    dealer_player_id: dealerPlayerId,
    started_at: startedDate.toISOString(),
    hourly_rate_rub: profile.hourly_rate_rub,
    tournament_id: validTournamentId,
    created_by_player_id: createdByPlayerId,
  });
}

export async function endDealerShift(
  shiftId: string,
  endedAt: string,
  endedByPlayerId: string | null
): Promise<DealerShiftRow> {
  const shift = await dealerRepository.findShiftById(shiftId);
  if (!shift) {
    throw new DealerShiftNotFoundError(shiftId);
  }
  if (shift.ended_at !== null) {
    throw new DealerShiftAlreadyClosedError(shiftId);
  }

  const { workedMinutes, paidHours, amountRub } = computeShiftPayroll(
    new Date(shift.started_at),
    new Date(endedAt),
    shift.hourly_rate_rub
  );

  return dealerRepository.closeShift(shiftId, {
    ended_at: new Date(endedAt).toISOString(),
    worked_minutes: workedMinutes,
    paid_hours: paidHours,
    amount_rub: amountRub,
    ended_by_player_id: endedByPlayerId,
  });
}

// Admin correction for a COMPLETED shift only -- an open shift must be
// closed via endDealerShift instead. The snapshotted hourly_rate_rub is
// deliberately never part of this patch: only worked_minutes/paid_hours/
// amount_rub are recalculated from the (possibly corrected) timestamps.
export async function editDealerShiftTimestamps(
  shiftId: string,
  startedAt: string,
  endedAt: string
): Promise<DealerShiftRow> {
  const shift = await dealerRepository.findShiftById(shiftId);
  if (!shift) {
    throw new DealerShiftNotFoundError(shiftId);
  }
  if (shift.ended_at === null) {
    throw new DealerShiftOpenError(shiftId);
  }

  const startedDate = new Date(startedAt);
  const endedDate = new Date(endedAt);
  const { workedMinutes, paidHours, amountRub } = computeShiftPayroll(
    startedDate,
    endedDate,
    shift.hourly_rate_rub
  );

  return dealerRepository.updateShiftTimestamps(shiftId, {
    started_at: startedDate.toISOString(),
    ended_at: endedDate.toISOString(),
    worked_minutes: workedMinutes,
    paid_hours: paidHours,
    amount_rub: amountRub,
  });
}

// Super Admin correcting a completed shift's tournament association --
// deliberately does not touch payroll (worked_minutes/paid_hours/
// amount_rub, hourly_rate_rub all untouched). Operator access to this is
// blocked entirely at the route/middleware layer (not in the operator
// allowlist), not re-checked here -- see lib/admin-permissions.ts.
export async function correctDealerShiftTournament(
  shiftId: string,
  tournamentId: string | null
): Promise<DealerShiftRow> {
  const shift = await dealerRepository.findShiftById(shiftId);
  if (!shift) {
    throw new DealerShiftNotFoundError(shiftId);
  }

  const validTournamentId = await resolveTournamentIdOrThrow(tournamentId);
  return dealerRepository.updateShiftTournament(shiftId, validTournamentId);
}

export type DealerShiftSummary = {
  id: string;
  dealerPlayerId: string;
  dealerDisplayName: string;
  startedAt: string;
  endedAt: string | null;
  hourlyRateRub: number;
  workedMinutes: number | null;
  paidHours: number | null;
  amountRub: number | null;
  tournamentId: string | null;
  tournamentTitle: string | null;
  tournamentDate: string | null;
};

async function toShiftSummaries(shifts: DealerShiftRow[]): Promise<DealerShiftSummary[]> {
  const dealerIds = Array.from(new Set(shifts.map((shift) => shift.dealer_player_id)));
  const tournamentIds = Array.from(
    new Set(shifts.map((shift) => shift.tournament_id).filter((id): id is string => id != null))
  );

  const [summaries, tournaments] = await Promise.all([
    playerRepository.findSummariesByIds(dealerIds),
    Promise.all(
      tournamentIds.map((id) =>
        tournamentRepository.findById(id).catch(() => null)
      )
    ),
  ]);

  const nameByPlayerId = new Map(
    summaries.map((summary) => [
      summary.id,
      getPreferredPlayerDisplayName({ display_name: summary.display_name }),
    ])
  );
  const tournamentById = new Map(
    tournaments
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .map((t) => [t.id, t])
  );

  return shifts.map((shift) => {
    const tournament = shift.tournament_id ? tournamentById.get(shift.tournament_id) : undefined;

    return {
      id: shift.id,
      dealerPlayerId: shift.dealer_player_id,
      dealerDisplayName: nameByPlayerId.get(shift.dealer_player_id) ?? "Игрок",
      startedAt: shift.started_at,
      endedAt: shift.ended_at,
      hourlyRateRub: shift.hourly_rate_rub,
      workedMinutes: shift.worked_minutes,
      paidHours: shift.paid_hours,
      amountRub: shift.amount_rub,
      tournamentId: shift.tournament_id,
      tournamentTitle: tournament?.title ?? null,
      tournamentDate: tournament?.start_at ?? null,
    };
  });
}

// "Today" = one calendar day in the app's local runtime timezone, same
// convention every other date-grouping in this app already relies on (see
// e.g. app/tournaments/[id]/page.tsx's formatTournamentDateParts) -- no
// separate timezone library/config introduced here. Grouped by
// STARTED_AT, so an overnight shift (e.g. 20:00 -> 02:00) belongs to the
// day it started, never the day it ended.
export async function listTodayDealerShifts(): Promise<{
  shifts: DealerShiftSummary[];
  totalAmountRub: number;
}> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfNextDay = new Date(startOfDay);
  startOfNextDay.setDate(startOfNextDay.getDate() + 1);

  const shifts = await dealerRepository.listShiftsStartedBetween(
    startOfDay.toISOString(),
    startOfNextDay.toISOString()
  );
  const completedShifts = shifts.filter((shift) => shift.ended_at !== null);
  const summaries = await toShiftSummaries(completedShifts);
  const totalAmountRub = summaries.reduce((sum, shift) => sum + (shift.amountRub ?? 0), 0);

  return { shifts: summaries, totalAmountRub };
}

// V1 recent history -- not analytics. A simple recency-limited list, no
// pagination cursor, no charts, no export.
const RECENT_SHIFTS_LIMIT = 50;

export async function listRecentDealerShifts(): Promise<DealerShiftSummary[]> {
  const shifts = await dealerRepository.listRecentCompletedShifts(RECENT_SHIFTS_LIMIT);
  return toShiftSummaries(shifts);
}

export type DealerStatsPeriod = "month" | "all";

export type DealerStatsSummary = {
  completedShiftCount: number;
  uniqueTournamentCount: number;
  workedMinutes: number;
  paidHours: number;
  amountRub: number;
};

export type DealerStatsByDealer = {
  dealerPlayerId: string;
  dealerDisplayName: string;
  tournamentCount: number;
  shiftCount: number;
  workedMinutes: number;
  paidHours: number;
  amountRub: number;
};

export type DealerStatsByTournament = {
  tournamentId: string | null;
  tournamentTitle: string;
  tournamentDate: string | null;
  dealerCount: number;
  shiftCount: number;
  workedMinutes: number;
  paidHours: number;
  amountRub: number;
};

export type DealerPayrollStats = {
  summary: DealerStatsSummary;
  byDealer: DealerStatsByDealer[];
  byTournament: DealerStatsByTournament[];
};

// Super-Admin-only aggregate view -- only COMPLETED shifts contribute
// (open shifts have no frozen worked_minutes/paid_hours/amount_rub to
// aggregate, and are intentionally excluded from every total here, exactly
// as they are from "Сегодня"/history). Uses each shift's own snapshotted
// hourly_rate_rub-derived amount_rub -- never recalculates from the
// dealer's CURRENT rate, so a later rate change never touches these
// totals for past shifts.
export async function getDealerPayrollStats(period: DealerStatsPeriod): Promise<DealerPayrollStats> {
  const allShifts =
    period === "month"
      ? await (async () => {
          const now = new Date();
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          return dealerRepository.listShiftsStartedBetween(
            startOfMonth.toISOString(),
            startOfNextMonth.toISOString()
          );
        })()
      : await dealerRepository.listAllShifts();

  const completedShifts = allShifts.filter(
    (shift): shift is DealerShiftRow & { worked_minutes: number; paid_hours: number; amount_rub: number } =>
      shift.ended_at !== null &&
      shift.worked_minutes !== null &&
      shift.paid_hours !== null &&
      shift.amount_rub !== null
  );

  const dealerIds = Array.from(new Set(completedShifts.map((shift) => shift.dealer_player_id)));
  const tournamentIds = Array.from(
    new Set(completedShifts.map((shift) => shift.tournament_id).filter((id): id is string => id != null))
  );

  const [summaries, tournaments] = await Promise.all([
    playerRepository.findSummariesByIds(dealerIds),
    Promise.all(tournamentIds.map((id) => tournamentRepository.findById(id).catch(() => null))),
  ]);

  const nameByPlayerId = new Map(
    summaries.map((summary) => [
      summary.id,
      getPreferredPlayerDisplayName({ display_name: summary.display_name }),
    ])
  );
  const tournamentById = new Map(
    tournaments.filter((t): t is NonNullable<typeof t> => t !== null).map((t) => [t.id, t])
  );

  const summary: DealerStatsSummary = {
    completedShiftCount: completedShifts.length,
    uniqueTournamentCount: tournamentIds.length,
    workedMinutes: completedShifts.reduce((sum, s) => sum + s.worked_minutes, 0),
    paidHours: completedShifts.reduce((sum, s) => sum + s.paid_hours, 0),
    amountRub: completedShifts.reduce((sum, s) => sum + s.amount_rub, 0),
  };

  const byDealerMap = new Map<string, DealerStatsByDealer & { tournamentIdSet: Set<string> }>();
  for (const shift of completedShifts) {
    const existing = byDealerMap.get(shift.dealer_player_id);
    const entry =
      existing ??
      ({
        dealerPlayerId: shift.dealer_player_id,
        dealerDisplayName: nameByPlayerId.get(shift.dealer_player_id) ?? "Игрок",
        tournamentCount: 0,
        shiftCount: 0,
        workedMinutes: 0,
        paidHours: 0,
        amountRub: 0,
        tournamentIdSet: new Set<string>(),
      } satisfies DealerStatsByDealer & { tournamentIdSet: Set<string> });

    entry.shiftCount += 1;
    entry.workedMinutes += shift.worked_minutes;
    entry.paidHours += shift.paid_hours;
    entry.amountRub += shift.amount_rub;
    if (shift.tournament_id) entry.tournamentIdSet.add(shift.tournament_id);

    byDealerMap.set(shift.dealer_player_id, entry);
  }
  const byDealer: DealerStatsByDealer[] = Array.from(byDealerMap.values()).map((entry) => ({
    dealerPlayerId: entry.dealerPlayerId,
    dealerDisplayName: entry.dealerDisplayName,
    tournamentCount: entry.tournamentIdSet.size,
    shiftCount: entry.shiftCount,
    workedMinutes: entry.workedMinutes,
    paidHours: entry.paidHours,
    amountRub: entry.amountRub,
  }));

  const NO_TOURNAMENT_KEY = "__none__";
  const byTournamentMap = new Map<string, DealerStatsByTournament & { dealerIdSet: Set<string> }>();
  for (const shift of completedShifts) {
    const key = shift.tournament_id ?? NO_TOURNAMENT_KEY;
    const tournament = shift.tournament_id ? tournamentById.get(shift.tournament_id) : undefined;
    const existing = byTournamentMap.get(key);
    const entry =
      existing ??
      ({
        tournamentId: shift.tournament_id,
        tournamentTitle: tournament?.title ?? "Без турнира",
        tournamentDate: tournament?.start_at ?? null,
        dealerCount: 0,
        shiftCount: 0,
        workedMinutes: 0,
        paidHours: 0,
        amountRub: 0,
        dealerIdSet: new Set<string>(),
      } satisfies DealerStatsByTournament & { dealerIdSet: Set<string> });

    entry.shiftCount += 1;
    entry.workedMinutes += shift.worked_minutes;
    entry.paidHours += shift.paid_hours;
    entry.amountRub += shift.amount_rub;
    entry.dealerIdSet.add(shift.dealer_player_id);

    byTournamentMap.set(key, entry);
  }
  const byTournament: DealerStatsByTournament[] = Array.from(byTournamentMap.values())
    .map((entry) => ({
      tournamentId: entry.tournamentId,
      tournamentTitle: entry.tournamentTitle,
      tournamentDate: entry.tournamentDate,
      dealerCount: entry.dealerIdSet.size,
      shiftCount: entry.shiftCount,
      workedMinutes: entry.workedMinutes,
      paidHours: entry.paidHours,
      amountRub: entry.amountRub,
    }))
    // Most recent tournament first; "Без турнира" (no date) sinks to the end.
    .sort((a, b) => {
      if (!a.tournamentDate && !b.tournamentDate) return 0;
      if (!a.tournamentDate) return 1;
      if (!b.tournamentDate) return -1;
      return new Date(b.tournamentDate).getTime() - new Date(a.tournamentDate).getTime();
    });

  return { summary, byDealer, byTournament };
}

// --- Player-facing personal "Моя работа" area ---
//
// A dealer stays an ordinary player -- there is no separate 'dealer' auth
// role. Access is entirely determined by the existence of a dealer_profiles
// row for the CALLER's own player id, always resolved server-side (see
// app/api/dealer/me/route.ts) -- this module never accepts a playerId from
// the client for this read path, only the authenticated caller's own id.
// Deliberately does not expose hourly_rate_rub, dealerDisplayName,
// created_by_player_id, or ended_by_player_id -- none of that is needed by
// (or safe to hand to) the dealer themselves.

export type PersonalDealerTournamentInfo = {
  tournamentId: string | null;
  tournamentTitle: string | null;
  tournamentDate: string | null;
};

export type PersonalDealerOpenShift = PersonalDealerTournamentInfo & {
  startedAt: string;
};

export type PersonalDealerMonthSummary = {
  completedShiftCount: number;
  uniqueTournamentCount: number;
  workedMinutes: number;
  paidHours: number;
  amountRub: number;
};

export type PersonalDealerShift = PersonalDealerTournamentInfo & {
  id: string;
  startedAt: string;
  endedAt: string | null;
  workedMinutes: number | null;
  paidHours: number | null;
  amountRub: number | null;
};

export type PersonalDealerSummary = {
  // null = this player has never had a dealer profile at all -- the
  // "Моя работа" card must not render. { isActive: false } = a former
  // (deactivated) dealer, whose own historical payroll must still stay
  // visible to them.
  dealer: { isActive: boolean } | null;
  openShift: PersonalDealerOpenShift | null;
  monthSummary: PersonalDealerMonthSummary;
  history: PersonalDealerShift[];
};

// V1 recent history -- same recency cap as the admin "История" list, no
// pagination needed at this club's shift volume.
const PERSONAL_HISTORY_LIMIT = 50;

const EMPTY_MONTH_SUMMARY: PersonalDealerMonthSummary = {
  completedShiftCount: 0,
  uniqueTournamentCount: 0,
  workedMinutes: 0,
  paidHours: 0,
  amountRub: 0,
};

export async function getPersonalDealerSummary(playerId: string): Promise<PersonalDealerSummary> {
  const profile = await dealerRepository.findProfileByPlayerId(playerId);

  if (!profile) {
    return { dealer: null, openShift: null, monthSummary: EMPTY_MONTH_SUMMARY, history: [] };
  }

  const shifts = await dealerRepository.listShiftsByDealerId(playerId);

  const tournamentIds = Array.from(
    new Set(shifts.map((shift) => shift.tournament_id).filter((id): id is string => id != null))
  );
  const tournaments = await Promise.all(
    tournamentIds.map((id) => tournamentRepository.findById(id).catch(() => null))
  );
  const tournamentById = new Map(
    tournaments.filter((t): t is NonNullable<typeof t> => t !== null).map((t) => [t.id, t])
  );

  function resolveTournamentInfo(tournamentId: string | null): PersonalDealerTournamentInfo {
    const tournament = tournamentId ? tournamentById.get(tournamentId) : undefined;
    return {
      tournamentId,
      tournamentTitle: tournament?.title ?? null,
      tournamentDate: tournament?.start_at ?? null,
    };
  }

  // The DB-level partial unique index (dealer_shifts_one_open_per_dealer)
  // guarantees at most one open shift per dealer.
  const openShiftRow = shifts.find((shift) => shift.ended_at === null) ?? null;
  const openShift: PersonalDealerOpenShift | null = openShiftRow
    ? { startedAt: openShiftRow.started_at, ...resolveTournamentInfo(openShiftRow.tournament_id) }
    : null;

  // Only fully-closed shifts with frozen payroll values contribute -- an
  // open shift has no final worked_minutes/paid_hours/amount_rub yet, and
  // must never be shown as if it were already earned.
  const completedShifts = shifts.filter(
    (shift): shift is DealerShiftRow & { ended_at: string; worked_minutes: number; paid_hours: number; amount_rub: number } =>
      shift.ended_at !== null &&
      shift.worked_minutes !== null &&
      shift.paid_hours !== null &&
      shift.amount_rub !== null
  );

  // "Current month" = one calendar month in the app's local runtime
  // timezone, grouped by STARTED_AT so an overnight shift belongs to the
  // month/day it started, same convention as listTodayDealerShifts.
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthShifts = completedShifts.filter((shift) => {
    const startedAtMs = new Date(shift.started_at).getTime();
    return startedAtMs >= startOfMonth.getTime() && startedAtMs < startOfNextMonth.getTime();
  });

  const monthSummary: PersonalDealerMonthSummary = {
    completedShiftCount: monthShifts.length,
    uniqueTournamentCount: new Set(
      monthShifts.map((shift) => shift.tournament_id).filter((id): id is string => id != null)
    ).size,
    workedMinutes: monthShifts.reduce((sum, shift) => sum + shift.worked_minutes, 0),
    paidHours: monthShifts.reduce((sum, shift) => sum + shift.paid_hours, 0),
    amountRub: monthShifts.reduce((sum, shift) => sum + shift.amount_rub, 0),
  };

  // Historical snapshotted values are used unchanged -- never recalculated
  // from the dealer's CURRENT hourly rate (which isn't even fetched here).
  const history: PersonalDealerShift[] = completedShifts
    .slice()
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    .slice(0, PERSONAL_HISTORY_LIMIT)
    .map((shift) => ({
      id: shift.id,
      ...resolveTournamentInfo(shift.tournament_id),
      startedAt: shift.started_at,
      endedAt: shift.ended_at,
      workedMinutes: shift.worked_minutes,
      paidHours: shift.paid_hours,
      amountRub: shift.amount_rub,
    }));

  return { dealer: { isActive: profile.is_active }, openShift, monthSummary, history };
}
