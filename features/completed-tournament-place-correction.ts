import "server-only";

import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { players, results, tournaments } from "@/lib/db/schema";
import { assertServerActorRole } from "@/lib/admin-auth";
import { TournamentNotFoundError } from "@/lib/tournament-errors";
import { syncPlayerAchievements } from "@/features/achievements";
import { batchUpdateSpreadsheetValues, readSpreadsheetTabValues } from "@/lib/google-sheets";
import { getFreeSheetColumnLayout, parseFreeSheetValues } from "@/lib/tournament-sheet-parsing";
import type { TournamentType } from "@/types/domain";

// "Исправить места" -- Super Admin correction of finishing places for an
// ALREADY-COMPLETED tournament. A separate path from the LIVE
// "Исправить порядок выбывания" / "Вернуть в игру" features
// (features/tournaments.ts::reorderTournamentEliminations and friends),
// which apply only to tournaments that are still in play and are not
// touched by this module.
//
// WHAT IT CHANGES
// ---------------
// Only `results.place`, `results.itm_points` and `results.rating_points`,
// and only on rows whose place actually changes. Every other column
// (participation/knockout/boss-bounty/mystery points, reentries, knockouts,
// addons, boss knockouts, free reentries, arrived, club discount) stays
// exactly as frozen at completion. Rows are UPDATEd in place -- never
// deleted/recreated.
//
// RATING
// ------
// No rating formula is ever invoked (features/rating.ts /
// features/rating-v2.ts are deliberately not imported). The frozen ITM
// value belongs to the PLACE, not to the player: before any write we
// capture `frozenItmByPlace` (place -> itm_points as persisted), and a row
// moving into place N takes over place N's frozen ITM value. rating_points
// is then the plain sum of the row's (unchanged) frozen components plus its
// new ITM value, so results_rating_points_breakdown_check holds by
// construction. Since the submission is a permutation of the persisted
// places, total ITM and total rating across the tournament are unchanged.
//
// Legacy rows with a NULL breakdown component cannot be re-derived this
// way -- any such row involved in a change fails the whole correction
// closed (zero writes).
//
// UNIQUE(tournament_id, place)
// ----------------------------
// Swapping 7 <-> 8 with naive per-row UPDATEs would collide with the other
// row's still-current place mid-transaction. Writes are therefore two-phase:
// phase 1 moves every changed row to a distinct temporary place ABOVE every
// persisted place (maxPlace + 1, maxPlace + 2, ...), so a temporary value
// can never collide with an untouched row or with another temporary value.
// Phase 2 then writes each changed row's final place (plus itm/rating).
// Negative temporary places are NOT used: results_place_check (place > 0)
// is a non-deferrable row CHECK that Postgres evaluates on every UPDATE, so
// a negative interim value would abort the transaction.
//
// CONCURRENCY
// -----------
// Same Postgres-only transactional precedent as
// features/tournament-waitlist-capacity.ts / lib/player-merge.ts: the
// tournament row is locked FOR UPDATE first, then results are read, validated
// against the request (stale requests are rejected) and written within the
// same transaction. Achievement resync and the Google Sheets push happen
// only after commit and never roll the correction back.

export class CompletedPlaceCorrectionUnavailableError extends Error {
  constructor() {
    super("Completed tournament place correction requires DATABASE_PROVIDER=postgres");
    this.name = "CompletedPlaceCorrectionUnavailableError";
  }
}

// Any business-rule rejection (stale request, winner pinned, not completed,
// legacy NULL breakdown). Mapped to 409 by the route handler; always thrown
// before any write (or inside the transaction, rolling it back).
export class CompletedPlaceCorrectionRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompletedPlaceCorrectionRejectedError";
  }
}

export const NOT_COMPLETED_MESSAGE =
  "Этот турнир не завершён — используйте обычную корректировку порядка выбывания";
