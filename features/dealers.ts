// Dealer Payroll V1. A dealer is still an ordinary player (players.role
// stays 'player' | 'admin', untouched) -- dealer_profiles is an
// ADDITIONAL staff designation layered on top of the existing player base,
// not a new role. See lib/db/schema/dealers.ts for the storage model and
// PostgresDealerRepository.ts for why this domain is Postgres-only.
import { dealerRepository, playerRepository, DealerAlreadyOnShiftError } from "@/lib/repositories";
import type { DealerProfileRow, DealerShiftRow } from "@/lib/repositories";
import type { Player } from "@/types/domain";

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

export type DealerStatus = {
  player: Player;
  hourlyRateRub: number;
  openShift: { id: string; startedAt: string } | null;
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

      return {
        player,
        hourlyRateRub: profile.hourly_rate_rub,
        openShift: openShift ? { id: openShift.id, startedAt: openShift.started_at } : null,
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

  return dealerRepository.createShift({
    dealer_player_id: dealerPlayerId,
    started_at: startedDate.toISOString(),
    hourly_rate_rub: profile.hourly_rate_rub,
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
};

async function toShiftSummaries(shifts: DealerShiftRow[]): Promise<DealerShiftSummary[]> {
  const dealerIds = Array.from(new Set(shifts.map((shift) => shift.dealer_player_id)));
  const summaries = await playerRepository.findSummariesByIds(dealerIds);
  const nameByPlayerId = new Map(
    summaries.map((summary) => [
      summary.id,
      getPreferredPlayerDisplayName({ display_name: summary.display_name }),
    ])
  );

  return shifts.map((shift) => ({
    id: shift.id,
    dealerPlayerId: shift.dealer_player_id,
    dealerDisplayName: nameByPlayerId.get(shift.dealer_player_id) ?? "Игрок",
    startedAt: shift.started_at,
    endedAt: shift.ended_at,
    hourlyRateRub: shift.hourly_rate_rub,
    workedMinutes: shift.worked_minutes,
    paidHours: shift.paid_hours,
    amountRub: shift.amount_rub,
  }));
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
