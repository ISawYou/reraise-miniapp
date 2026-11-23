import { describe, expect, it } from "vitest";
import {
  buildCompletedResultsResponse,
  CompletedResultsNotReadyError,
  CompletedResultsUnavailableError,
  UnsupportedCompletedResultsTypeError,
} from "@/lib/completed-results";
import type { IntegrationCompletedResultRow } from "@/lib/repositories/result/ResultRepository";
import type { Tournament } from "@/types/domain";

const tournament = (overrides: Partial<Tournament> = {}): Tournament => ({
  id: "t1", title: "BOSS BOUNTY", start_at: "2026-10-01T18:00:00.000Z", max_players: 46,
  kind: "free", tournament_type: "boss_bounty", season_id: "season-1", status: "completed",
  created_at: "2026-10-01T17:00:00.000Z", rating_formula_version: "v2", rating_guarantee: null,
  placement_points_multiplier: 1, is_final: false, ...overrides,
});

const row = (overrides: Partial<IntegrationCompletedResultRow> = {}): IntegrationCompletedResultRow => ({
  player_id: "p1", display_name: "Winner", place: 1, rating_points: 250, knockouts: 4,
  boss_knockouts: 2, mystery_bounty_points: null, arrived: true, ...overrides,
});

describe("buildCompletedResultsResponse", () => {
  it("returns ordered official results and tournament-earned points", () => {
    const result = buildCompletedResultsResponse(tournament(), [
      row({ player_id: "p2", display_name: "Second", place: 2, rating_points: 7 }),
      row(),
      row({ player_id: "p3", display_name: "Third", place: 3, rating_points: 0, knockouts: 0, boss_knockouts: 0, mystery_bounty_points: 18 }),
    ]);
    expect(result.results.map((r) => [r.place, r.nickname, r.ratingPointsEarned])).toEqual([
      [1, "Winner", 250], [2, "Second", 7], [3, "Third", 0],
    ]);
    expect(result.participantsCount).toBe(3);
    expect(result.results[2]).toMatchObject({ knockouts: 0, bossKnockouts: 0, mysteryBountyPoints: 18 });
    expect(result.completedAt).toBeNull();
  });

  it("returns null rating points for non-rating tournaments", () => {
    const result = buildCompletedResultsResponse(tournament({ tournament_type: "qualification_final" }), [row({ rating_points: 0, boss_knockouts: 0, mystery_bounty_points: 0 })]);
    expect(result.ratingApplicable).toBe(false);
    expect(result.results[0].ratingPointsEarned).toBeNull();
    expect(result.results[0].bossKnockouts).toBe(0);
    expect(result.results[0].mysteryBountyPoints).toBe(0);
  });

  it("keeps participant count unknown when legacy arrived values contain NULL", () => {
    expect(buildCompletedResultsResponse(tournament(), [row({ arrived: null })]).participantsCount).toBeNull();
  });

  it("rejects missing or duplicated official winners", () => {
    expect(() => buildCompletedResultsResponse(tournament(), [row({ place: 2 })])).toThrow(CompletedResultsUnavailableError);
    expect(() => buildCompletedResultsResponse(tournament(), [row(), row({ player_id: "p2" })])).toThrow(CompletedResultsUnavailableError);
  });

  it("rejects unfinished and unsupported tournaments", () => {
    expect(() => buildCompletedResultsResponse(tournament({ status: "closed" }), [row()])).toThrow(CompletedResultsNotReadyError);
    expect(() => buildCompletedResultsResponse(tournament({ tournament_type: "not-real" as Tournament["tournament_type"] }), [row()])).toThrow(UnsupportedCompletedResultsTypeError);
  });
});
