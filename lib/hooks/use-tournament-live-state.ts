import { useEffect, useMemo, useState } from "react";
import type { TournamentLiveSummary } from "@/types/poker-clock-live-state";

// One centralized poll for every tournament card on the page, not a
// setInterval per card -- the home page shows at most a handful of open
// tournaments at once (see getVisibleOpenTournamentsForPlayer), so a single
// batched request every POLL_INTERVAL_MS is the minimal reasonable design.
const POLL_INTERVAL_MS = 20000;

type LiveStateMap = Record<string, TournamentLiveSummary>;

// Poker Clock must never become a dependency for the home page. A poll that
// fails outright (network error, non-2xx) or that comes back without data
// for a given tournament id keeps whatever was last known for that id
// instead of flashing the card back to its pre-start state -- on first
// mount there is nothing to fall back to, so it correctly shows the normal
// pre-start Re-Raise card until/unless a poll actually succeeds.
export function useTournamentLiveState(tournamentIds: string[]): LiveStateMap {
  const idsKey = tournamentIds.join(",");
  // Raw accumulator across every id ever polled this session; never reset
  // synchronously from an effect (that cascades renders) -- instead the
  // returned map below just filters it down to the ids currently requested.
  const [rawState, setRawState] = useState<LiveStateMap>({});

  useEffect(() => {
    if (!idsKey) return;

    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch(
          `/api/tournaments/live-state?ids=${encodeURIComponent(idsKey)}`,
          { cache: "no-store" }
        );
        if (!response.ok || cancelled) return;

        const data = (await response.json()) as {
          results?: LiveStateMap;
        };
        if (cancelled || !data.results) return;

        const results = data.results;
        setRawState((previous) => {
          const next = { ...previous };
          for (const id of idsKey.split(",")) {
            const incoming = results[id];
            if (!incoming) continue;
            const prior = previous[id];
            next[id] = {
              clock: incoming.clock ?? prior?.clock ?? null,
              attendance: incoming.attendance ?? prior?.attendance ?? null,
              lateRegistration: incoming.lateRegistration ?? prior?.lateRegistration ?? null,
            };
          }
          return next;
        });
      } catch {
        // Swallow -- keep whatever was last shown, see doc comment above.
      }
    }

    void poll();
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [idsKey]);

  return useMemo(() => {
    if (!idsKey) return {};

    const filtered: LiveStateMap = {};
    for (const id of idsKey.split(",")) {
      const entry = rawState[id];
      if (entry) filtered[id] = entry;
    }
    return filtered;
  }, [idsKey, rawState]);
}
