// Single authoritative server-side elimination placement algorithm. Used
// by the Google Sheets live-sync (features/tournament-sheet-sync.ts), the
// ReRaise admin elimination action (features/tournaments.ts's
// getDerivedEliminationPlaces), tournament completion, and the Poker Clock
// integration contract (IntegrationPlayer.place) -- there is deliberately
// no second place calculator anywhere in the app.
//
// Rule: only players with tournament_attendance.arrived === true count
// toward the current field size (never total sheet rows, never total
// registrations, never waitlist). Eliminated players are ordered by their
// authoritative tournament_player_eliminations.eliminated_at (never a
// manually-entered Google Sheet timestamp) -- earliest elimination is the
// worst place. For fieldSize N: 1st eliminated -> place N, 2nd -> N-1, ...
//
// Because fieldSize is recomputed fresh every call from CURRENT attendance
// state, an eliminated player's place is a derived value, not a stored
// fact -- it naturally shifts when a later arrival grows the field, or
// shrinks back when an arrival is corrected. Callers must always recompute
// from current state; nothing here is cached.
export type EliminationOrderEntry = {
  player_id: string;
  eliminated_at: string;
};

// Simultaneous eliminations: the background poller only detects Google
// Sheets changes on its own ~15s cadence, so two players who both bust
// within the same window get eliminated_at values assigned by
// setTournamentPlayerElimination at whatever moment each write actually
// lands server-side -- not the real-world order they busted in Google
// Sheets. This is a known, documented latency limitation of the polling
// mechanism (see features/tournament-sheet-sync.ts), not something this
// function can correct after the fact. When two entries carry the exact
// same timestamp (or one is missing/unparsable), the tie-break below falls
// back to player_id so the result is at least deterministic and stable
// across repeated calls, rather than depending on Map/array iteration
// order.
export function computeDerivedEliminationPlaces(
  fieldSize: number,
  eliminatedPlayers: EliminationOrderEntry[]
): Map<string, number> {
  const places = new Map<string, number>();

  if (fieldSize <= 0) {
    return places;
  }

  const sorted = [...eliminatedPlayers].sort((a, b) => {
    const diff = new Date(a.eliminated_at).getTime() - new Date(b.eliminated_at).getTime();
    if (diff !== 0) {
      return diff;
    }
    return a.player_id.localeCompare(b.player_id);
  });

  sorted.forEach((entry, index) => {
    places.set(entry.player_id, fieldSize - index);
  });

  return places;
}
