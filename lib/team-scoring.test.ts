import { describe, expect, it } from "vitest";
import {
  attributeResultsToTeams,
  aggregateTeamTotals,
  aggregateMemberContributions,
  filterResultsForScope,
  rankByPointsDescending,
  findActiveMembershipAt,
  AmbiguousTeamMembershipError,
  type TeamScoringResultInput,
  type TeamMembershipInterval,
} from "@/lib/team-scoring";

function result(overrides: Partial<TeamScoringResultInput> = {}): TeamScoringResultInput {
  return {
    tournament_id: "t1",
    player_id: "p1",
    rating_points: 100,
    season_id: "s1",
    tournament_start_at: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

function membership(overrides: Partial<TeamMembershipInterval> = {}): TeamMembershipInterval {
  return {
    id: "m1",
    team_id: "team-a",
    player_id: "p1",
    joined_at: "2026-01-01T00:00:00.000Z",
    left_at: null,
    ...overrides,
  };
}

describe("temporal attribution -- exact spec scenario", () => {
  // A joins Team A at T10. Tournament at T05 -> 0 points to Team A.
  // Tournament at T15 -> points to Team A. A leaves Team A at T20.
  // A joins Team B at T30. Tournament at T18 -> Team A. Tournament at T25
  // -> no team. Tournament at T35 -> Team B.
  //
  // Real ISO timestamps standing in for T05/T10/etc, ordered identically.
  const T = {
    T05: "2026-01-05T00:00:00.000Z",
    T10: "2026-01-10T00:00:00.000Z",
    T15: "2026-01-15T00:00:00.000Z",
    T18: "2026-01-18T00:00:00.000Z",
    T20: "2026-01-20T00:00:00.000Z",
    T25: "2026-01-25T00:00:00.000Z",
    T30: "2026-01-30T00:00:00.000Z",
    T35: "2026-02-04T00:00:00.000Z",
  };
  const isoMemberships: TeamMembershipInterval[] = [
    { id: "m-a", team_id: "team-a", player_id: "A", joined_at: T.T10, left_at: T.T20 },
    { id: "m-b", team_id: "team-b", player_id: "A", joined_at: T.T30, left_at: null },
  ];

  it("tournament before joining (T05): 0 points to Team A -- no attribution at all", () => {
    const results = [result({ tournament_id: "t05", player_id: "A", tournament_start_at: T.T05 })];
    expect(attributeResultsToTeams(results, isoMemberships)).toEqual([]);
  });

  it("tournament during Team A membership (T15): attributed to Team A", () => {
    const results = [result({ tournament_id: "t15", player_id: "A", tournament_start_at: T.T15 })];
    const [attributed] = attributeResultsToTeams(results, isoMemberships);
    expect(attributed.team_id).toBe("team-a");
  });

  it("player leaves after tournament start but before completion (T18 < T20 leave): still Team A", () => {
    const results = [result({ tournament_id: "t18", player_id: "A", tournament_start_at: T.T18 })];
    const [attributed] = attributeResultsToTeams(results, isoMemberships);
    expect(attributed.team_id).toBe("team-a");
  });

  it("tournament in the gap between teams (T25): no team at all", () => {
    const results = [result({ tournament_id: "t25", player_id: "A", tournament_start_at: T.T25 })];
    expect(attributeResultsToTeams(results, isoMemberships)).toEqual([]);
  });

  it("tournament during Team B membership (T35): attributed to Team B, never retroactively Team A", () => {
    const results = [result({ tournament_id: "t35", player_id: "A", tournament_start_at: T.T35 })];
    const [attributed] = attributeResultsToTeams(results, isoMemberships);
    expect(attributed.team_id).toBe("team-b");
  });

  it("moving teams never rewrites history -- every already-attributed result keeps its original team", () => {
    const results = [
      result({ tournament_id: "t15", player_id: "A", tournament_start_at: T.T15, rating_points: 500 }),
      result({ tournament_id: "t35", player_id: "A", tournament_start_at: T.T35, rating_points: 300 }),
    ];
    const attributed = attributeResultsToTeams(results, isoMemberships);
    expect(attributed.find((r) => r.tournament_id === "t15")?.team_id).toBe("team-a");
    expect(attributed.find((r) => r.tournament_id === "t35")?.team_id).toBe("team-b");

    const totals = aggregateTeamTotals(attributed);
    expect(totals).toEqual(
      expect.arrayContaining([
        { team_id: "team-a", points: 500 },
        { team_id: "team-b", points: 300 },
      ])
    );
  });
});

describe("membership interval containment", () => {
  it("joined_at exactly at start_at counts (inclusive lower bound)", () => {
    const m = membership({ joined_at: "2026-01-15T00:00:00.000Z", left_at: null });
    expect(findActiveMembershipAt([m], "p1", "2026-01-15T00:00:00.000Z")).not.toBeNull();
  });

  it("left_at exactly at start_at does NOT count (exclusive upper bound)", () => {
    const m = membership({ joined_at: "2026-01-01T00:00:00.000Z", left_at: "2026-01-15T00:00:00.000Z" });
    expect(findActiveMembershipAt([m], "p1", "2026-01-15T00:00:00.000Z")).toBeNull();
  });

  it("no membership at all yields null, not an error", () => {
    expect(findActiveMembershipAt([], "p1", "2026-01-15T00:00:00.000Z")).toBeNull();
  });
});

describe("corrupted data -- ambiguous overlapping memberships fail loudly", () => {
  it("two simultaneously-active membership intervals for the same player throw instead of double-counting", () => {
    const overlapping: TeamMembershipInterval[] = [
      { id: "m1", team_id: "team-a", player_id: "p1", joined_at: "2026-01-01T00:00:00.000Z", left_at: null },
      { id: "m2", team_id: "team-b", player_id: "p1", joined_at: "2026-01-05T00:00:00.000Z", left_at: null },
    ];
    const results = [result({ player_id: "p1", tournament_start_at: "2026-01-10T00:00:00.000Z" })];

    expect(() => attributeResultsToTeams(results, overlapping)).toThrow(AmbiguousTeamMembershipError);
  });
});

describe("no rating recomputation -- rating_points is passed through as an opaque fact", () => {
  it("rating_points=0 stays exactly 0, never recalculated or dropped", () => {
    const results = [result({ rating_points: 0, tournament_start_at: "2026-01-10T00:00:00.000Z" })];
    const memberships = [membership({ joined_at: "2026-01-01T00:00:00.000Z" })];
    const attributed = attributeResultsToTeams(results, memberships);
    expect(attributed[0].rating_points).toBe(0);
    expect(aggregateTeamTotals(attributed)).toEqual([{ team_id: "team-a", points: 0 }]);
  });
});

describe("season scope filtering", () => {
  const results = [
    result({ tournament_id: "t1", season_id: "season-current", rating_points: 10 }),
    result({ tournament_id: "t2", season_id: "season-archive", rating_points: 20 }),
    result({ tournament_id: "t3", season_id: null, rating_points: 30 }),
  ];

  it("current-season scope only includes that season's results", () => {
    const filtered = filterResultsForScope(results, { kind: "season", seasonId: "season-current" });
    expect(filtered.map((r) => r.tournament_id)).toEqual(["t1"]);
  });

  it("archive scope is the identical mechanism with a different seasonId", () => {
    const filtered = filterResultsForScope(results, { kind: "season", seasonId: "season-archive" });
    expect(filtered.map((r) => r.tournament_id)).toEqual(["t2"]);
  });

  it("all-time includes every result regardless of season_id, including null", () => {
    const filtered = filterResultsForScope(results, { kind: "all_time" });
    expect(filtered).toHaveLength(3);
  });
});

describe("member contributions sum exactly to team total", () => {
  it("grouping by player never loses or double-counts a point", () => {
    const attributed = attributeResultsToTeams(
      [
        result({ tournament_id: "t1", player_id: "p1", rating_points: 100, tournament_start_at: "2026-01-10T00:00:00.000Z" }),
        result({ tournament_id: "t2", player_id: "p1", rating_points: 50, tournament_start_at: "2026-01-11T00:00:00.000Z" }),
        result({ tournament_id: "t3", player_id: "p2", rating_points: 75, tournament_start_at: "2026-01-10T00:00:00.000Z" }),
      ],
      [
        membership({ id: "m1", player_id: "p1", team_id: "team-a", joined_at: "2026-01-01T00:00:00.000Z" }),
        membership({ id: "m2", player_id: "p2", team_id: "team-a", joined_at: "2026-01-01T00:00:00.000Z" }),
      ]
    );

    const contributions = aggregateMemberContributions(attributed);
    const totals = aggregateTeamTotals(attributed);

    const teamATotal = totals.find((t) => t.team_id === "team-a")!.points;
    const sumOfContributions = contributions
      .filter((c) => c.team_id === "team-a")
      .reduce((sum, c) => sum + c.points, 0);

    expect(sumOfContributions).toBe(teamATotal);
    expect(teamATotal).toBe(225);
    expect(contributions).toEqual(
      expect.arrayContaining([
        { team_id: "team-a", player_id: "p1", points: 150 },
        { team_id: "team-a", player_id: "p2", points: 75 },
      ])
    );
  });

  it("former-member points remain attributed exactly like a current member's -- lib/team-scoring.ts never treats them differently; 'бывший участник' is a presentation-layer flag computed by the caller against CURRENT roster, not something this module tracks", () => {
    // p1 already left team-a (left_at set) by the time of aggregation, but
    // their historical result still attributes correctly.
    const attributed = attributeResultsToTeams(
      [result({ player_id: "p1", rating_points: 40, tournament_start_at: "2026-01-05T00:00:00.000Z" })],
      [membership({ player_id: "p1", team_id: "team-a", joined_at: "2026-01-01T00:00:00.000Z", left_at: "2026-01-10T00:00:00.000Z" })]
    );
    expect(aggregateMemberContributions(attributed)).toEqual([{ team_id: "team-a", player_id: "p1", points: 40 }]);
  });
});

describe("competition ranking -- 1, 1, 3, never an invented tiebreak", () => {
  it("equal-points teams share the same rank; the next distinct score jumps past the tie count", () => {
    const ranked = rankByPointsDescending([
      { name: "A", points: 100 },
      { name: "B", points: 100 },
      { name: "C", points: 80 },
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it("a three-way tie for first still leaves the next team at rank 4", () => {
    const ranked = rankByPointsDescending([
      { name: "A", points: 50 },
      { name: "B", points: 50 },
      { name: "C", points: 50 },
      { name: "D", points: 10 },
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 1, 4]);
  });

  it("input order within a tie never changes which teams share a rank", () => {
    const a = rankByPointsDescending([
      { name: "Z", points: 100 },
      { name: "A", points: 100 },
    ]);
    const b = rankByPointsDescending([
      { name: "A", points: 100 },
      { name: "Z", points: 100 },
    ]);
    expect(a.map((r) => r.rank)).toEqual([1, 1]);
    expect(b.map((r) => r.rank)).toEqual([1, 1]);
  });

  it("a zero-point team is still ranked, at the bottom, never omitted", () => {
    const ranked = rankByPointsDescending([
      { name: "A", points: 10 },
      { name: "B", points: 0 },
    ]);
    expect(ranked.find((r) => r.name === "B")?.rank).toBe(2);
  });
});
