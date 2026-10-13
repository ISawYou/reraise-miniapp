"use server";

// Google Sheets -> ReRaise live Postgres synchronization for kind='free'
// (rating) tournaments. See docs/POKER_CLOCK_REBUY_ADDON_INVESTIGATION.md
// for the read-only investigation that preceded this.
//
// SOURCE-OF-TRUTH CONTRACT
// ------------------------
// ReRaise owns: tournament entity/config, registration roster,
// waitlist/registration status, late-registration state, final frozen
// results, rating, achievements.
//
// Google Sheets owns, during active GS-operated play (kind='free',
// status !== 'completed', google_sheet_tab_name set): Пришел, Выбыл,
// Re-buy, Addon, KO, Boss KO, Mystery Bounty per-player values, Место,
// payment/admin bookkeeping.
//
// Postgres live-mirrors only what existing consumers (Poker Clock,
// player-facing LIVE UI) actually read live: arrived
// (tournament_attendance), eliminated (tournament_player_eliminations),
// rebuys/addons (tournament_rebuy_state). KO/Boss KO/Mystery
// points/Место/payment fields are NOT mirrored live -- no live consumer
// reads them; they are read fresh from the sheet only at completion (see
// app/api/admin/tournaments/[id]/complete-free/route.ts).
//
// At completion: fresh GS snapshot -> validation/rating calculation ->
// frozen Postgres results. No uncontrolled bidirectional sync: this module
// only ever reads sheet *values* and writes Postgres, or writes
// *roster/identity* cells back to the sheet (system columns only, see
// syncTournamentRosterToSheet) -- it never writes operational columns back
// into an active sheet. The sheet holds the OPERATIONAL roster only
// (registered/attended -- players admitted to play); ordinary waitlist and
// quarantined no-show registrations stay in ReRaise, and a row whose
// player_id leaves the operational roster is removed by exact player_id.
//
// HARD SAFETY BOUNDARIES -- this module must never: close late
// registration, complete a tournament, mutate `results`/rating_points,
// trigger achievement resync, alter tournament_type, create/delete
// registrations, or write KO/Boss KO/Mystery/Место into a live table. A
// sheet-read failure is fail-open (keep last-known Postgres state, log and
// skip this tournament this tick) -- the one exception is the
// completion-time fresh read (see complete-free/route.ts), which is
// fail-closed by design there, not here.
import {
  getDerivedEliminationPlaces,
  getTournamentAttendance,
  getTournamentById,
  getTournamentEliminations,
  getTournamentRebuyState,
  getTournamentResultsDraft,
  getTournamentSheetExportData,
  reorderTournamentEliminations,
  setTournamentPlayerAttendance,
  setTournamentPlayerElimination,
  setTournamentPlayerRebuyState,
  type ReorderEliminationsResult,
} from "@/features/tournaments";
import {
  assertTournamentSeatAvailableForReturn,
  reconcileTournamentWaitlistCapacity,
  TournamentSeatUnavailableError,
} from "@/features/tournament-waitlist-capacity";
import { tournamentRepository } from "@/lib/repositories";
import {
  applyNewRosterRowsFormatting,
  batchUpdateSpreadsheetValues,
  deleteSpreadsheetTabRows,
  readSpreadsheetTabValues,
} from "@/lib/google-sheets";
import {
  FREE_SHEET_FIRST_DATA_ROW_NUMBER,
  getFreeSheetColumnLayout,
  parseFreeSheetValues,
  type NormalizedFreeSheetRow,
} from "@/lib/tournament-sheet-parsing";
import { computeDerivedEliminationPlaces } from "@/lib/tournament-placement";
import type { Tournament } from "@/types/domain";

