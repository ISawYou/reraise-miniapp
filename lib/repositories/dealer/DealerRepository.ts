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
  // "Чай" -- optional +500 RUB taxi allowance, always 0 or 500. Kept
  // strictly separate from amount_rub (the frozen base hourly payroll);
  // final payout is amount_rub + taxi_allowance_rub, computed by callers,
  // never merged into one column.
  taxi_allowance_rub: number;
  tournament_id: string | null;
  created_by_player_id: string | null;
  ended_by_player_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DealerShiftInsert = {
  dealer_player_id: string;
  started_at: string;
  hourly_rate_rub: number;
  tournament_id: string | null;
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
  // Super Admin correcting a completed shift's tournament association --
  // deliberately separate from updateShiftTimestamps (different concern,
  // no payroll recalculation involved).
  updateShiftTournament(shiftId: string, tournamentId: string | null): Promise<DealerShiftRow>;
  // Super Admin toggling "Чай" -- taxiAllowanceRub must be exactly 0 or 500
  // (enforced by features/dealers.ts and the DB check constraint). Works on
  // an OPEN shift (before amount_rub is frozen) or a completed one alike --
  // unlike updateShiftTimestamps, this never requires the shift to be
  // closed, and never touches worked_minutes/paid_hours/hourly_rate_rub/
  // amount_rub.
  setShiftTaxiAllowance(shiftId: string, taxiAllowanceRub: number): Promise<DealerShiftRow>;
  // Half-open range [startInclusive, endExclusive) over started_at --
  // feeds both "Сегодня" (one club-local day) and any future date-range
  // need, without baking "today" into the repository itself.
  listShiftsStartedBetween(startInclusive: string, endExclusive: string): Promise<DealerShiftRow[]>;
  listRecentCompletedShifts(limit: number): Promise<DealerShiftRow[]>;
  // All shifts for one dealer -- feeds the player-facing personal
  // "Моя работа" area (a later task) and is reused here for per-dealer
  // stats aggregation.
  listShiftsByDealerId(dealerPlayerId: string): Promise<DealerShiftRow[]>;
  // All shifts linked to one tournament (tournament_id = this id) --
  // NEVER includes "Без турнира" (tournament_id NULL) shifts. Feeds the
  // completed-tournament admin dealer-payout summary
  // (features/dealers.ts::getTournamentDealerPayoutSummary), indexed by
  // dealer_shifts_tournament_id_idx.
  listShiftsByTournamentId(tournamentId: string): Promise<DealerShiftRow[]>;
  // Unbounded -- used for the "Всё время" statistics period. Callers
  // filter to completed (ended_at IS NOT NULL) and date-range themselves;
  // this club's real shift volume is small enough that no pagination is
  // needed for V1 (same scale assumption as listRecentCompletedShifts).
  listAllShifts(): Promise<DealerShiftRow[]>;
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
