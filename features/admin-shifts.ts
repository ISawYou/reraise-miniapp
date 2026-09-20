// Admin Shifts V1 -- self-service clock-in/out for staff (role 'operator'
// or 'admin', see lib/roles.ts), flat-payout, SEPARATE from Dealer Payroll
// (features/dealers.ts). See lib/db/schema/adminShifts.ts's doc comment for
// why the two models are not generalized onto one table.
//
// Role/permission checks are deliberately NOT done here (same split as
// features/dealers.ts) -- route handlers resolve caller identity and check
// staff/Super-Admin role (lib/admin-auth.ts's assertServerActorRole /
// middleware.ts's operator allowlist) before calling into this module.
// Self-service start/end always operate on the CALLER's own shift (routes
// never take an adminPlayerId from the client) -- see
// app/api/admin-shift/me/*/route.ts.
import {
  adminShiftRepository,
  tournamentRepository,
  AdminShiftAlreadyOnShiftError,
  playerRepository,
} from "@/lib/repositories";
import type { AdminShiftRow } from "@/lib/repositories";
import { isStaff } from "@/lib/roles";

export { AdminShiftAlreadyOnShiftError };

// Only a default for a NEWLY CREATED shift -- stored directly on the shift
// row at creation (admin_shifts.amount_rub) and never re-read from this
// constant again. Changing this constant in the future must never
// retroactively change an already-created shift's amount; there is no
// "current default" lookup in the read path, only the stored column.
export const DEFAULT_ADMIN_SHIFT_AMOUNT_RUB = 4000;

export class InvalidTournamentIdError extends Error {
  constructor(tournamentId: string) {
    super(`Tournament ${tournamentId} not found`);
    this.name = "InvalidTournamentIdError";
  }
}

// Same pattern as features/dealers.ts's own resolveTournamentIdOrThrow --
// duplicated rather than imported, to keep the two shift models fully
// independent modules (per this feature's explicit "do not generalize"
// scoping). null/"" means "Без турнира", a legitimate choice, never
// invented from a client title/date.
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

export class AdminShiftNotFoundError extends Error {
  constructor(shiftId: string) {
    super(`Admin shift ${shiftId} not found`);
    this.name = "AdminShiftNotFoundError";
  }
}

export class AdminShiftAlreadyClosedError extends Error {
  constructor(shiftId: string) {
    super(`Admin shift ${shiftId} is already closed`);
    this.name = "AdminShiftAlreadyClosedError";
  }
}

export class InvalidShiftRangeError extends Error {
  constructor(message = "Некорректное время смены") {
    super(message);
    this.name = "InvalidShiftRangeError";
  }
}

export class InvalidAmountError extends Error {
  constructor(message = "Сумма должна быть неотрицательным целым числом") {
    super(message);
    this.name = "InvalidAmountError";
  }
}

// Historical backfill / correction (Super Admin only, see
// createHistoricalAdminShift / correctAdminShift below).

export class TournamentRequiredError extends Error {
  constructor(message = "Турнир обязателен для восстановления прошлой смены") {
    super(message);
    this.name = "TournamentRequiredError";
  }
}

export class AdminShiftTargetPlayerNotFoundError extends Error {
  constructor(playerId: string) {
    super(`Player ${playerId} not found`);
    this.name = "AdminShiftTargetPlayerNotFoundError";
  }
}

// "Valid staff/admin candidate" per this feature's own product brief --
// the target of a historical admin-payroll shift must already be staff
// (role 'operator' or 'admin'), same isStaff() convention every other
// staff-gated surface in this codebase already uses. Deliberately not
// re-checked on correction (adminPlayerId can never change there, see
// AdminShiftCorrectionPatch's doc comment -- the owner was already valid
// staff at creation time, or the shift wouldn't exist).
export class InvalidStaffPlayerError extends Error {
  constructor(playerId: string) {
    super(`Player ${playerId} is not a staff member (operator or admin)`);
    this.name = "InvalidStaffPlayerError";
  }
}

export class AdminShiftDuplicateError extends Error {
  constructor(message = "Такая смена уже существует (точное совпадение по турниру, времени и сумме)") {
    super(message);
    this.name = "AdminShiftDuplicateError";
  }
}

