import { useEffect, useState } from "react";
import type { PublicActiveTournamentPlayer } from "@/types/poker-clock-live-state";

// Same ~20s polling cadence as use-tournament-live-state.ts, for the same
// reason: a single tournament's active-player list is cheap enough to poll
// on an interval rather than push, and 20s keeps this well away from
// "aggressive polling" territory.
const POLL_INTERVAL_MS = 20000;

// Only polls while `enabled` -- the caller gates this on "the В игре tab is
// actually open", so switching tabs or leaving the page stops the requests
// instead of polling a tab nobody is looking at.
export function useTournamentActivePlayers(
  tournamentId: string | null,
  enabled: boolean
): PublicActiveTournamentPlayer[] {
  const [players, setPlayers] = useState<PublicActiveTournamentPlayer[]>([]);

  useEffect(() => {
    if (!tournamentId || !enabled) return;

    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch(
          `/api/tournaments/${tournamentId}/active-players`,
          { cache: "no-store" }
        );
        if (!response.ok || cancelled) return;

        const data = (await response.json()) as {
          players?: PublicActiveTournamentPlayer[];
        };
        if (cancelled || !data.players) return;

        setPlayers(data.players);
      } catch {
        // Swallow -- keep whatever was last shown, same as the live-state poll.
      }
    }

    void poll();
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [tournamentId, enabled]);

  return players;
}
