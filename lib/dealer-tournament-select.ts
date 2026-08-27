import type { Tournament } from "@/types/domain";

// "Начать смену" tournament options -- a completed tournament can't be the
// one a dealer is currently working, so it's excluded from THIS selector
// only. Uses the canonical tournament.status field (never inferred from
// start_at/a date comparison). Preserves the existing order of the
// remaining tournaments (filter only, no re-sort). Deliberately NOT used
// for the completed-shift correction selector -- Super Admin must still be
// able to view/reference a shift's actual (often completed) tournament
// there; "Без турнира" itself is a static option rendered by the select
// component regardless of this list, so it's unaffected either way.
export function filterStartableTournaments(tournaments: Tournament[]): Tournament[] {
  return tournaments.filter((t) => t.status !== "completed");
}
