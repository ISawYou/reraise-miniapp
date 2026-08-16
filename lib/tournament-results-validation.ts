// Pure, framework-free -- importable from both server route
// handlers/features and client components (same pattern as
// features/rating-v2.ts). Single source of truth for "are these results'
// places sane" so the check isn't duplicated across the free/live
// completion flows or their client forms. The server-side call sites
// (features/tournaments.ts) are the actual source of truth; the client call
// sites (app/admin/results/[id]/page.tsx) exist purely so an admin sees the
// same error before ever sending the request.

export type ResultPlaceCandidate = {
  player_id: string;
  place: number;
  display_name?: string | null;
};

function labelFor(row: ResultPlaceCandidate): string {
  return row.display_name?.trim() || row.player_id;
}

function isValidPlace(place: number): boolean {
  return Number.isInteger(place) && place > 0;
}

// Human-readable issue lines (Russian), or an empty array when every place
// is a unique positive integer. Order: invalid places first, then duplicate
// places sorted ascending -- deterministic for tests/UI.
export function findResultPlaceIssues(rows: ResultPlaceCandidate[]): string[] {
  const issues: string[] = [];

  const invalidRows = rows.filter((row) => !isValidPlace(row.place));
  if (invalidRows.length > 0) {
    issues.push(
      `Некорректное место (должно быть целым числом больше 0) у игроков: ${invalidRows
        .map(labelFor)
        .join(", ")}.`
    );
  }

  const byPlace = new Map<number, ResultPlaceCandidate[]>();
  for (const row of rows) {
    if (!isValidPlace(row.place)) {
      continue;
    }

    const group = byPlace.get(row.place);
    if (group) {
      group.push(row);
    } else {
      byPlace.set(row.place, [row]);
    }
  }

  const duplicates = [...byPlace.entries()]
    .filter(([, group]) => group.length > 1)
    .sort(([placeA], [placeB]) => placeA - placeB);

  for (const [place, group] of duplicates) {
    issues.push(
      `Место ${place} указано у нескольких игроков: ${group.map(labelFor).join(", ")}.`
    );
  }

  return issues;
}

// Single formatted message for display (client error banner or server
// exception message) -- null when there's nothing to report.
export function describeResultPlaceIssues(rows: ResultPlaceCandidate[]): string | null {
  const issues = findResultPlaceIssues(rows);

  if (issues.length === 0) {
    return null;
  }

  return [...issues, "Исправьте места перед завершением турнира."].join(" ");
}

export class ResultPlaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResultPlaceValidationError";
  }
}

// Server-side entry point -- throws so callers (saveTournamentResults /
// completeTournamentFromLiveEntries) can rely on it as the single source of
// truth right before persisting, mirroring how the client uses
// describeResultPlaceIssues for the pre-submit check.
export function assertValidResultPlaces(rows: ResultPlaceCandidate[]): void {
  const message = describeResultPlaceIssues(rows);

  if (message) {
    throw new ResultPlaceValidationError(message);
  }
}
