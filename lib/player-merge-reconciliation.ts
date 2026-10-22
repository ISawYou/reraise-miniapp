// Merge engine v2 -- PURE same-tournament collision reconciliation.
//
// Two accounts of one person can both hold rows of the SAME tournament-scoped
// table for the SAME tournament (one registered, the other was checked in,
// etc.). A blind `UPDATE ... SET player_id = target` would hit the
// (tournament_id, player_id) unique indexes / composite PKs, so every such
// collision is collapsed into ONE row BEFORE the generic history move in
// lib/player-merge.ts runs. This file decides WHAT the collapsed row looks
// like; lib/player-merge.ts applies it inside the one SERIALIZABLE merge
// transaction (no I/O, no clock, no DB access here -- every rule is a pure
// function of the two snapshots, unit-tested in
// lib/__tests__/player-merge-reconciliation.test.ts).
//
// Cross-table overlap (target has a registration, source has attendance /
// a result for the same tournament) is NOT a collision at all: those rows
// simply move. Only same-table pairs reach the helpers below.
//
// `results` is deliberately different: a result row is a frozen historical
// fact, so two result rows for one tournament are a genuine data conflict
// that is never auto-resolved here -- see planTournamentCollisions'
// resultConflict and lib/player-merge.ts's resultResolutions handling.

export type MergeSide = "target" | "source";

export type ResultResolutions = Readonly<Record<string, MergeSide>>;

export type RegistrationSnapshot = {
  id: string;
  playerId: string;
  tournamentId: string;
  status: string;
  createdAt: Date;
  noShowAt: Date | null;
  waitlistPromotionNotificationClaimedAt: Date | null;
};

export type ResultSnapshot = {
  id: string;
  playerId: string;
  tournamentId: string;
  place: number;
  ratingPoints: number;
  reentries: number;
  addons: number;
  knockouts: number;
  bossKnockouts: number;
  mysteryBountyPoints: number;
};