export class AdminShiftOverlapError extends Error {
  constructor(message = "Смена пересекается по времени с другой сменой этого администратора") {
    super(message);
    this.name = "AdminShiftOverlapError";
  }
}

// Correction (tournament/timestamps/amount together) applies only to a
// COMPLETED shift -- same "an open shift must be closed via the
// self-service end route instead" rule as editDealerShiftTimestamps.
export class AdminShiftOpenError extends Error {
  constructor(shiftId: string) {
    super(`Admin shift ${shiftId} is still open and cannot be corrected as a completed shift`);
    this.name = "AdminShiftOpenError";
  }
}

// "Начать смену" -- always for the CALLER's own player id (callers never
// pass another admin_player_id here; see the route). amount_rub is set
// ONCE, to the current DEFAULT_ADMIN_SHIFT_AMOUNT_RUB, and stored on the
// shift -- never recomputed later.
export async function startAdminShift(
  adminPlayerId: string,
  startedAt: string,
  tournamentId: string | null
): Promise<AdminShiftRow> {
  const startedDate = new Date(startedAt);
  if (Number.isNaN(startedDate.getTime())) {
    throw new InvalidShiftRangeError("Некорректное время начала");
  }

  const existingOpenShift = await adminShiftRepository.findOpenShiftByAdminId(adminPlayerId);
  if (existingOpenShift) {
    throw new AdminShiftAlreadyOnShiftError(adminPlayerId);
  }

  const validTournamentId = await resolveTournamentIdOrThrow(tournamentId);

  return adminShiftRepository.createShift({
    admin_player_id: adminPlayerId,
    started_at: startedDate.toISOString(),
    amount_rub: DEFAULT_ADMIN_SHIFT_AMOUNT_RUB,
    tournament_id: validTournamentId,
    created_by_player_id: adminPlayerId,
  });
}

// "Закончить смену" -- ends the CALLER's own OPEN shift, resolved
// server-side (never a client-supplied shiftId), so there is structurally
// no way to end someone else's shift through this path. amount_rub is
// untouched -- ending a shift never recomputes payout (unlike dealer
// shifts, there is no time-based formula here at all).
export async function endMyAdminShift(
  adminPlayerId: string,
  endedAt: string
): Promise<AdminShiftRow> {
  const shift = await adminShiftRepository.findOpenShiftByAdminId(adminPlayerId);
  if (!shift) {
    throw new AdminShiftNotFoundError(adminPlayerId);
  }

  const endedDate = new Date(endedAt);
  if (Number.isNaN(endedDate.getTime())) {
    throw new InvalidShiftRangeError("Некорректное время окончания");
  }
  if (endedDate.getTime() < new Date(shift.started_at).getTime()) {
    throw new InvalidShiftRangeError();
  }

  return adminShiftRepository.closeShift(shift.id, {
    ended_at: endedDate.toISOString(),
    ended_by_player_id: adminPlayerId,
  });
}

// Super Admin explicit correction of a shift's amount_rub -- trainee
// shift, shortened shift, exceptional payout. Never recomputed
// automatically, works on an open or completed shift alike (there is no
// time-based formula to keep consistent either way, unlike dealer shifts).
export async function setAdminShiftAmount(
  shiftId: string,
  amountRub: number,
  updatedByPlayerId: string | null
): Promise<AdminShiftRow> {
  if (!Number.isInteger(amountRub) || amountRub < 0) {
    throw new InvalidAmountError();
  }

  const shift = await adminShiftRepository.findShiftById(shiftId);
  if (!shift) {
    throw new AdminShiftNotFoundError(shiftId);
  }

  return adminShiftRepository.setShiftAmount(shiftId, amountRub, updatedByPlayerId);
}

// Strict interval overlap -- touching endpoints (one shift ending exactly
// when another starts) is a legitimate back-to-back handoff, not an
// overlap, so the comparison is deliberately `<` on both sides, never
// `<=`.
function shiftsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

