// Data-access boundary for Dealer Payroll V1 -- combines dealer_profiles
// and dealer_shifts under one interface (both are read/written together by
// this one feature, same reasoning TournamentLiveStateRepository already
// applies to tournament_live_entries + tournament_player_eliminations).
// Deciding whether a shift can be started/closed/edited, computing payroll
// (worked_minutes/paid_hours/amount_rub), and all business rules stay in
// features/dealers.ts -- this stays a thin 1:1 wrapper over the two
// tables, no validation/authorization/orchestration.
export type DealerProfileRow = {
  player_id: string;
  is_active: boolean;
  hourly_rate_rub: number;
  created_at: string;
  updated_at: string;
};

export type DealerShiftRow = {
  id: string;
  dealer_player_id: string;
  started_at: string;
  ended_at: string | null;
  hourly_rate_rub: number;
  worked_minutes: number | null;
  paid_hours: number | null;
  amount_rub: number | null;
  created_by_player_id: string | null;
  ended_by_player_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DealerShiftInsert = {
  dealer_player_id: string;
  started_at: string;
  hourly_rate_rub: number;
  created_by_player_id: string | null;
};

// Applied once, at the moment a shift is closed OR later corrected --
// always freshly recalculated server-side from timestamps, never accepted
// as a client-submitted total (see features/dealers.ts's
// computeShiftPayroll).
export type DealerShiftClosePatch = {
  ended_at: string;
  worked_minutes: number;
  paid_hours: number;
  amount_rub: number;
  ended_by_player_id: string | null;
};

// Editing a completed shift's timestamps -- hourly_rate_rub is
// DELIBERATELY not part of this patch: the snapshotted rate never changes
// on an edit, only worked_minutes/paid_hours/amount_rub are recalculated
// from the (possibly corrected) started_at/ended_at.
export type DealerShiftTimestampPatch = {
  started_at: string;
  ended_at: string;
  worked_minutes: number;
  paid_hours: number;
  amount_rub: number;
};

export interface DealerRepository {
  // --- dealer_profiles ---
  findProfileByPlayerId(playerId: string): Promise<DealerProfileRow | null>;
  listActiveProfiles(): Promise<DealerProfileRow[]>;
  // Creates the profile on first activation; on a later re-activation of a
  // previously-deactivated dealer, only flips is_active back to true and
  // preserves the existing hourly_rate_rub (never resets it to the
  // default) -- see features/dealers.ts::activateDealer.
  createProfile(playerId: string, hourlyRateRub: number): Promise<DealerProfileRow>;
  setProfileActive(playerId: string, isActive: boolean): Promise<DealerProfileRow>;
  setProfileHourlyRate(playerId: string, hourlyRateRub: number): Promise<DealerProfileRow>;

  // --- dealer_shifts ---
  findOpenShiftByDealerId(dealerPlayerId: string): Promise<DealerShiftRow | null>;
  findShiftById(shiftId: string): Promise<DealerShiftRow | null>;
  // Relies on the DB-level partial unique index
  // (dealer_shifts_one_open_per_dealer) as the final guard against a
  // second concurrent open shift -- see PostgresDealerRepository's mapping
  // of that constraint violation to a typed error.
  createShift(row: DealerShiftInsert): Promise<DealerShiftRow>;
  closeShift(shiftId: string, patch: DealerShiftClosePatch): Promise<DealerShiftRow>;
  updateShiftTimestamps(shiftId: string, patch: DealerShiftTimestampPatch): Promise<DealerShiftRow>;
  // Half-open range [startInclusive, endExclusive) over started_at --
  // feeds both "Сегодня" (one club-local day) and any future date-range
  // need, without baking "today" into the repository itself.
  listShiftsStartedBetween(startInclusive: string, endExclusive: string): Promise<DealerShiftRow[]>;
  listRecentCompletedShifts(limit: number): Promise<DealerShiftRow[]>;
}

// Thrown by createShift when the DB-level partial unique index rejects a
// second concurrent open shift for the same dealer -- lets
// features/dealers.ts surface a clean, specific error instead of a raw
// Postgres constraint-violation message.
export class DealerAlreadyOnShiftError extends Error {
  constructor(dealerPlayerId: string) {
    super(`Dealer ${dealerPlayerId} already has an open shift`);
    this.name = "DealerAlreadyOnShiftError";
  }
}
