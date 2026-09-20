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