// Shared by createHistoricalAdminShift and correctAdminShift. Only
// COMPLETED shifts for the SAME admin participate -- two different admins
// may legitimately work the same tournament/time (never compared across
// admins), and an open shift has no ended_at to compare against anyway
// (excluded, not an error). `excludeShiftId` lets a correction compare
// against every OTHER shift without ever conflicting with itself.
// `amountRub`/`tournamentId` are optional and, when both given, additionally
// check for an EXACT duplicate first (same tournament+start+end+amount) --
// a stricter, more specifically-worded rejection than the general overlap
// check below, per this feature's own "exact duplicate vs. overlap get
// different, clear errors" requirement. At this club's scale, comparing
// against one admin's full shift list in JS (never one query per shift)
// is the same tolerance every other aggregation in this codebase already
// applies.
async function assertNoShiftConflict(
  adminPlayerId: string,
  startedAt: Date,
  endedAt: Date,
  excludeShiftId: string | null,
  exactMatch?: { tournamentId: string | null; amountRub: number }
): Promise<void> {
  const existing = await adminShiftRepository.listShiftsByAdminId(adminPlayerId);
  const otherCompleted = existing.filter(
    (shift) => shift.ended_at !== null && shift.id !== excludeShiftId
  );

  if (exactMatch) {
    const duplicate = otherCompleted.find(
      (shift) =>
        shift.tournament_id === exactMatch.tournamentId &&
        shift.amount_rub === exactMatch.amountRub &&
        new Date(shift.started_at).getTime() === startedAt.getTime() &&
        new Date(shift.ended_at as string).getTime() === endedAt.getTime()
    );
    if (duplicate) {
      throw new AdminShiftDuplicateError();
    }
  }

  const overlap = otherCompleted.find((shift) =>
    shiftsOverlap(startedAt, endedAt, new Date(shift.started_at), new Date(shift.ended_at as string))
  );
  if (overlap) {
    throw new AdminShiftOverlapError();
  }
}

export type CreateHistoricalAdminShiftInput = {
  adminPlayerId: string;
  // Required -- unlike the live/self-service flow, historical backfill
  // exists specifically to reconstruct per-tournament administrator
  // payroll for Finance, so every historical row must be attributable to
  // a tournament. The schema column itself stays nullable, unchanged, for
  // the live flow.
  tournamentId: string;
  startedAt: string;
  endedAt: string;
  amountRub: number;
  createdByPlayerId: string | null;
};

// Super Admin historical backfill -- creates a shift that is ALREADY
// COMPLETED at insert time (see AdminShiftCompletedInsert's doc comment),
// deliberately never start-then-mutate-then-end: that sequence would
// briefly create a real open shift, which could collide with the one-
// open-per-admin constraint or interfere with an admin's actual live
// shift. Role authorization (Super Admin only) is enforced by the route/
// middleware layer (this feature never re-checks a caller's role itself,
// same split as every other function in this file) -- createdByPlayerId
// is simply the resolved actor, attributed exactly like the self-service
// flow attributes created_by_player_id/ended_by_player_id, both set to
// the same Super Admin here since the same action both "starts" and
// "ends" a historical shift at once.
export async function createHistoricalAdminShift(
  input: CreateHistoricalAdminShiftInput
): Promise<AdminShiftRow> {
  if (!input.tournamentId) {
    throw new TournamentRequiredError();
  }

  const player = await playerRepository.findById(input.adminPlayerId);
  if (!player) {
    throw new AdminShiftTargetPlayerNotFoundError(input.adminPlayerId);
  }
  if (!isStaff(player.role)) {
    throw new InvalidStaffPlayerError(input.adminPlayerId);
  }

  const startedDate = new Date(input.startedAt);
  const endedDate = new Date(input.endedAt);
  if (Number.isNaN(startedDate.getTime()) || Number.isNaN(endedDate.getTime())) {
    throw new InvalidShiftRangeError("Некорректная дата");
  }
  if (endedDate.getTime() < startedDate.getTime()) {
    throw new InvalidShiftRangeError();
  }

  if (!Number.isInteger(input.amountRub) || input.amountRub < 0) {
    throw new InvalidAmountError();
  }

  // Server-validated -- never trusts a client-supplied tournament
  // title/date. Required here (checked above), so this only ever
  // resolves to the real id or throws InvalidTournamentIdError.
  const tournamentId = await resolveTournamentIdOrThrow(input.tournamentId);
  if (!tournamentId) {
    throw new TournamentRequiredError();
  }

  await assertNoShiftConflict(input.adminPlayerId, startedDate, endedDate, null, {
    tournamentId,
    amountRub: input.amountRub,
  });

  return adminShiftRepository.createCompletedShift({
    admin_player_id: input.adminPlayerId,
    tournament_id: tournamentId,
    started_at: startedDate.toISOString(),
    ended_at: endedDate.toISOString(),
    amount_rub: input.amountRub,
    created_by_player_id: input.createdByPlayerId,
    ended_by_player_id: input.createdByPlayerId,
  });
}