// Duplicated (intentionally) from export-sheet/route.ts's own
// formatEliminationTimestamp -- same reasoning features/tournaments.ts
// already documents for its own small duplicated helpers: a private,
// one-line formatting function isn't worth exporting/importing across a
// route-handler/feature boundary just to save one duplicate definition.
function formatEliminationTimestamp(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type SheetCellValue = string | number | boolean | null;

function logSyncError(message: string, details: Record<string, unknown>) {
  console.error(`[tournament-sheet-sync] ${message}`, details);
}

// Poller worklist -- exactly the tournaments eligible for automatic
// GS live-sync. Reuses the existing listExcludingStatus("completed") repo
// method (already ordered by start_at ASC); kind/sheet filtering is
// business logic, so it stays here, not in the repository.
export async function getActiveFreeTournamentsWithSheet(): Promise<Tournament[]> {
  const tournaments = await tournamentRepository.listExcludingStatus("completed");
  return tournaments.filter(
    (tournament) => tournament.kind === "free" && !!tournament.google_sheet_tab_name?.trim()
  );
}

export type ReadFreeTournamentSheetResult =
  | {
      ok: true;
      rows: Map<string, NormalizedFreeSheetRow>;
      dataRowCount: number;
      rowNumbersByPlayerId: Map<string, number[]>;
    }
  | { ok: false; reason: string };

// Reads the tournament's tab ONCE and parses it -- callers (both the
// poller and the completion route) reuse the same returned snapshot for
// every downstream reconciliation step instead of re-fetching.
export async function readAndParseFreeTournamentSheet(
  tournament: Tournament
): Promise<ReadFreeTournamentSheetResult> {
  const tabName = tournament.google_sheet_tab_name?.trim();
  if (!tabName) {
    return { ok: false, reason: "no linked Google Sheet" };
  }

  let values: string[][];
  try {
    values = await readSpreadsheetTabValues(tabName);
  } catch (error) {
    logSyncError("failed to read sheet", {
      tournamentId: tournament.id,
      tabName,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "Google Sheets read failed" };
  }

  const parsed = parseFreeSheetValues(values, tournament.tournament_type);
  if (!parsed.ok) {
    logSyncError("unexpected sheet layout -- skipping synchronization", {
      tournamentId: tournament.id,
      tabName,
      reason: parsed.reason,
    });
    return { ok: false, reason: parsed.reason };
  }

  return {
    ok: true,
    rows: parsed.rows,
    dataRowCount: parsed.dataRowCount,
    rowNumbersByPlayerId: parsed.rowNumbersByPlayerId,
  };
}

export type LiveFieldSyncResult = {
  attendanceChanges: number;
  eliminationChanges: number;
  rebuyChanges: number;
  // player_ids that were eliminated=true BEFORE this call and are
  // eliminated=false AFTER it -- a genuine un-elimination this tick, as
  // opposed to a player who was already non-eliminated. Consumed by
  // syncDerivedPlacementToSheet: only these rows' derived Место/Время
  // выбытия get cleared -- every other non-eliminated row (including a
  // manually-entered Место for an active top finisher) is left untouched.
  unEliminatedPlayerIds: string[];
};

// Mirrors GS -> Postgres for exactly the fields live consumers need:
// arrived, eliminated, rebuys/addons. Only ever applied to
// `eligiblePlayerIds` (registered/attended -- never waitlist, never an
// unknown player_id), and only ever writes a field whose current Postgres
// value actually differs from the sheet's normalized value -- an unchanged
// value is never rewritten. A player_id present in eligiblePlayerIds but
// absent from `parsedRows` this tick (temporarily missing row) is left
// completely untouched, never reset.
export async function applyLiveFieldsFromSheetSnapshot(
  tournamentId: string,
  parsedRows: Map<string, NormalizedFreeSheetRow>,
  eligiblePlayerIds: Set<string>
): Promise<LiveFieldSyncResult> {
  const [attendance, eliminations, rebuyState] = await Promise.all([
    getTournamentAttendance(tournamentId),
    getTournamentEliminations(tournamentId),
    getTournamentRebuyState(tournamentId),
  ]);

  let attendanceChanges = 0;
  let eliminationChanges = 0;
  let rebuyChanges = 0;
  const unEliminatedPlayerIds: string[] = [];

  for (const playerId of eligiblePlayerIds) {
    const sheetRow = parsedRows.get(playerId);
    if (!sheetRow) {
      continue;
    }

    const currentAttendance = attendance.get(playerId);
    if ((currentAttendance?.arrived ?? false) !== sheetRow.arrived) {
      await setTournamentPlayerAttendance(tournamentId, playerId, sheetRow.arrived);
      attendanceChanges++;
    }

    const currentElimination = eliminations.get(playerId);
    const wasEliminated = currentElimination?.eliminated ?? false;
    if (wasEliminated !== sheetRow.eliminated) {
      // Never trust a GS elimination timestamp -- setTournamentPlayerElimination
      // derives/preserves eliminated_at itself.
      let applied = true;
      try {
        await setTournamentPlayerElimination(tournamentId, playerId, sheetRow.eliminated);
      } catch (error) {
        // Un-checking Выбыл in the sheet while the tournament is full: the
        // capacity check fails closed for THIS player only (Postgres keeps
        // eliminated=true, retried every tick) -- it must not abort the
        // rest of this tournament's sync pass.
        if (!(error instanceof TournamentSeatUnavailableError)) {
          throw error;
        }
        applied = false;
        logSyncError("un-elimination from sheet rejected: no free seat", {
          tournamentId,
          playerId,
        });
      }
      if (applied) {
        eliminationChanges++;
        if (wasEliminated && !sheetRow.eliminated) {
          unEliminatedPlayerIds.push(playerId);
        }
      }
    }

    const currentRebuy = rebuyState.get(playerId);
    if (
      (currentRebuy?.rebuys ?? 0) !== sheetRow.rebuys ||
      (currentRebuy?.addons ?? 0) !== sheetRow.addons
    ) {
      await setTournamentPlayerRebuyState(tournamentId, playerId, sheetRow.rebuys, sheetRow.addons);
      rebuyChanges++;
    }
  }

  return { attendanceChanges, eliminationChanges, rebuyChanges, unEliminatedPlayerIds };
}

export type PlacementSyncResult = {
  placesUpdated: number;
};

// Writes back exactly the two ReRaise-DERIVED cells (Место, Время
// выбытия) for currently-eliminated players, using the SAME authoritative
// placement algorithm as everywhere else (getDerivedEliminationPlaces).
// Recomputed fresh from CURRENT attendance/elimination state on every
// call -- not just when this player's own elimination changed -- so a
// later arrival that grows the field automatically shifts an
// already-eliminated player's place on the next call, with no click
// required (see lib/tournament-placement.ts's doc comment). Only a cell
// whose raw sheet text actually differs from the freshly-computed value is
// queued for a write; `batchUpdateSpreadsheetValues` handles the actual
// API call, and this function performs NO Sheets read of its own -- it
// only ever consumes `parsedRows` from the caller's own single read this
// pass.
//
// Non-eliminated rows are only ever touched if they're in
// `unEliminatedPlayerIds` (a genuine un-elimination THIS call) -- every
// other non-eliminated row, including one where an admin manually typed a
// Место for an active top finisher, is left completely alone. This is the
// one place that enforces "ReRaise owns Место only while Выбыл=TRUE" (see
// this module's top-of-file source-of-truth contract).
export async function syncDerivedPlacementToSheet(
  tournament: Tournament,
  parsedRows: Map<string, NormalizedFreeSheetRow>,
  eligiblePlayerIds: Set<string>,
  unEliminatedPlayerIds: string[]
): Promise<PlacementSyncResult> {
  const tabName = tournament.google_sheet_tab_name?.trim();
  if (!tabName) {
    return { placesUpdated: 0 };
  }

  const layout = getFreeSheetColumnLayout(tournament.tournament_type);
  const [attendance, eliminations] = await Promise.all([
    getTournamentAttendance(tournament.id),
    getTournamentEliminations(tournament.id),
  ]);

  const fieldSize = Array.from(attendance.values()).filter((row) => row.arrived).length;
  const derivedPlaces = computeDerivedPlacesFromEliminations(fieldSize, eliminations);
  const unEliminatedSet = new Set(unEliminatedPlayerIds);

  const updates: { range: string; values: SheetCellValue[][] }[] = [];

  for (const playerId of eligiblePlayerIds) {
    const sheetRow = parsedRows.get(playerId);
    if (!sheetRow) {
      continue;
    }

    const elimination = eliminations.get(playerId);

    if (elimination?.eliminated) {
      const place = derivedPlaces.get(playerId) ?? null;
      const targetPlace = place != null ? String(place) : "";
      const targetTime = formatEliminationTimestamp(elimination.eliminated_at);

      if (sheetRow.raw_place !== targetPlace) {
        updates.push({
          range: `${tabName}!${columnIndexToLetter(layout.placeIndex)}${sheetRow.rowNumber}`,
          values: [[targetPlace]],
        });
      }
      if (sheetRow.raw_eliminated_at !== targetTime) {
        updates.push({
          range: `${tabName}!${columnIndexToLetter(layout.eliminatedAtIndex)}${sheetRow.rowNumber}`,
          values: [[targetTime]],
        });
      }
      continue;
    }

    if (unEliminatedSet.has(playerId)) {
      if (sheetRow.raw_place !== "") {
        updates.push({
          range: `${tabName}!${columnIndexToLetter(layout.placeIndex)}${sheetRow.rowNumber}`,
          values: [[""]],
        });
      }
      if (sheetRow.raw_eliminated_at !== "") {
        updates.push({
          range: `${tabName}!${columnIndexToLetter(layout.eliminatedAtIndex)}${sheetRow.rowNumber}`,
          values: [[""]],
        });
      }
    }
  }

  if (updates.length > 0) {
    await batchUpdateSpreadsheetValues(updates);
  }

  return { placesUpdated: updates.length };
}

function computeDerivedPlacesFromEliminations(
  fieldSize: number,
  eliminations: Map<string, { eliminated: boolean; eliminated_at: string | null }>
): Map<string, number> {
  const eliminatedEntries = Array.from(eliminations.entries())
    .filter(([, status]) => status.eliminated)
    .map(([player_id, status]) => ({
      player_id,
      eliminated_at: status.eliminated_at ?? new Date(0).toISOString(),
    }));

  return computeDerivedEliminationPlaces(fieldSize, eliminatedEntries);
}

function columnIndexToLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export type RosterSyncResult = {
  appended: number;
  identityUpdated: number;
  // Stale DATA rows deleted this call (player_id no longer in the
  // operational registered/attended roster).
  removed: number;
  // Stale rows detected but NOT removed this call (the deletion or the
  // fresh pre-delete read failed). The next reconciliation pass retries;
  // callers that must report an immediate cleanup failure (the "Не пришёл"
  // action) check this.
  staleRowsPending: number;
};

type FreeSheetSnapshot = {
  rows: Map<string, NormalizedFreeSheetRow>;
  dataRowCount: number;
  rowNumbersByPlayerId?: Map<string, number[]>;
};

// Every sheet DATA row whose exact player_id is NOT in the operational
// roster. Identity is the trimmed Player ID cell only -- never a nickname.
// Rows with an empty Player ID (an operator's scratch row) and anything
// above the first data row (meta/header) are never candidates. Every
// duplicate row of a stale player_id is included; a row of an operational
// player is never included, duplicate or not.
function findStaleRosterRowNumbers(
  snapshot: FreeSheetSnapshot,
  operationalPlayerIds: ReadonlySet<string>
): number[] {
  const rowNumbersByPlayerId =
    snapshot.rowNumbersByPlayerId ??
    new Map(Array.from(snapshot.rows.values()).map((row) => [row.player_id, [row.rowNumber]]));

  const stale: number[] = [];
  for (const [playerId, rowNumbers] of rowNumbersByPlayerId) {
    if (!playerId || operationalPlayerIds.has(playerId)) {
      continue;
    }
    for (const rowNumber of rowNumbers) {
      if (rowNumber >= FREE_SHEET_FIRST_DATA_ROW_NUMBER) {
        stale.push(rowNumber);
      }
    }
  }
  return stale.sort((a, b) => b - a);
}

type RosterSyncOutcome = {
  result: RosterSyncResult;
  // The sheet snapshot whose row numbers are valid AFTER this call's
  // deletions (appended rows are simply absent from it -- appends never
  // shift existing rows). null when rows were deleted but the follow-up
  // read failed: the caller must then do NO further row-number-based
  // write this pass.
  snapshot: FreeSheetSnapshot | null;
};

// ReRaise -> GS operational roster sync. The operational roster is exactly
// the registrations currently admitted to play (registered/attended -- see
// RegistrationRepository.findExportParticipants); ordinary waitlist and
// quarantined no-show rows are NOT part of it. In order:
//   1. STALE-ROW REMOVAL: a data row whose exact player_id is no longer in
//      the operational roster (no-show -> waitlist, cancellation, admin
//      removal, or an ordinary waitlist row that should never have been
//      exported) is DELETED -- by exact player_id only, header/meta rows
//      never touched, rows deleted bottom-up (descending row numbers) so
//      index shifts are safe. Right before deleting, the sheet and the
//      roster are both re-read so the row numbers are current; right after,
//      the sheet is re-read again so every later row-number-based write in
//      this pass uses post-deletion numbers.
//   2. Identity/status columns (System, Ник, Telegram, Статус регистрации)
//      of an EXISTING row are rewritten only when they actually changed --
//      never the operational columns to their right.
//   3. One row is appended per operational player missing from the sheet,
//      identity from ReRaise, operational columns at the natural defaults a
//      brand-new row gets at initial table creation.
// Never rebuilds the tab and never touches an operational cell of a
// remaining player. A failed removal is logged and left for the next pass
// (staleRowsPending) -- steps 2/3 then run against the unmodified snapshot.
async function syncRosterToSheetWithSnapshot(
  tournament: Tournament,
  initialSnapshot: FreeSheetSnapshot
): Promise<RosterSyncOutcome> {
  const tabName = tournament.google_sheet_tab_name?.trim();
  if (!tabName) {
    return {
      result: { appended: 0, identityUpdated: 0, removed: 0, staleRowsPending: 0 },
      snapshot: initialSnapshot,
    };
  }

  const layout = getFreeSheetColumnLayout(tournament.tournament_type);
  let exportData = await getTournamentSheetExportData(tournament.id);
  let snapshot: FreeSheetSnapshot = initialSnapshot;
  let removed = 0;
  let staleRowsPending = 0;

  const operationalIds = () => new Set(exportData.rows.map((row) => row.player_id));

  if (findStaleRosterRowNumbers(snapshot, operationalIds()).length > 0) {
    const fresh = await readAndParseFreeTournamentSheet(tournament);
    if (!fresh.ok) {
      staleRowsPending = findStaleRosterRowNumbers(snapshot, operationalIds()).length;
    } else {
      snapshot = fresh;
      exportData = await getTournamentSheetExportData(tournament.id);
      const staleRowNumbers = findStaleRosterRowNumbers(snapshot, operationalIds());

      if (staleRowNumbers.length > 0) {
        let deleted = false;
        try {
          await deleteSpreadsheetTabRows(tabName, staleRowNumbers, FREE_SHEET_FIRST_DATA_ROW_NUMBER);
          deleted = true;
        } catch (error) {
          staleRowsPending = staleRowNumbers.length;
          logSyncError("failed to remove stale roster rows -- retried next pass", {
            tournamentId: tournament.id,
            tabName,
            rows: staleRowNumbers.length,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        if (deleted) {
          removed = staleRowNumbers.length;
          const afterDelete = await readAndParseFreeTournamentSheet(tournament);
          if (!afterDelete.ok) {
            return {
              result: { appended: 0, identityUpdated: 0, removed, staleRowsPending: 0 },
              snapshot: null,
            };
          }
          snapshot = afterDelete;
        }
      }
    }
  }

  const lastColumnLetter = columnIndexToLetter(layout.headers.length - 1);
  const valueUpdates: { range: string; values: SheetCellValue[][] }[] = [];
  const newRows: SheetCellValue[][] = [];
  const nextRowNumber = FREE_SHEET_FIRST_DATA_ROW_NUMBER + snapshot.dataRowCount;
  let identityUpdated = 0;

  for (const rosterRow of exportData.rows) {
    const sheetRow = snapshot.rows.get(rosterRow.player_id);
    const expectedUsername = rosterRow.username ?? "";
    const expectedTelegram = rosterRow.username ? `@${rosterRow.username}` : "";

    if (!sheetRow) {
      newRows.push([
        rosterRow.player_id,
        expectedUsername,
        rosterRow.display_name,
        expectedTelegram,
        rosterRow.registration_status,
        false,
        false,
        "",
        0,
        0,
        0,
        0,
        ...(layout.bossKnockoutsIndex != null ? [0] : []),
        ...(layout.mysteryBountyPointsIndex != null ? [0] : []),
        "",
        rosterRow.rating_points ?? "",
        false,
        "",
      ]);
      continue;
    }

    if (
      sheetRow.raw_system !== expectedUsername ||
      sheetRow.raw_display_name !== rosterRow.display_name ||
      sheetRow.raw_telegram !== expectedTelegram ||
      sheetRow.raw_status !== rosterRow.registration_status
    ) {
      valueUpdates.push({
        range: `${tabName}!B${sheetRow.rowNumber}:E${sheetRow.rowNumber}`,
        values: [[expectedUsername, rosterRow.display_name, expectedTelegram, rosterRow.registration_status]],
      });
      identityUpdated++;
    }
  }

  if (newRows.length > 0) {
    valueUpdates.push({
      range: `${tabName}!A${nextRowNumber}:${lastColumnLetter}${nextRowNumber + newRows.length - 1}`,
      values: newRows,
    });
  }

  if (valueUpdates.length > 0) {
    await batchUpdateSpreadsheetValues(valueUpdates);
  }

  if (newRows.length > 0) {
    await applyNewRosterRowsFormatting(
      tabName,
      nextRowNumber,
      newRows.length,
      layout.headers.length,
      [layout.eliminatedIndex]
    );
  }

  return {
    result: { appended: newRows.length, identityUpdated, removed, staleRowsPending },
    snapshot,
  };
}

// Public entry point -- see syncRosterToSheetWithSnapshot for the full
// contract. `parsedRows`/`dataRowCount` (and, when available,
// `rowNumbersByPlayerId`) come from the SAME read already performed by the
// caller (see readAndParseFreeTournamentSheet); additional reads happen only
// when stale rows actually have to be removed.
export async function syncTournamentRosterToSheet(
  tournament: Tournament,
  parsedRows: Map<string, NormalizedFreeSheetRow>,
  dataRowCount: number,
  rowNumbersByPlayerId?: Map<string, number[]>
): Promise<RosterSyncResult> {
  const outcome = await syncRosterToSheetWithSnapshot(tournament, {
    rows: parsedRows,
    dataRowCount,
    rowNumbersByPlayerId,
  });
  return outcome.result;
}

export type OperationalRosterSheetSyncResult = RosterSyncResult & { synced: boolean };

// Immediate, best-effort operational-roster push for an explicit staff
// roster action (features/tournament-roster-actions.ts "Не пришёл"): runs
// AFTER the Postgres transaction committed, so the no-show row disappears
// from the sheet (and a just-promoted player's row appears) without waiting
// for the next poll. THROWS when the cleanup could not be completed (sheet
// unreadable, deletion failed) so the caller can surface a warning -- the
// Postgres action itself is never affected, and the periodic reconciler
// (reconcileTournamentFromSheet) self-heals on its next pass. A tournament
// that isn't GS-operated (not free, completed, no linked tab) is a no-op.
export async function syncOperationalRosterToSheet(
  tournamentId: string
): Promise<OperationalRosterSheetSyncResult> {
  const tournament = await getTournamentById(tournamentId);
  if (
    tournament.kind !== "free" ||
    tournament.status === "completed" ||
    !tournament.google_sheet_tab_name?.trim()
  ) {
    return { synced: false, appended: 0, identityUpdated: 0, removed: 0, staleRowsPending: 0 };
  }

  const readResult = await readAndParseFreeTournamentSheet(tournament);
  if (!readResult.ok) {
    throw new Error(`Google Sheet roster sync failed: ${readResult.reason}`);
  }

  const outcome = await syncRosterToSheetWithSnapshot(tournament, readResult);
  if (outcome.result.staleRowsPending > 0) {
    throw new Error("Google Sheet roster sync failed: stale rows could not be removed");
  }
  return { synced: true, ...outcome.result };
}

export type ReconcileTournamentResult =
  | { skipped: true; reason: string }
  | ({ skipped: false; promotedPlayerIds: string[] } & LiveFieldSyncResult &
      RosterSyncResult &
      PlacementSyncResult);

// The single reconciliation pass for ONE tournament -- reads the sheet
// once, then reuses that snapshot for roster sync, live-field sync, AND
// derived-placement sync. This is the function the background poller
// calls per tournament (see runTournamentSheetSyncPass), and the function
// tests call directly.
export async function reconcileTournamentFromSheet(
  tournamentId: string
): Promise<ReconcileTournamentResult> {
  const tournament = await getTournamentById(tournamentId);

  if (
    tournament.kind !== "free" ||
    tournament.status === "completed" ||
    !tournament.google_sheet_tab_name?.trim()
  ) {
    return { skipped: true, reason: "not eligible for GS live-sync" };
  }

  const readResult = await readAndParseFreeTournamentSheet(tournament);
  if (!readResult.ok) {
    return { skipped: true, reason: readResult.reason };
  }

  // "Eligible" = registered/attended (excludes waitlist, matches
  // getTournamentResultsDraft's existing semantics) -- a waitlisted
  // player may be visible in the sheet but must never become a live
  // player merely because someone edited their row.
  const draftRoster = await getTournamentResultsDraft(tournamentId);
  const eligiblePlayerIds = new Set(draftRoster.map((row) => row.player_id));

  const liveResult = await applyLiveFieldsFromSheetSnapshot(
    tournamentId,
    readResult.rows,
    eligiblePlayerIds
  );

  // Seat capacity, every tick, unconditionally (not only when this tick saw
  // an elimination) -- so state that predates this code, or a promotion
  // that failed transiently elsewhere, self-heals on the next poll.
  // Eliminations applied just above already reconciled once each; this
  // extra call is an idempotent no-op in that case.
  const reconciliation = await reconcileTournamentWaitlistCapacity(tournamentId);

  // Same-pass catch-up for newly-promoted players, reusing the SAME parsed
  // snapshot (no second sheet read): they weren't in eligiblePlayerIds a
  // moment ago, but their sheet row may already carry operational state
  // (e.g. Пришёл ticked by an operator while they waited). Applying it now
  // means a promoted player is fully live this tick instead of ~15s later.
  // Anyone promoted as a side effect of THIS catch-up (a promoted player
  // already marked Выбыл frees their seat again) gets the same treatment on
  // the next tick -- the generic eligiblePlayerIds path above.
  if (reconciliation.promotedPlayerIds.length > 0) {
    const promotedLiveResult = await applyLiveFieldsFromSheetSnapshot(
      tournamentId,
      readResult.rows,
      new Set(reconciliation.promotedPlayerIds)
    );
    liveResult.attendanceChanges += promotedLiveResult.attendanceChanges;
    liveResult.eliminationChanges += promotedLiveResult.eliminationChanges;
    liveResult.rebuyChanges += promotedLiveResult.rebuyChanges;
    liveResult.unEliminatedPlayerIds.push(...promotedLiveResult.unEliminatedPlayerIds);
  }

  // Runs AFTER reconciliation, so the operational roster it pushes is the
  // post-promotion one: a promoted player's row is appended (or an existing
  // row's B:E identity/status range rewritten -- never an operational
  // cell), and rows of players who left the operational roster (no-show,
  // cancellation, removal, ordinary waitlist) are deleted by exact
  // player_id. Returns the snapshot whose row numbers are valid AFTER any
  // deletion -- every row-number-based write below must use it.
  const rosterOutcome = await syncRosterToSheetWithSnapshot(tournament, readResult);
  const rosterResult = rosterOutcome.result;

  // Recomputed fresh from CURRENT state every tick (not only when this
  // tick's own eliminationChanges > 0) -- a late arrival elsewhere in the
  // same pass already shifted fieldSize by the time this runs, and an
  // already-eliminated player's place must shift with it with no separate
  // click required (see syncDerivedPlacementToSheet's doc comment).
  // Re-read eligibility after reconciliation so promoted players are
  // included in derived-placement sync.
  const postReconcileEligiblePlayerIds =
    reconciliation.promotedPlayerIds.length > 0
      ? new Set((await getTournamentResultsDraft(tournamentId)).map((row) => row.player_id))
      : eligiblePlayerIds;

  // Rows were deleted but the follow-up read failed: no row-number-based
  // write this pass (the numbers are unknown); the next pass catches up.
  const placementResult = rosterOutcome.snapshot
    ? await syncDerivedPlacementToSheet(
        tournament,
        rosterOutcome.snapshot.rows,
        postReconcileEligiblePlayerIds,
        liveResult.unEliminatedPlayerIds
      )
    : { placesUpdated: 0 };

  return {
    skipped: false,
    promotedPlayerIds: reconciliation.promotedPlayerIds,
    ...liveResult,
    ...rosterResult,
    ...placementResult,
  };
}

// Called on every poller tick. One broken tournament's sheet must never
// stop reconciliation of the others -- each tournament is wrapped in its
// own try/catch.
export async function runTournamentSheetSyncPass(): Promise<void> {
  const tournaments = await getActiveFreeTournamentsWithSheet();

  for (const tournament of tournaments) {
    try {
      await reconcileTournamentFromSheet(tournament.id);
    } catch (error) {
      logSyncError("tournament reconciliation failed", {
        tournamentId: tournament.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export type EliminationWriteThroughResult = {
  eliminated: boolean;
  eliminated_at: string | null;
  place: number | null;
};

// The ReRaise admin elimination checkbox's actual write path (see
// app/api/admin/tournaments/[id]/eliminate/route.ts). For a GS-linked
// ACTIVE free tournament, Google Sheets owns "Выбыл" -- so an elimination
// click that only wrote Postgres would get silently reverted by the next
// ~15s poller tick, which would see the sheet still disagreeing and
// "correct" Postgres back. To keep the checkbox useful as authoritative
// input rather than fighting the sheet, this writes the ONE Выбыл cell
// through to the sheet FIRST (so the sheet and Postgres agree the moment
// this returns), then applies the exact same authoritative
// setTournamentPlayerElimination the sheet-driven path uses, then runs the
// SAME derived-placement sync so the admin UI's returned `place` always
// comes from the one shared algorithm (lib/tournament-placement.ts) --
// never a second calculator.
//
// For a tournament with no linked sheet, or a completed one, this
// preserves the exact prior direct-Postgres behavior (no sheet read, no
// sheet write) -- see the eliminate route.
//
// Best-effort on the sheet side by default: if the sheet can't be read
// (transient Google API failure) or this player's row isn't present in it
// this moment, the write-through and placement sync are skipped, but the
// Postgres elimination itself still applies -- an admin action must not
// be blocked by a Sheets hiccup. The very next poller tick will reconcile
// whatever the sheet says at that point, same fail-open philosophy as the
// rest of this module.
//
// `options.failClosedOnSheetWrite` flips that for the dedicated "Вернуть в
// игру" correction action (see app/api/admin/tournaments/[id]/return-to-game/
// route.ts): un-eliminating a player only in Postgres while GS still says
// Выбыл=true is worse than doing nothing, because the very next ~15s poller
// tick would see that exact disagreement and "helpfully" re-eliminate the
// player, silently undoing the correction. In that mode, any required-but-
// failed sheet interaction throws instead of logging-and-continuing, so
// Postgres is never touched and the caller gets a clear error. The ordinary
// checkbox path (eliminated: false | true from the results screen) never
// sets this flag, so its behavior above is completely unchanged.
export async function setTournamentPlayerEliminationThroughSheet(
  tournamentId: string,
  playerId: string,
  eliminated: boolean,
  options: { failClosedOnSheetWrite?: boolean } = {}
): Promise<EliminationWriteThroughResult> {
  const tournament = await getTournamentById(tournamentId);
  const failClosed = options.failClosedOnSheetWrite ?? false;

  const isGsActive =
    tournament.kind === "free" &&
    tournament.status !== "completed" &&
    !!tournament.google_sheet_tab_name?.trim();

  // Sheet write-through only for a GS-linked active tournament -- a
  // tournament with no sheet, or a completed one, keeps the exact prior
  // direct-Postgres behavior below (no sheet read, no sheet write).
  const readResult = isGsActive ? await readAndParseFreeTournamentSheet(tournament) : null;

  if (isGsActive && failClosed && !readResult?.ok) {
    throw new Error("Не удалось прочитать Google Таблицу — попробуйте ещё раз");
  }

  // Returning a player needs a free seat. Refuse BEFORE touching the sheet
  // (an un-elimination we then couldn't apply in Postgres would leave the
  // sheet saying "in play" for a player Postgres still has eliminated).
  // Advisory only -- setTournamentPlayerElimination re-checks under the
  // tournament-row lock and stays authoritative.
  if (!eliminated && isGsActive) {
    await assertTournamentSeatAvailableForReturn(tournamentId, playerId);
  }

  let sheetCellWritten: { range: string } | null = null;

  if (readResult?.ok) {
    const sheetRow = readResult.rows.get(playerId);

    if (failClosed && !sheetRow) {
      throw new Error("Игрок не найден в текущей строке Google Таблицы");
    }

    if (sheetRow && sheetRow.eliminated !== eliminated) {
      const tabName = tournament.google_sheet_tab_name!.trim();
      const layout = getFreeSheetColumnLayout(tournament.tournament_type);
      const range = `${tabName}!${columnIndexToLetter(layout.eliminatedIndex)}${sheetRow.rowNumber}`;
      try {
        await batchUpdateSpreadsheetValues([{ range, values: [[eliminated]] }]);
        sheetCellWritten = { range };
      } catch (error) {
        logSyncError("elimination write-through to sheet failed", {
          tournamentId,
          playerId,
          failClosed,
          error: error instanceof Error ? error.message : String(error),
        });
        if (failClosed) {
          throw new Error("Не удалось обновить Google Таблицу — попробуйте ещё раз");
        }
        // fail-open (default): Postgres still applies below.
      }
    }
  }

  let result: { eliminated: boolean; eliminated_at: string | null };
  try {
    result = await setTournamentPlayerElimination(tournamentId, playerId, eliminated);
  } catch (error) {
    // Lost a race for the last seat between the advisory pre-check and the
    // locked check: best-effort put the sheet's Выбыл cell back so the two
    // systems agree again, then surface the original error.
    if (error instanceof TournamentSeatUnavailableError && sheetCellWritten) {
      try {
        await batchUpdateSpreadsheetValues([
          { range: sheetCellWritten.range, values: [[!eliminated]] },
        ]);
      } catch (revertError) {
        logSyncError("failed to revert Выбыл cell after seat rejection", {
          tournamentId,
          playerId,
          error: revertError instanceof Error ? revertError.message : String(revertError),
        });
      }
    }
    throw error;
  }

  // The derived place itself is a pure Postgres computation -- always
  // returned regardless of GS linkage, so the ReRaise admin UI never needs
  // its own calculator (see lib/tournament-placement.ts). Only the SHEET
  // write-back of Место/Время выбытия additionally requires a successful
  // sheet read this call.
  if (readResult?.ok) {
    const draftRoster = await getTournamentResultsDraft(tournamentId);
    const eligiblePlayerIds = new Set(draftRoster.map((row) => row.player_id));

    await syncDerivedPlacementToSheet(
      tournament,
      readResult.rows,
      eligiblePlayerIds,
      eliminated ? [] : [playerId]
    );
  }

  const places = await getDerivedEliminationPlaces(tournamentId);
  return { ...result, place: places.get(playerId) ?? null };
}

// "Исправить порядок выбывания" (see app/api/admin/tournaments/[id]/
// reorder-eliminations/route.ts): the admin correction for a wrong
// elimination ORDER when every affected player genuinely is eliminated,
// only in the wrong sequence. All the actual validation/reassignment logic
// (including the stale-client-list rejection) lives in the single canonical
// features/tournaments.ts::reorderTournamentEliminations -- this wrapper's
// only job is pushing the recomputed Место/Время выбытия to Google Sheets
// afterward, the same way every other write in this module does.
//
// No `Выбыл` checkbox is touched here (every player in `orderedPlayerIds`
// stays eliminated=true in both systems), so unlike
// setTournamentPlayerEliminationThroughSheet's failClosedOnSheetWrite mode,
// there is no scenario where the next poller tick could "undo" this
// correction -- Postgres's eliminated_at is already authoritative and
// correct the moment reorderTournamentEliminations resolves; the sheet push
// below is a best-effort convenience, and a failure here just means the
// very next ~15s poll (or the next manual "Синхронизировать сейчас") writes
// the same already-correct derived cells instead.
export async function reorderTournamentEliminationsThroughSheet(
  tournamentId: string,
  orderedPlayerIds: string[]
): Promise<ReorderEliminationsResult> {
  const tournament = await getTournamentById(tournamentId);

  if (tournament.status === "completed") {
    return { ok: false, error: "Турнир завершён" };
  }

  const reorderResult = await reorderTournamentEliminations(tournamentId, orderedPlayerIds);
  if (!reorderResult.ok) {
    return reorderResult;
  }

  const isGsActive = tournament.kind === "free" && !!tournament.google_sheet_tab_name?.trim();
  if (isGsActive) {
    const readResult = await readAndParseFreeTournamentSheet(tournament);
    if (readResult.ok) {
      const draftRoster = await getTournamentResultsDraft(tournamentId);
      const eligiblePlayerIds = new Set(draftRoster.map((row) => row.player_id));
      await syncDerivedPlacementToSheet(tournament, readResult.rows, eligiblePlayerIds, []);
    }
  }

  return { ok: true };
}

export type AdmissionSheetSyncResult = {
  // false when there was nothing to do (not GS-active, already in sync,
  // the player isn't a currently-admitted arrived seat-holder) or the
  // sheet couldn't be read/located; never throws for those.
  arrivedWritten: boolean;
};

// Mirrors a staff "Допустить в игру" admission into the linked sheet,
// right after it committed in Postgres (features/tournament-roster-actions.ts):
//   1. the roster sync (same operational roster sync the poller runs)
//      appends the admitted player's row (waitlist/no-show rows are not in
//      the operational sheet, so it is normally missing) or rewrites an
//      existing row's Статус регистрации to registered;
//   2. the Пришел cell is set TRUE -- otherwise the very next poll would
//      see the now-eligible row still saying Пришел=FALSE and "correct"
//      Postgres back to arrived=false.
// Registration status stays strictly ReRaise -> Sheet; nothing here reads a
// status back. Everything written is DERIVED from current Postgres state
// (the player must currently be a registered/attended seat-holder with
// tournament_attendance.arrived = true), so calling this when that isn't
// true writes nothing. If a poll slips in between the admission commit and
// this write, it may briefly mirror arrived=false; the next poll after this
// write restores arrived=true (self-healing within one tick).
export async function syncAdmittedPlayerToSheet(
  tournamentId: string,
  playerId: string
): Promise<AdmissionSheetSyncResult> {
  const tournament = await getTournamentById(tournamentId);
  const tabName = tournament.google_sheet_tab_name?.trim();
  if (tournament.kind !== "free" || tournament.status === "completed" || !tabName) {
    return { arrivedWritten: false };
  }

  const [draftRoster, attendance] = await Promise.all([
    getTournamentResultsDraft(tournamentId),
    getTournamentAttendance(tournamentId),
  ]);
  if (
    !draftRoster.some((row) => row.player_id === playerId) ||
    attendance.get(playerId)?.arrived !== true
  ) {
    return { arrivedWritten: false };
  }

  const readResult = await readAndParseFreeTournamentSheet(tournament);
  if (!readResult.ok) {
    return { arrivedWritten: false };
  }

  // Same operational roster sync as the poller (stale rows removed, the
  // admitted player's row appended or its status rewritten). Its returned
  // snapshot already reflects any deletion; an append needs one more read
  // to learn the appended row's number.
  const rosterOutcome = await syncRosterToSheetWithSnapshot(tournament, readResult);
  let rowsAfterSync = rosterOutcome.snapshot?.rows ?? null;
  if (rowsAfterSync === null || rosterOutcome.result.appended > 0) {
    const reread = await readAndParseFreeTournamentSheet(tournament);
    if (!reread.ok) {
      return { arrivedWritten: false };
    }
    rowsAfterSync = reread.rows;
  }

  const sheetRow = rowsAfterSync.get(playerId);
  if (!sheetRow || sheetRow.arrived) {
    return { arrivedWritten: false };
  }

  // Column position comes from the one shared layout (never a new column).
  const layout = getFreeSheetColumnLayout(tournament.tournament_type);
  const arrivedIndex = layout.headers.indexOf("Пришел");
  await batchUpdateSpreadsheetValues([
    {
      range: `${tabName}!${columnIndexToLetter(arrivedIndex)}${sheetRow.rowNumber}`,
      values: [[true]],
    },
  ]);
  return { arrivedWritten: true };
}
