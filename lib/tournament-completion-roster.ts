// Pure, framework-free -- importable from both the complete-free route
// handler (the authority) and the admin results page (an early, identical
// client-side check). Same pattern as lib/tournament-results-validation.ts.
//
// COMPLETION ROSTER AUTHORITY
// ---------------------------
// The submitted completion rows (`freeRows` on the admin results page, or
// a stale Google Sheet behind them) are NEVER the roster authority. The
// canonical set of participants who must have a result is derived
// server-side from Postgres: registrations with status registered/attended
// (getTournamentResultsDraft). Reconciling against it:
//   - a submitted row whose player is NOT canonical (ordinary waitlist,
//     quarantined no-show, cancelled/removed, unknown) is IGNORED -- it
//     never needs a place, never creates a result, never enters the rating
//     calculation and never counts toward field size;
//   - a canonical participant MISSING from the submitted rows FAILS CLOSED
//     (never silently omitted, no place is ever invented).
// Duplicate submitted rows for one player keep the first occurrence, so a
// canonical player can never produce two results.

export const COMPLETION_ROSTER_CHANGED_MESSAGE =
  "Данные участников изменились. Обновите таблицу и повторите завершение.";

export type CompletionRosterReconciliation<T extends { player_id: string }> =
  | {
      ok: true;
      // Submitted rows of canonical participants only, in submitted order.
      rows: T[];
      // Submitted rows ignored as non-canonical (stale waitlist/no-show/
      // cancelled rows), for logging/diagnostics only.
      ignoredPlayerIds: string[];
    }
  | {
      ok: false;
      message: string;
      missingPlayerIds: string[];
    };

export function reconcileCompletionRosterRows<T extends { player_id: string }>(
  submittedRows: readonly T[],
  canonicalPlayerIds: Iterable<string>
): CompletionRosterReconciliation<T> {
  const canonical = new Set(canonicalPlayerIds);
  const seen = new Set<string>();
  const rows: T[] = [];
  const ignoredPlayerIds: string[] = [];

  for (const row of submittedRows) {
    if (!canonical.has(row.player_id)) {
      ignoredPlayerIds.push(row.player_id);
      continue;
    }
    if (seen.has(row.player_id)) {
      continue;
    }
    seen.add(row.player_id);
    rows.push(row);
  }

  const missingPlayerIds = Array.from(canonical).filter((playerId) => !seen.has(playerId));
  if (missingPlayerIds.length > 0) {
    return { ok: false, message: COMPLETION_ROSTER_CHANGED_MESSAGE, missingPlayerIds };
  }

  return { ok: true, rows, ignoredPlayerIds };
}