export type AdminShiftCorrectionInput = {
  // undefined = leave unchanged; tournamentId may be explicitly null
  // ("Без турнира" -- same convention the schema/live flow already uses).
  tournamentId?: string | null;
  startedAt?: string;
  endedAt?: string;
  amountRub?: number;
};

// Super Admin correction of a COMPLETED shift's tournament/timestamps/
// amount, in one call. Deliberately has no adminPlayerId parameter at
// all -- reassigning a shift to a different admin is NOT supported by
// this or any other function in this codebase (admin_shifts has no
// delete capability either, unlike some other domains, so there is no
// safe "delete and recreate under the correct admin" path today; a
// misattributed shift currently has no supported correction path and
// must be handled outside the application, e.g. by a Super Admin noting
// it and this being addressed in a future release).
export async function correctAdminShift(
  shiftId: string,
  patch: AdminShiftCorrectionInput,
  updatedByPlayerId: string | null
): Promise<AdminShiftRow> {
  const shift = await adminShiftRepository.findShiftById(shiftId);
  if (!shift) {
    throw new AdminShiftNotFoundError(shiftId);
  }
  if (shift.ended_at === null) {
    throw new AdminShiftOpenError(shiftId);
  }

  const nextStartedAt = patch.startedAt !== undefined ? new Date(patch.startedAt) : new Date(shift.started_at);
  const nextEndedAt = patch.endedAt !== undefined ? new Date(patch.endedAt) : new Date(shift.ended_at);
  if (Number.isNaN(nextStartedAt.getTime()) || Number.isNaN(nextEndedAt.getTime())) {
    throw new InvalidShiftRangeError("Некорректная дата");
  }
  if (nextEndedAt.getTime() < nextStartedAt.getTime()) {
    throw new InvalidShiftRangeError();
  }

  const nextAmountRub = patch.amountRub !== undefined ? patch.amountRub : shift.amount_rub;
  if (!Number.isInteger(nextAmountRub) || nextAmountRub < 0) {
    throw new InvalidAmountError();
  }

  const nextTournamentId =
    patch.tournamentId !== undefined
      ? await resolveTournamentIdOrThrow(patch.tournamentId)
      : shift.tournament_id;

  // Overlap only -- no exact-duplicate check here (a correction that
  // turns this shift into an exact copy of another is already caught as
  // an overlap, since identical time ranges always overlap themselves).
  await assertNoShiftConflict(shift.admin_player_id, nextStartedAt, nextEndedAt, shiftId);

  return adminShiftRepository.updateCompletedShift(shiftId, {
    tournament_id: nextTournamentId,
    started_at: nextStartedAt.toISOString(),
    ended_at: nextEndedAt.toISOString(),
    amount_rub: nextAmountRub,
    updated_by_player_id: updatedByPlayerId,
  });
}

export type AdminShiftTournamentInfo = {
  tournamentId: string | null;
  tournamentTitle: string | null;
  tournamentDate: string | null;
};

export type MyAdminOpenShift = AdminShiftTournamentInfo & {
  id: string;
  startedAt: string;
  amountRub: number;
};

export type MyAdminShiftHistoryEntry = AdminShiftTournamentInfo & {
  id: string;
  startedAt: string;
  endedAt: string | null;
  amountRub: number;
};

export type MyAdminShiftSummary = {
  openShift: MyAdminOpenShift | null;
  history: MyAdminShiftHistoryEntry[];
};

