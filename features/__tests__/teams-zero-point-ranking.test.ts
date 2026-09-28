import { beforeEach, describe, expect, it, vi } from "vitest";
import { teams, teamMemberships } from "@/lib/db/schema";

// Zero-point ranking UX: a team only ever consumes an OFFICIAL ranking
// position once it has > 0 points in the selected scope -- see
// features/teams.ts::getTeamLeaderboard. No scoring change: this only
// controls what `rank` value the read path returns.
const { mockResultRepo, mockPlayerRepo, mockSeasonRepo } = vi.hoisted(() => ({
  mockResultRepo: { findAllForTeamScoring: vi.fn().mockResolvedValue([]) },
  mockPlayerRepo: { findByIds: vi.fn().mockResolvedValue([]), listOrderedByDisplayName: vi.fn().mockResolvedValue([]) },
  mockSeasonRepo: { findActive: vi.fn().mockResolvedValue(null) },
}));

let teamRows: unknown[] = [];
let membershipRows: unknown[] = [];
let memberCountRows: unknown[] = [];

type FakeChain = Promise<unknown[]> & {
  from: () => FakeChain;
  where: () => FakeChain;
  limit: () => FakeChain;
  for: () => FakeChain;
  groupBy: () => Promise<unknown[]>;
};

function chain(defaultRows: unknown[], groupByRows?: unknown[]): FakeChain {
  const promise = Promise.resolve(defaultRows) as FakeChain;
  promise.from = () => promise;
  promise.where = () => promise;
  promise.limit = () => promise;
  promise.for = () => promise;
  promise.groupBy = () => Promise.resolve(groupByRows ?? []);
  return promise;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        if (table === teams) return chain(teamRows);
        if (table === teamMemberships) return chain(membershipRows, memberCountRows);
        return chain([]);
      },
    }),
  },
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: mockPlayerRepo,
  resultRepository: mockResultRepo,
  seasonRepository: mockSeasonRepo,
}));

vi.mock("@/lib/canonical-player", () => ({ resolveCanonicalPlayer: vi.fn() }));

function team(overrides: Record<string, unknown> = {}) {
  return {
    id: "team-1",
    name: "Sharks",
    emblem: "🦈",
    captainPlayerId: "captain-1",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    disbandedAt: null,
    ...overrides,
  };
}

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: "m-1",
    teamId: "team-1",
    playerId: "captain-1",
    joinedAt: new Date("2026-01-01T00:00:00.000Z"),
    leftAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function scoringResult(overrides: Record<string, unknown> = {}) {
  return {
    tournament_id: "t1",
    player_id: "captain-1",
    rating_points: 100,
    season_id: "s1",
    tournament_start_at: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  teamRows = [];
  membershipRows = [];
  memberCountRows = [];
  mockResultRepo.findAllForTeamScoring.mockResolvedValue([]);
  mockPlayerRepo.findByIds.mockResolvedValue([]);
  mockSeasonRepo.findActive.mockResolvedValue(null);
});

