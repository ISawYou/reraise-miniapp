import { describe, expect, it } from "vitest";
import { filterStartableTournaments } from "@/lib/dealer-tournament-select";
import type { Tournament, TournamentStatus } from "@/types/domain";

function tournament(id: string, status: TournamentStatus, startAt = "2026-08-01T18:00:00.000Z"): Tournament {
  return {
    id,
    title: `Tournament ${id}`,
    start_at: startAt,
    max_players: 20,
    kind: "free",
    tournament_type: "classic",
    season_id: null,
    status,
    created_at: "2026-01-01T00:00:00.000Z",
    rating_formula_version: "v2",
    rating_guarantee: null,
    is_final: false,
  };
}

describe("filterStartableTournaments (\"Начать смену\" tournament options)", () => {
  it("excludes a completed tournament", () => {
    const result = filterStartableTournaments([tournament("t1", "completed")]);
    expect(result).toEqual([]);
  });

  it("includes a non-completed tournament (open/closed/draft alike)", () => {
    const open = tournament("open", "open");
    const closed = tournament("closed", "closed");
    const draft = tournament("draft", "draft");

    const result = filterStartableTournaments([open, closed, draft]);

    expect(result.map((t) => t.id)).toEqual(["open", "closed", "draft"]);
  });

  it("uses the canonical status field, never infers completion from start_at (a past-dated but still-open tournament stays selectable)", () => {
    const pastButOpen = tournament("past-open", "open", "2020-01-01T00:00:00.000Z");

    const result = filterStartableTournaments([pastButOpen]);

    expect(result).toEqual([pastButOpen]);
  });

  it("preserves the existing order of the remaining tournaments (filter only, no re-sort)", () => {
    const list = [
      tournament("c1", "completed"),
      tournament("open-2", "open"),
      tournament("c2", "completed"),
      tournament("open-1", "open"),
    ];

    const result = filterStartableTournaments(list);

    expect(result.map((t) => t.id)).toEqual(["open-2", "open-1"]);
  });

  it("an empty tournaments list stays empty", () => {
    expect(filterStartableTournaments([])).toEqual([]);
  });
});
