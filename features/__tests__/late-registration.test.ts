import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findTournament: vi.fn(),
  findSnapshot: vi.fn(),
  insertIfAbsent: vi.fn(),
  findAttended: vi.fn(),
  findRebuyState: vi.fn(),
  getMysterySnapshot: vi.fn(),
  closeMystery: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  tournamentRepository: { findById: mocks.findTournament },
  tournamentLateRegistrationRepository: {
    findByTournamentId: mocks.findSnapshot,
    insertIfAbsent: mocks.insertIfAbsent,
  },
  tournamentLiveStateRepository: {
    findAttendedPlayersWithDetails: mocks.findAttended,
    findRebuyStateByTournamentId: mocks.findRebuyState,
  },
}));

vi.mock("@/features/mystery-bounty", () => ({
  getMysteryBountySnapshot: mocks.getMysterySnapshot,
  closeMysteryBountyLateRegistration: mocks.closeMystery,
}));

const {
  closeTournamentLateRegistration,
  closeTournamentLateRegistrationOperation,
  getTournamentStateForIntegration,
} = await import("@/features/late-registration");

const tournament = {
  id: "t1",
  kind: "free",
  status: "open",
  tournament_type: "classic",
  rating_formula_version: "v2",
  rating_guarantee: null,
  is_final: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findTournament.mockResolvedValue(tournament);
  mocks.findSnapshot.mockResolvedValue(null);
  mocks.findAttended.mockResolvedValue([
    { player_id: "p1" },
    { player_id: "p2" },
    { player_id: "p3" },
  ]);
  mocks.findRebuyState.mockResolvedValue(
    new Map([
      ["p1", { rebuys: 1, addons: 0 }],
      ["p2", { rebuys: 1, addons: 0 }],
      ["p3", { rebuys: 1, addons: 0 }],
    ])
  );
  mocks.insertIfAbsent.mockImplementation(async (row) => ({
    ...row,
    closed_at: "2026-08-25T12:00:00.000Z",
  }));
  mocks.getMysterySnapshot.mockResolvedValue(null);
});

describe("generic Late Registration snapshot", () => {
  it("freezes the real v2 rating-place structure for exactly 3 arrived players", async () => {
    const snapshot = await closeTournamentLateRegistration("t1");

    expect(snapshot.arrived_players_count).toBe(3);
    expect(snapshot.initial_stacks_count).toBe(3);
    expect(snapshot.total_entries_count).toBe(3);
    expect(snapshot.rebuys_count).toBe(0);
    expect(snapshot.addons_count).toBe(0);
    expect(snapshot.rating_places).toEqual([
      { place: 1, points: 70 },
      { place: 2, points: 53 },
      { place: 3, points: 39 },
    ]);
  });

  it("normalizes real rebuys per player while preserving the raw total entries used by the engine", async () => {
    mocks.findRebuyState.mockResolvedValue(
      new Map([
        ["p1", { rebuys: 0, addons: 0 }],
        ["p2", { rebuys: 2, addons: 1 }],
        ["p3", { rebuys: 3, addons: 0 }],
      ])
    );

    const snapshot = await closeTournamentLateRegistration("t1");
    expect(snapshot).toMatchObject({
      arrived_players_count: 3,
      initial_stacks_count: 2,
      total_entries_count: 5,
      rebuys_count: 3,
      addons_count: 1,
    });
  });

  it("is idempotent and never recomputes an existing frozen snapshot", async () => {
    const frozen = {
      tournament_id: "t1",
      closed_at: "2026-08-25T12:00:00.000Z",
      rating_places: [{ place: 1, points: 70 }],
    };
    mocks.findSnapshot.mockResolvedValue(frozen);

    await expect(closeTournamentLateRegistration("t1")).resolves.toBe(frozen);
    expect(mocks.findAttended).not.toHaveBeenCalled();
    expect(mocks.findRebuyState).not.toHaveBeenCalled();
    expect(mocks.insertIfAbsent).not.toHaveBeenCalled();
  });

  it("does not enable close for paid/cash tournaments", async () => {
    mocks.findTournament.mockResolvedValue({ ...tournament, kind: "paid" });
    await expect(closeTournamentLateRegistration("t1")).rejects.toThrow("только для рейтинговых free");
    expect(mocks.insertIfAbsent).not.toHaveBeenCalled();
  });

  it("reports open/null before close and frozen places after close", async () => {
    await expect(getTournamentStateForIntegration("t1")).resolves.toEqual({
      lateRegistration: { status: "open", closedAt: null },
      rating: null,
    });

    mocks.findSnapshot.mockResolvedValue({
      closed_at: "2026-08-25T12:00:00.000Z",
      rating_places: [{ place: 1, points: 70 }],
    });
    await expect(getTournamentStateForIntegration("t1")).resolves.toEqual({
      lateRegistration: { status: "closed", closedAt: "2026-08-25T12:00:00.000Z" },
      rating: { places: [{ place: 1, points: 72 }] },
    });
  });

  // Symptom under investigation: the live Poker Clock projection was
  // missing the +2 participation component even though it's flat/constant
  // for every arrived player. `snapshot.rating_places` itself stores
  // itm_points ONLY (completion's `ratingPlaces` merge option needs that --
  // see app/api/admin/tournaments/[id]/complete-free/route.ts -- and would
  // double-count participation otherwise); getTournamentStateForIntegration
  // must fold PARTICIPATION_POINTS back in for the live response without
  // mutating the frozen snapshot.
  it("live projection includes the +2 participation component on top of each frozen itm place value", async () => {
    mocks.findSnapshot.mockResolvedValue({
      closed_at: "2026-08-25T12:00:00.000Z",
      rating_places: [
        { place: 1, points: 70 },
        { place: 2, points: 52 },
      ],
    });

    const result = await getTournamentStateForIntegration("t1");

    expect(result.rating).toEqual({
      places: [
        { place: 1, points: 72 },
        { place: 2, points: 54 },
      ],
    });
  });

  it("composes Mystery-specific and generic close, reusing an existing Mystery pool on retry", async () => {
    const mystery = { tournament_id: "t1", mystery_pool: 100 };
    mocks.findTournament.mockResolvedValue({ ...tournament, tournament_type: "mystery_bounty" });
    mocks.getMysterySnapshot.mockResolvedValue(mystery);

    const result = await closeTournamentLateRegistrationOperation("t1");
    expect(result.mysteryBountySnapshot).toBe(mystery);
    expect(mocks.closeMystery).not.toHaveBeenCalled();
    expect(mocks.insertIfAbsent).toHaveBeenCalledTimes(1);
  });

  it("creates Mystery-specific state before the generic snapshot on the first unified close", async () => {
    const mystery = { tournament_id: "t1", mystery_pool: 100 };
    mocks.findTournament.mockResolvedValue({ ...tournament, tournament_type: "mystery_bounty" });
    mocks.closeMystery.mockResolvedValue(mystery);

    await closeTournamentLateRegistrationOperation("t1");

    expect(mocks.closeMystery).toHaveBeenCalledWith("t1", [
      { player_id: "p1", arrived: true, rebuys: 1, addons: 0 },
      { player_id: "p2", arrived: true, rebuys: 1, addons: 0 },
      { player_id: "p3", arrived: true, rebuys: 1, addons: 0 },
    ]);
    expect(mocks.closeMystery.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.insertIfAbsent.mock.invocationCallOrder[0]
    );
  });
});