export const STALE_RESULTS_MESSAGE = "Список результатов устарел — обновите страницу и повторите";
export const WINNER_PINNED_MESSAGE = "Место №1 нельзя изменить";
export const LEGACY_BREAKDOWN_MESSAGE =
  "Для этого старого турнира нельзя безопасно автоматически пересчитать рейтинг. Требуется отдельная ручная корректировка.";

export type CompletedPlaceCorrectionRow = {
  player_id: string;
  place: number; // the NEW place being requested for this player
};

export type CompletedPlaceCorrectionChange = {
  player_id: string;
  display_name: string;
  old_place: number;
  new_place: number;
  itm_points: number;
  rating_points: number;
};

export type CompletedPlaceCorrectionResult = {
  changed: CompletedPlaceCorrectionChange[];
  sheet_sync_warning?: string;
};

type Executor = typeof db;

type TournamentInfo = {
  id: string;
  status: string;
  kind: string;
  tournamentType: string;
  googleSheetTabName: string | null;
};

type ResultRow = {
  id: string;
  playerId: string;
  place: number;
  mysteryBountyPoints: number;
  ratingPoints: number;
  participationPoints: number | null;
  knockoutPoints: number | null;
  bossBountyPoints: number | null;
  itmPoints: number | null;
};

type PlannedChange = {
  rowId: string;
  playerId: string;
  oldPlace: number;
  newPlace: number;
  itmPoints: number;
  ratingPoints: number;
};

function assertPostgresMode() {
  if (process.env.DATABASE_PROVIDER !== "postgres") {
    throw new CompletedPlaceCorrectionUnavailableError();
  }
}

const tournamentColumns = {
  id: tournaments.id,
  status: tournaments.status,
  kind: tournaments.kind,
  tournamentType: tournaments.tournamentType,
  googleSheetTabName: tournaments.googleSheetTabName,
};

// Pure validation + planning: given the persisted rows and the request,
// returns the list of rows that actually change place with their new
// itm/rating values, or throws CompletedPlaceCorrectionRejectedError.
// Performs no IO.
function planCorrection(
  persisted: ResultRow[],
  submitted: CompletedPlaceCorrectionRow[]
): PlannedChange[] {
  const stale = () => new CompletedPlaceCorrectionRejectedError(STALE_RESULTS_MESSAGE);

  const persistedByPlayer = new Map(persisted.map((row) => [row.playerId, row]));
  const persistedPlaces = new Set(persisted.map((row) => row.place));

  if (submitted.length !== persisted.length) throw stale();

  const seenPlayers = new Set<string>();
  const seenPlaces = new Set<number>();
  for (const row of submitted) {
    if (!Number.isInteger(row.place)) throw stale();
    if (!persistedByPlayer.has(row.player_id)) throw stale();
    if (seenPlayers.has(row.player_id)) throw stale();
    if (!persistedPlaces.has(row.place)) throw stale();
    if (seenPlaces.has(row.place)) throw stale();
    seenPlayers.add(row.player_id);
    seenPlaces.add(row.place);
  }
  // Equal lengths + every submitted player/place unique and known => the
  // submission is exactly the persisted player set and a permutation of the
  // persisted places.

  // Winner pinned: whoever holds place 1 now must still hold it, and nobody
  // else may be moved into it.
  const currentWinner = persisted.find((row) => row.place === 1);
  for (const row of submitted) {
    const wasWinner = currentWinner?.playerId === row.player_id;
    if (wasWinner !== (row.place === 1)) {
      throw new CompletedPlaceCorrectionRejectedError(WINNER_PINNED_MESSAGE);
    }
  }

  const persistedByPlace = new Map(persisted.map((row) => [row.place, row]));
  const moving = submitted.filter(
    (row) => persistedByPlayer.get(row.player_id)!.place !== row.place
  );

  // Legacy NULL-breakdown fail-closed check, over every row involved in a
  // change: the moving row itself, and the row whose frozen ITM value for
  // the target place is being reused (in a permutation that's always also a
  // moving row, but checked explicitly anyway).
  for (const row of moving) {
    const own = persistedByPlayer.get(row.player_id)!;
    const itmSource = persistedByPlace.get(row.place)!;
    if (
      own.participationPoints == null ||
      own.knockoutPoints == null ||
      own.bossBountyPoints == null ||
      own.itmPoints == null ||
      itmSource.itmPoints == null
    ) {
      throw new CompletedPlaceCorrectionRejectedError(LEGACY_BREAKDOWN_MESSAGE);
    }
  }

  // place -> frozen ITM value, captured from the pre-correction state.
  const frozenItmByPlace = new Map(persisted.map((row) => [row.place, row.itmPoints]));

  return moving.map((row) => {
    const own = persistedByPlayer.get(row.player_id)!;
    const itmPoints = frozenItmByPlace.get(row.place) as number;
    const ratingPoints =
      (own.participationPoints as number) +
      (own.knockoutPoints as number) +
      (own.bossBountyPoints as number) +
      own.mysteryBountyPoints +
      itmPoints;
    return {
      rowId: own.id,
      playerId: own.playerId,
      oldPlace: own.place,
      newPlace: row.place,
      itmPoints,
      ratingPoints,
    };
  });
}