describe("getTeamLeaderboard -- zero-point teams never get an official rank", () => {
  it("7/9. a freshly created zero-point team shows rank=null; a positive-score team shows its official rank", async () => {
    teamRows = [
      team({ id: "zero", name: "Newcomers" }),
      team({ id: "scored", name: "Sharks", captainPlayerId: "p1" }),
    ];
    membershipRows = [membership({ teamId: "scored", playerId: "p1" })];
    memberCountRows = [
      { teamId: "zero", count: 0 },
      { teamId: "scored", count: 1 },
    ];
    mockResultRepo.findAllForTeamScoring.mockResolvedValue([scoringResult({ player_id: "p1" })]);

    const { getTeamLeaderboard } = await import("@/features/teams");
    const standings = await getTeamLeaderboard({ kind: "all_time" });

    const zero = standings.find((s) => s.team_id === "zero")!;
    const scored = standings.find((s) => s.team_id === "scored")!;

    expect(zero.points).toBe(0);
    expect(zero.rank).toBeNull();
    expect(scored.points).toBe(100);
    expect(scored.rank).toBe(1);
  });

  it("8. Home with ONLY zero-point teams: every standing has rank=null, no fake #1", async () => {
    teamRows = [team({ id: "a", name: "Alpha" }), team({ id: "b", name: "Beta" })];
    membershipRows = [];
    memberCountRows = [];
    mockResultRepo.findAllForTeamScoring.mockResolvedValue([]);

    const { getTeamLeaderboard } = await import("@/features/teams");
    const standings = await getTeamLeaderboard({ kind: "all_time" });

    expect(standings).toHaveLength(2);
    expect(standings.every((s) => s.rank === null)).toBe(true);
  });

  it("competition ranking (1,1,3) still applies within the positive-score group only", async () => {
    teamRows = [
      team({ id: "a", name: "Alpha", captainPlayerId: "pa" }),
      team({ id: "b", name: "Beta", captainPlayerId: "pb" }),
      team({ id: "c", name: "Gamma", captainPlayerId: "pc" }),
      team({ id: "zero", name: "Zero", captainPlayerId: "pz" }),
    ];
    membershipRows = [
      membership({ id: "ma", teamId: "a", playerId: "pa" }),
      membership({ id: "mb", teamId: "b", playerId: "pb" }),
      membership({ id: "mc", teamId: "c", playerId: "pc" }),
    ];
    memberCountRows = [];
    mockResultRepo.findAllForTeamScoring.mockResolvedValue([
      scoringResult({ tournament_id: "t1", player_id: "pa", rating_points: 100 }),
      scoringResult({ tournament_id: "t2", player_id: "pb", rating_points: 100 }),
      scoringResult({ tournament_id: "t3", player_id: "pc", rating_points: 50 }),
    ]);

    const { getTeamLeaderboard } = await import("@/features/teams");
    const standings = await getTeamLeaderboard({ kind: "all_time" });

    expect(standings.find((s) => s.team_id === "a")?.rank).toBe(1);
    expect(standings.find((s) => s.team_id === "b")?.rank).toBe(1);
    expect(standings.find((s) => s.team_id === "c")?.rank).toBe(3);
    expect(standings.find((s) => s.team_id === "zero")?.rank).toBeNull();

    // The returned ARRAY order itself is points-descending -- zero-point
    // teams sink to the bottom, never interleaved alphabetically among
    // scored teams.
    expect(standings.map((s) => s.team_id)).toEqual(["a", "b", "c", "zero"]);
  });
});

describe("getTeamLeaderboard -- roster_preview (squad card avatars)", () => {
  it("10. includes up to 5 current active members, captain first, using the existing player-safe shape", async () => {
    teamRows = [team({ id: "team-1", captainPlayerId: "captain-1" })];
    membershipRows = [
      membership({ id: "m-captain", playerId: "captain-1", joinedAt: new Date("2026-01-05T00:00:00.000Z") }),
      membership({ id: "m-member", playerId: "member-1", joinedAt: new Date("2026-01-01T00:00:00.000Z") }),
    ];
    memberCountRows = [];
    mockPlayerRepo.findByIds.mockResolvedValue([
      { id: "captain-1", display_name: "Captain", username: null, telegram_avatar_url: null, custom_avatar_url: null },
      { id: "member-1", display_name: "Member", username: null, telegram_avatar_url: null, custom_avatar_url: null },
    ]);

    const { getTeamLeaderboard } = await import("@/features/teams");
    const standings = await getTeamLeaderboard({ kind: "all_time" });

    const row = standings.find((s) => s.team_id === "team-1")!;
    expect(row.roster_preview).toHaveLength(2);
    expect(row.roster_preview[0]).toMatchObject({ player_id: "captain-1", is_captain: true });
    expect(row.roster_preview[1]).toMatchObject({ player_id: "member-1", is_captain: false });
  });
});