const PERSONAL_HISTORY_LIMIT = 50;

async function resolveTournamentInfoMap(
  shifts: AdminShiftRow[]
): Promise<Map<string, { title: string; start_at: string }>> {
  const tournamentIds = Array.from(
    new Set(shifts.map((shift) => shift.tournament_id).filter((id): id is string => id != null))
  );
  const tournaments = await Promise.all(
    tournamentIds.map((id) => tournamentRepository.findById(id).catch(() => null))
  );
  return new Map(
    tournaments
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .map((t) => [t.id, { title: t.title, start_at: t.start_at }])
  );
}

function resolveTournamentInfo(
  tournamentId: string | null,
  tournamentById: Map<string, { title: string; start_at: string }>
): AdminShiftTournamentInfo {
  const tournament = tournamentId ? tournamentById.get(tournamentId) : undefined;
  return {
    tournamentId,
    tournamentTitle: tournament?.title ?? null,
    tournamentDate: tournament?.start_at ?? null,
  };
}

// Player-facing "Моя смена администратора" personal read path -- identity
// comes only from the authenticated caller (see
// app/api/admin-shift/me/route.ts), never a client-supplied playerId.
export async function getMyAdminShiftSummary(adminPlayerId: string): Promise<MyAdminShiftSummary> {
  const shifts = await adminShiftRepository.listShiftsByAdminId(adminPlayerId);
  const tournamentById = await resolveTournamentInfoMap(shifts);

  const openShiftRow = shifts.find((shift) => shift.ended_at === null) ?? null;
  const openShift: MyAdminOpenShift | null = openShiftRow
    ? {
        id: openShiftRow.id,
        startedAt: openShiftRow.started_at,
        amountRub: openShiftRow.amount_rub,
        ...resolveTournamentInfo(openShiftRow.tournament_id, tournamentById),
      }
    : null;

  const history: MyAdminShiftHistoryEntry[] = shifts
    .filter((shift) => shift.ended_at !== null)
    .slice(0, PERSONAL_HISTORY_LIMIT)
    .map((shift) => ({
      id: shift.id,
      startedAt: shift.started_at,
      endedAt: shift.ended_at,
      amountRub: shift.amount_rub,
      ...resolveTournamentInfo(shift.tournament_id, tournamentById),
    }));

  return { openShift, history };
}

export type AdminShiftSummary = AdminShiftTournamentInfo & {
  id: string;
  adminPlayerId: string;
  adminDisplayName: string;
  startedAt: string;
  endedAt: string | null;
  amountRub: number;
  updatedByPlayerId: string | null;
};

function getPreferredPlayerDisplayName(player: {
  admin_display_name?: string | null;
  display_name?: string | null;
}) {
  const adminDisplayName = player.admin_display_name?.trim();
  const displayName = player.display_name?.trim();
  return adminDisplayName || displayName || "Игрок";
}

// Super-Admin-only management list -- most recent first, bounded (same "no
// pagination needed at this club's volume" assumption as the dealer
// history view).
const MANAGEMENT_LIST_LIMIT = 100;

export async function listAdminShiftsForManagement(): Promise<AdminShiftSummary[]> {
  const shifts = await adminShiftRepository.listRecentShifts(MANAGEMENT_LIST_LIMIT);
  const tournamentById = await resolveTournamentInfoMap(shifts);

  const adminIds = Array.from(new Set(shifts.map((shift) => shift.admin_player_id)));
  const summaries = await playerRepository.findSummariesByIds(adminIds);
  const nameByPlayerId = new Map(
    summaries.map((summary) => [summary.id, getPreferredPlayerDisplayName({ display_name: summary.display_name })])
  );

  return shifts.map((shift) => ({
    id: shift.id,
    adminPlayerId: shift.admin_player_id,
    adminDisplayName: nameByPlayerId.get(shift.admin_player_id) ?? "Игрок",
    startedAt: shift.started_at,
    endedAt: shift.ended_at,
    amountRub: shift.amount_rub,
    updatedByPlayerId: shift.updated_by_player_id,
    ...resolveTournamentInfo(shift.tournament_id, tournamentById),
  }));
}