export type LiveEntrySnapshot = {
  id: string;
  playerId: string;
  tournamentId: string;
  registrationId: string;
  arrived: boolean;
  rebuys: number;
  addons: number;
  knockouts: number;
  bossKnockouts: number;
  place: number | null;
  sheetRowNumber: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EliminationSnapshot = {
  playerId: string;
  tournamentId: string;
  eliminated: boolean;
  eliminatedAt: Date | null;
  updatedAt: Date;
};

export type AttendanceSnapshot = {
  playerId: string;
  tournamentId: string;
  arrived: boolean;
  arrivedAt: Date | null;
  updatedAt: Date;
};

export type RebuyStateSnapshot = {
  playerId: string;
  tournamentId: string;
  rebuys: number;
  addons: number;
  updatedAt: Date;
};

function earliest(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return b.getTime() < a.getTime() ? b : a;
}

function latest(a: Date, b: Date): Date {
  return b.getTime() > a.getTime() ? b : a;
}

// ---------------------------------------------------------------------------
// registrations
// ---------------------------------------------------------------------------

// Lifecycle precedence, checked against the CURRENT semantics:
//   attended   -- written in bulk at tournament completion for players who
//                 really played (features/tournament-completion-commit.ts);
//   registered -- holds a seat (features/tournament-waitlist-capacity.ts:
//                 SEAT_CONSUMING_STATUSES = registered/attended);
//   waitlist   -- no seat; a waitlist row WITH its own no_show_at is the
//                 quarantined "Не пришли" no-show row;
//   cancelled  -- no seat; may still carry a no_show_at (history).
// Actual participation always outranks an earlier lifecycle state.
export const REGISTRATION_STATUS_RANK: Readonly<Record<string, number>> = {
  cancelled: 1,
  waitlist: 2,
  registered: 3,
  attended: 4,
};

const SEAT_HOLDING_STATUSES = new Set(["registered", "attended"]);

function registrationRank(status: string): number {
  return REGISTRATION_STATUS_RANK[status] ?? 0;
}

export type RegistrationReconciliation = {
  keep: MergeSide;
  keepId: string;
  deleteId: string;
  status: string;
  createdAt: Date;
  noShowAt: Date | null;
  waitlistPromotionNotificationClaimedAt: Date | null;
};

// ONE canonical registration out of two (never summed).
//
//  - status: higher REGISTRATION_STATUS_RANK wins; the winning ROW is the one
//    kept (its id survives, so a live entry already pointing at it needs no
//    rewire). A tie keeps target's row.
//  - created_at: the EARLIER of the two (the person's real first sign-up;
//    for a waitlist row that is also the fairer FIFO position).
//  - waitlist_promotion_notification_claimed_at: earliest non-null -- the
//    at-most-once promotion message was already claimed if EITHER row
//    claimed it; never lost, never re-armed.
//  - no_show_at: NEVER manufactured, and never left on a person who
//    actually took part. It is null when
//      (a) the person participated in this tournament under EITHER account
//          (`participated`: attendance arrived/arrived_at, live-entry
//          arrived, an `attended` registration or a result row), or
//      (b) the canonical status holds a seat (registered/attended) -- the
//          admission path (admitWaitlistedRegistrationWithinCapacity) clears
//          no_show_at whenever a row regains a seat, so a seat-holding row
//          with a no-show mark is an impossible state.
//    Otherwise (canonical row is waitlist/cancelled and nobody arrived) the
//    earliest existing no_show_at is kept: the person really was marked
//    absent and stays quarantined, exactly like a single-account no-show.
export function reconcileRegistrationPair(
  target: RegistrationSnapshot,
  source: RegistrationSnapshot,
  context: { participated: boolean }
): RegistrationReconciliation {
  const keep: MergeSide = registrationRank(source.status) > registrationRank(target.status) ? "source" : "target";
  const kept = keep === "source" ? source : target;
  const dropped = keep === "source" ? target : source;

  const holdsSeat = SEAT_HOLDING_STATUSES.has(kept.status);
  const noShowAt = context.participated || holdsSeat ? null : earliest(target.noShowAt, source.noShowAt);

  return {
    keep,
    keepId: kept.id,
    deleteId: dropped.id,
    status: kept.status,
    createdAt: earliest(target.createdAt, source.createdAt) ?? kept.createdAt,
    noShowAt,
    waitlistPromotionNotificationClaimedAt: earliest(
      target.waitlistPromotionNotificationClaimedAt,
      source.waitlistPromotionNotificationClaimedAt
    ),
  };
}

// ---------------------------------------------------------------------------
// tournament_attendance
// ---------------------------------------------------------------------------

export type AttendanceReconciliation = { arrived: boolean; arrivedAt: Date | null; updatedAt: Date };

// arrived = OR; arrived_at = the EARLIEST real first-arrival timestamp (the
// same "keep the first arrival" rule upsertAttendance applies with
// COALESCE); updated_at = the more recent of the two.
export function reconcileAttendancePair(
  target: AttendanceSnapshot,
  source: AttendanceSnapshot
): AttendanceReconciliation {
  return {
    arrived: target.arrived || source.arrived,
    arrivedAt: earliest(target.arrivedAt, source.arrivedAt),
    updatedAt: latest(target.updatedAt, source.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// tournament_rebuy_state
// ---------------------------------------------------------------------------

export type RebuyStateReconciliation = { rebuys: number; addons: number; updatedAt: Date };

// TOTAL ENTRIES convention: both rows are two copies of ONE person's state,
// so the counters are max'ed -- summing would double the person's entries.
export function reconcileRebuyStatePair(
  target: RebuyStateSnapshot,
  source: RebuyStateSnapshot
): RebuyStateReconciliation {
  return {
    rebuys: Math.max(target.rebuys, source.rebuys),
    addons: Math.max(target.addons, source.addons),
    updatedAt: latest(target.updatedAt, source.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// tournament_player_eliminations
// ---------------------------------------------------------------------------

export type EliminationReconciliation = {
  keep: MergeSide;
  eliminated: boolean;
  eliminatedAt: Date | null;
  updatedAt: Date;
};

// Operational mutable state: the row written LAST describes the current
// state. The later updated_at wins as a whole (eliminated + its own
// eliminated_at travel together -- never mixed across rows); an exact tie
// keeps target's row. Never two elimination events.
export function reconcileEliminationPair(
  target: EliminationSnapshot,
  source: EliminationSnapshot
): EliminationReconciliation {
  const keep: MergeSide = source.updatedAt.getTime() > target.updatedAt.getTime() ? "source" : "target";
  const kept = keep === "source" ? source : target;
  return { keep, eliminated: kept.eliminated, eliminatedAt: kept.eliminatedAt, updatedAt: kept.updatedAt };
}

// ---------------------------------------------------------------------------
// tournament_live_entries
// ---------------------------------------------------------------------------

export type LiveEntryValues = {
  registrationId: string;
  arrived: boolean;
  rebuys: number;
  addons: number;
  knockouts: number;
  bossKnockouts: number;
  place: number | null;
  sheetRowNumber: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LiveEntryReconciliation =
  | { ok: true; keep: MergeSide; keepId: string; deleteId: string; values: LiveEntryValues }
  | { ok: false; conflict: "place_conflict"; targetPlace: number; sourcePlace: number };

// One live entry out of two. Field semantics (paid/cash live play):
//   arrived                        -> OR (any recorded check-in survives)
//   rebuys/addons/knockouts/boss   -> max (two copies of one person's
//                                     progress; never summed)
//   place                          -> non-null beats null; equal values are
//                                     fine; two DIFFERENT places are a real
//                                     conflict -- never guessed. The only
//                                     exception is `placePreference`: when
//                                     the Super Admin explicitly chose which
//                                     account's RESULT is the true one for
//                                     this tournament, that same side's live
//                                     place follows the choice.
//   registration_id                -> the canonical registration
//   sheet_row_number               -> the kept row's own, else the other's
//                                     (one person = one game row)
//   created_at / updated_at        -> earliest / latest
// The kept row is the one already pointing at the canonical registration,
// else target's.
export function reconcileLiveEntryPair(
  target: LiveEntrySnapshot,
  source: LiveEntrySnapshot,
  options: { canonicalRegistrationId: string | null; placePreference?: MergeSide }
): LiveEntryReconciliation {
  let place: number | null;
  if (target.place == null || source.place == null || target.place === source.place) {
    place = target.place ?? source.place ?? null;
  } else if (options.placePreference) {
    place = options.placePreference === "source" ? source.place : target.place;
  } else {
    return { ok: false, conflict: "place_conflict", targetPlace: target.place, sourcePlace: source.place };
  }

  const keep: MergeSide =
    options.canonicalRegistrationId != null && source.registrationId === options.canonicalRegistrationId
      ? "source"
      : "target";
  const kept = keep === "source" ? source : target;
  const dropped = keep === "source" ? target : source;

  return {
    ok: true,
    keep,
    keepId: kept.id,
    deleteId: dropped.id,
    values: {
      registrationId: options.canonicalRegistrationId ?? kept.registrationId,
      arrived: target.arrived || source.arrived,
      rebuys: Math.max(target.rebuys, source.rebuys),
      addons: Math.max(target.addons, source.addons),
      knockouts: Math.max(target.knockouts, source.knockouts),
      bossKnockouts: Math.max(target.bossKnockouts, source.bossKnockouts),
      place,
      sheetRowNumber: kept.sheetRowNumber ?? dropped.sheetRowNumber ?? null,
      createdAt: earliest(target.createdAt, source.createdAt) ?? kept.createdAt,
      updatedAt: latest(target.updatedAt, source.updatedAt),
    },
  };
}

// ---------------------------------------------------------------------------
// Per-tournament planner
// ---------------------------------------------------------------------------

export type OverlapRows = {
  registrations: RegistrationSnapshot[];
  results: ResultSnapshot[];
  liveEntries: LiveEntrySnapshot[];
  eliminations: EliminationSnapshot[];
  attendance: AttendanceSnapshot[];
  rebuyStates: RebuyStateSnapshot[];
};

export type ResultConflict = { tournamentId: string; target: ResultSnapshot; source: ResultSnapshot };

export type LivePlaceConflict = { tournamentId: string; targetPlace: number; sourcePlace: number };

export type TournamentCollisionPlan = {
  tournamentId: string;
  // Same-table pairs that are auto-collapsed (labels for the preview).
  collapsedTables: CollapsibleTable[];
  registration: RegistrationReconciliation | null;
  liveEntry: Extract<LiveEntryReconciliation, { ok: true }> | null;
  // A single live entry (no live-entry pair) that points at the registration
  // being deleted -> moved onto the canonical registration first.
  liveEntryRewire: { liveEntryId: string; registrationId: string } | null;
  attendance: AttendanceReconciliation | null;
  rebuyState: RebuyStateReconciliation | null;
  elimination: EliminationReconciliation | null;
  resultConflict: ResultConflict | null;
  livePlaceConflict: LivePlaceConflict | null;
};

export type CollapsibleTable =
  | "registrations"
  | "tournament_attendance"
  | "tournament_rebuy_state"
  | "tournament_player_eliminations"
  | "tournament_live_entries";

export type CollisionPlan = {
  tournaments: TournamentCollisionPlan[];
  resultConflicts: ResultConflict[];
  // Only live place conflicts NOT covered by a result conflict of the same
  // tournament (those are settled by the admin's result choice).
  livePlaceConflicts: LivePlaceConflict[];
};

function pair<T extends { playerId: string; tournamentId: string }>(
  rows: T[],
  tournamentId: string,
  targetId: string,
  sourceId: string
): { target: T | undefined; source: T | undefined } {
  return {
    target: rows.find((row) => row.tournamentId === tournamentId && row.playerId === targetId),
    source: rows.find((row) => row.tournamentId === tournamentId && row.playerId === sourceId),
  };
}

// Builds the full reconciliation plan for every tournament BOTH accounts have
// data in. Pure: the caller loads the rows (inside the locked SERIALIZABLE
// transaction for execute, or plain reads for the preview) and applies the
// plan. `resultResolutions` only influences a live place that would
// otherwise be a conflict; whether every result conflict HAS a resolution is
// the caller's check (lib/player-merge.ts), not this function's.
export function planTournamentCollisions(input: {
  targetId: string;
  sourceId: string;
  tournamentIds: string[];
  rows: OverlapRows;
  resultResolutions?: ResultResolutions;
}): CollisionPlan {
  const { targetId, sourceId, rows } = input;
  const resolutions = input.resultResolutions ?? {};
  const tournaments: TournamentCollisionPlan[] = [];
  const resultConflicts: ResultConflict[] = [];
  const livePlaceConflicts: LivePlaceConflict[] = [];

  for (const tournamentId of [...input.tournamentIds].sort()) {
    const regs = pair(rows.registrations, tournamentId, targetId, sourceId);
    const res = pair(rows.results, tournamentId, targetId, sourceId);
    const live = pair(rows.liveEntries, tournamentId, targetId, sourceId);
    const elim = pair(rows.eliminations, tournamentId, targetId, sourceId);
    const att = pair(rows.attendance, tournamentId, targetId, sourceId);
    const rebuy = pair(rows.rebuyStates, tournamentId, targetId, sourceId);

    const participated =
      [att.target, att.source].some((row) => row != null && (row.arrived || row.arrivedAt != null)) ||
      [live.target, live.source].some((row) => row?.arrived === true) ||
      [regs.target, regs.source].some((row) => row?.status === "attended") ||
      res.target != null ||
      res.source != null;

    const collapsedTables: CollapsibleTable[] = [];

    const registration =
      regs.target && regs.source ? reconcileRegistrationPair(regs.target, regs.source, { participated }) : null;
    if (registration) collapsedTables.push("registrations");

    const resultConflict: ResultConflict | null =
      res.target && res.source ? { tournamentId, target: res.target, source: res.source } : null;
    if (resultConflict) resultConflicts.push(resultConflict);

    let liveEntry: TournamentCollisionPlan["liveEntry"] = null;
    let liveEntryRewire: TournamentCollisionPlan["liveEntryRewire"] = null;
    let livePlaceConflict: LivePlaceConflict | null = null;

    if (live.target && live.source) {
      const reconciled = reconcileLiveEntryPair(live.target, live.source, {
        canonicalRegistrationId: registration?.keepId ?? null,
        placePreference:
          resultConflict && Object.prototype.hasOwnProperty.call(resolutions, tournamentId)
            ? resolutions[tournamentId]
            : undefined,
      });
      if (reconciled.ok) {
        liveEntry = reconciled;
        collapsedTables.push("tournament_live_entries");
      } else if (!resultConflict) {
        livePlaceConflict = {
          tournamentId,
          targetPlace: reconciled.targetPlace,
          sourcePlace: reconciled.sourcePlace,
        };
        livePlaceConflicts.push(livePlaceConflict);
      }
      // else: decided by the admin's result choice; without one the merge
      // cannot run anyway (result_resolution_required).
    } else if (registration) {
      const single = live.target ?? live.source;
      if (single && single.registrationId === registration.deleteId) {
        liveEntryRewire = { liveEntryId: single.id, registrationId: registration.keepId };
      }
    }

    const attendance = att.target && att.source ? reconcileAttendancePair(att.target, att.source) : null;
    if (attendance) collapsedTables.push("tournament_attendance");

    const rebuyState = rebuy.target && rebuy.source ? reconcileRebuyStatePair(rebuy.target, rebuy.source) : null;
    if (rebuyState) collapsedTables.push("tournament_rebuy_state");

    const elimination = elim.target && elim.source ? reconcileEliminationPair(elim.target, elim.source) : null;
    if (elimination) collapsedTables.push("tournament_player_eliminations");

    tournaments.push({
      tournamentId,
      collapsedTables,
      registration,
      liveEntry,
      liveEntryRewire,
      attendance,
      rebuyState,
      elimination,
      resultConflict,
      livePlaceConflict,
    });
  }

  return { tournaments, resultConflicts, livePlaceConflicts };
}

export type ResultResolutionCheck =
  | { ok: true }
  | { ok: false; reason: "missing"; tournamentIds: string[] }
  | { ok: false; reason: "stale"; tournamentIds: string[] };

// Server-side gate for client-supplied result choices. The resolution map is
// accepted ONLY when its keys are EXACTLY the result conflicts recomputed
// right now: a key for a tournament that is not (or no longer) a conflict of
// this pair is stale/forged (fail closed, refresh preview); a conflict
// without a choice cannot be merged. Values are validated by the caller's
// parser (only "target" / "source" ever reach here).
export function checkResultResolutions(
  resultConflicts: ResultConflict[],
  resolutions: ResultResolutions
): ResultResolutionCheck {
  const conflictIds = new Set(resultConflicts.map((conflict) => conflict.tournamentId));
  const stale = Object.keys(resolutions).filter((tournamentId) => !conflictIds.has(tournamentId));
  if (stale.length > 0) {
    return { ok: false, reason: "stale", tournamentIds: stale.sort() };
  }
  const invalidValue = Object.entries(resolutions).filter(([, side]) => side !== "target" && side !== "source");
  if (invalidValue.length > 0) {
    return { ok: false, reason: "stale", tournamentIds: invalidValue.map(([id]) => id).sort() };
  }
  const missing = [...conflictIds].filter(
    (tournamentId) => !Object.prototype.hasOwnProperty.call(resolutions, tournamentId)
  );
  if (missing.length > 0) {
    return { ok: false, reason: "missing", tournamentIds: missing.sort() };
  }
  return { ok: true };
}
