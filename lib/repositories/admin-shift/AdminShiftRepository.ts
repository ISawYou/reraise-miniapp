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

// Historical backfill (Super Admin only) -- creates a shift that is
// ALREADY completed at insert time, never via start-then-end. Because
// ended_at is set from the first INSERT, the partial unique index
// (admin_shifts_one_open_per_admin, WHERE ended_at IS NULL) never applies
// to this row at all -- structurally impossible to collide with, or
// interfere with, a real open self-service shift. See
// features/admin-shifts.ts::createHistoricalAdminShift for duplicate/
// overlap validation, which happens before this is ever called.
export type AdminShiftCompletedInsert = {
  admin_player_id: string;
  // Required for historical backfill (features/admin-shifts.ts enforces
  // this) -- the schema itself still allows null, unchanged, for the
  // live/self-service flow.
  tournament_id: string | null;
  started_at: string;
  ended_at: string;
  amount_rub: number;
  created_by_player_id: string | null;
  ended_by_player_id: string | null;
};

// Super Admin correction of a COMPLETED shift's tournament/timestamps/
// amount, all four fields always supplied together (the feature layer
// fills in the shift's current value for anything the caller omitted, so
// this patch always represents a complete, internally-consistent target
// state) -- never adminPlayerId, which this type deliberately has no
// field for at all: reassigning a shift to a different admin is
// unsupported (see that doc comment in features/admin-shifts.ts).
export type AdminShiftCorrectionPatch = {
  tournament_id: string | null;
  started_at: string;
  ended_at: string;
  amount_rub: number;
  updated_by_player_id: string | null;
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
  // Historical backfill -- see AdminShiftCompletedInsert's doc comment.
  createCompletedShift(row: AdminShiftCompletedInsert): Promise<AdminShiftRow>;
  // Super Admin correction of tournament/timestamps/amount together on a
  // COMPLETED shift -- see AdminShiftCorrectionPatch's doc comment.
  updateCompletedShift(shiftId: string, patch: AdminShiftCorrectionPatch): Promise<AdminShiftRow>;
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
