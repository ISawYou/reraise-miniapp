// Data-access boundary for Admin Shifts V1 -- a thin 1:1 wrapper over
// admin_shifts, same discipline as DealerRepository
// (lib/repositories/dealer/DealerRepository.ts): deciding whether a shift
// can be started/ended/corrected, and any authorization (self-service vs
// Super Admin), stays in features/admin-shifts.ts. This is a SEPARATE
// repository from DealerRepository on purpose -- see
// lib/db/schema/adminShifts.ts's doc comment for why the two models are not
// generalized onto one table.
export type AdminShiftRow = {
  id: string;
  admin_player_id: string;
  started_at: string;
  ended_at: string | null;
  amount_rub: number;
  tournament_id: string | null;
  created_by_player_id: string | null;
  ended_by_player_id: string | null;
  updated_by_player_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminShiftInsert = {
  admin_player_id: string;
  started_at: string;
  amount_rub: number;
  tournament_id: string | null;
  created_by_player_id: string | null;
};

export type AdminShiftClosePatch = {
  ended_at: string;
  ended_by_player_id: string | null;
};

export interface AdminShiftRepository {
  findOpenShiftByAdminId(adminPlayerId: string): Promise<AdminShiftRow | null>;
  findShiftById(shiftId: string): Promise<AdminShiftRow | null>;
  // Relies on the DB-level partial unique index
  // (admin_shifts_one_open_per_admin) as the final guard against a second
  // concurrent open shift -- see PostgresAdminShiftRepository's mapping of
  // that constraint violation to a typed error.
  createShift(row: AdminShiftInsert): Promise<AdminShiftRow>;
  closeShift(shiftId: string, patch: AdminShiftClosePatch): Promise<AdminShiftRow>;
  // Super Admin explicit correction of amount_rub only -- never touches
  // started_at/ended_at/tournament_id. See features/admin-shifts.ts's
  // setAdminShiftAmount.
  setShiftAmount(
    shiftId: string,
    amountRub: number,
    updatedByPlayerId: string | null
  ): Promise<AdminShiftRow>;
  // All shifts for one admin, most recent first -- feeds the personal
  // self-service "Моя смена администратора" history.
  listShiftsByAdminId(adminPlayerId: string): Promise<AdminShiftRow[]>;
  // Super-Admin-only management view -- most recent first, bounded by
  // limit (same "no pagination needed at this club's volume" assumption as
  // DealerRepository.listRecentCompletedShifts).
  listRecentShifts(limit: number): Promise<AdminShiftRow[]>;
}

// Thrown by createShift when the DB-level partial unique index rejects a
// second concurrent open shift for the same admin.
export class AdminShiftAlreadyOnShiftError extends Error {
  constructor(adminPlayerId: string) {
    super(`Admin ${adminPlayerId} already has an open shift`);
    this.name = "AdminShiftAlreadyOnShiftError";
  }
}