export async function correctCompletedTournamentPlaces(
  tournamentId: string,
  rows: CompletedPlaceCorrectionRow[]
): Promise<CompletedPlaceCorrectionResult> {
  // Defense in depth: /api/admin/tournaments/:id/completed-place-correction
  // is also absent from lib/admin-permissions.ts's operator allowlist.
  await assertServerActorRole(["admin"]);
  assertPostgresMode();

  const [preCheck] = await db
    .select(tournamentColumns)
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId));
  if (!preCheck) {
    throw new TournamentNotFoundError(tournamentId);
  }
  if (preCheck.status !== "completed") {
    throw new CompletedPlaceCorrectionRejectedError(NOT_COMPLETED_MESSAGE);
  }

  const { tournament, changes, displayNames } = await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Executor;

    // Lock the tournament row FIRST -- same serialization point as every
    // other per-tournament transaction (features/tournament-row-lock.ts),
    // inlined here because we also need status/sheet info from the row.
    const [locked] = await tx
      .select(tournamentColumns)
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .for("update");
    if (!locked) {
      throw new TournamentNotFoundError(tournamentId);
    }
    if (locked.status !== "completed") {
      throw new CompletedPlaceCorrectionRejectedError(NOT_COMPLETED_MESSAGE);
    }

    const persisted: ResultRow[] = await tx
      .select({
        id: results.id,
        playerId: results.playerId,
        place: results.place,
        mysteryBountyPoints: results.mysteryBountyPoints,
        ratingPoints: results.ratingPoints,
        participationPoints: results.participationPoints,
        knockoutPoints: results.knockoutPoints,
        bossBountyPoints: results.bossBountyPoints,
        itmPoints: results.itmPoints,
      })
      .from(results)
      .where(eq(results.tournamentId, tournamentId));

    const planned = planCorrection(persisted, rows);
    if (planned.length === 0) {
      return { tournament: locked as TournamentInfo, changes: planned, displayNames: new Map() };
    }

    // Phase 1: park every changed row on a distinct temporary place above
    // every persisted place (maxPlace + 1, maxPlace + 2, ...), so phase 2
    // can never hit UNIQUE(tournament_id, place) against a row that hasn't
    // been moved yet. Not negative: results_place_check (place > 0) would
    // reject that on the UPDATE itself.
    const maxPlace = persisted.reduce((max, row) => Math.max(max, row.place), 0);
    let tempPlace = maxPlace;
    for (const change of planned) {
      tempPlace += 1;
      await tx.update(results).set({ place: tempPlace }).where(eq(results.id, change.rowId));
    }

    // Phase 2: final place + re-derived itm/rating (all other columns
    // untouched).
    for (const change of planned) {
      await tx
        .update(results)
        .set({
          place: change.newPlace,
          itmPoints: change.itmPoints,
          ratingPoints: change.ratingPoints,
        })
        .where(eq(results.id, change.rowId));
    }

    const nameRows = await tx
      .select({ id: players.id, displayName: players.displayName })
      .from(players)
      .where(inArray(players.id, planned.map((change) => change.playerId)));

    return {
      tournament: locked as TournamentInfo,
      changes: planned,
      displayNames: new Map(nameRows.map((row) => [row.id, row.displayName])),
    };
  });

  // --- After commit ---

  // Metric/derived achievements only. publishActivityEvents is left off
  // deliberately: the winner is pinned, so there is nothing new to announce,
  // and no tournament-winner / Activity Feed event is ever published here.
  for (const change of changes) {
    try {
      await syncPlayerAchievements(change.playerId);
    } catch (error) {
      console.error("[completed-place-correction] achievement resync failed", {
        tournamentId,
        playerId: change.playerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const result: CompletedPlaceCorrectionResult = {
    changed: changes.map((change) => ({
      player_id: change.playerId,
      display_name: displayNames.get(change.playerId) ?? "Игрок",
      old_place: change.oldPlace,
      new_place: change.newPlace,
      itm_points: change.itmPoints,
      rating_points: change.ratingPoints,
    })),
  };

  const sheetWarning = await syncCorrectedPlacesToSheet(tournament, changes);
  if (sheetWarning) {
    result.sheet_sync_warning = sheetWarning;
  }

  return result;
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

const SHEET_SYNC_WARNING =
  "Места исправлены, но Google-таблицу обновить не удалось — обновите её вручную";

// Best-effort: writes ONLY the Место and Рейтинг cells of the changed
// players' rows (matched by the sheet's Player ID column, never by
// position/name). Never throws; returns a warning string on failure.
async function syncCorrectedPlacesToSheet(
  tournament: TournamentInfo,
  changes: PlannedChange[]
): Promise<string | undefined> {
  const tabName = tournament.googleSheetTabName?.trim();
  if (!tabName || changes.length === 0) {
    return undefined;
  }

  // Only the free-tournament sheet layout is known/header-validated
  // (lib/tournament-sheet-parsing.ts); other kinds' sheets aren't touched.
  if (tournament.kind !== "free") {
    return "Места исправлены; Google-таблица этого типа турнира не обновляется автоматически";
  }

  try {
    const tournamentType = tournament.tournamentType as TournamentType;
    const values = await readSpreadsheetTabValues(tabName);
    const parsed = parseFreeSheetValues(values, tournamentType);
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }

    const layout = getFreeSheetColumnLayout(tournamentType);
    const placeColumn = columnIndexToLetter(layout.placeIndex);
    const ratingColumn = columnIndexToLetter(layout.ratingIndex);

    const updates: { range: string; values: (string | number)[][] }[] = [];
    const missing: string[] = [];
    for (const change of changes) {
      const sheetRow = parsed.rows.get(change.playerId);
      if (!sheetRow) {
        missing.push(change.playerId);
        continue;
      }
      updates.push({
        range: `${tabName}!${placeColumn}${sheetRow.rowNumber}`,
        values: [[change.newPlace]],
      });
      updates.push({
        range: `${tabName}!${ratingColumn}${sheetRow.rowNumber}`,
        values: [[change.ratingPoints]],
      });
    }

    if (updates.length > 0) {
      await batchUpdateSpreadsheetValues(updates);
    }

    if (missing.length > 0) {
      console.error("[completed-place-correction] players missing from sheet", {
        tournamentId: tournament.id,
        tabName,
        missing,
      });
      return SHEET_SYNC_WARNING;
    }
    return undefined;
  } catch (error) {
    console.error("[completed-place-correction] sheet sync failed", {
      tournamentId: tournament.id,
      tabName,
      error: error instanceof Error ? error.message : String(error),
    });
    return SHEET_SYNC_WARNING;
  }
}
