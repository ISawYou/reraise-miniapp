import { beforeEach, describe, expect, it, vi } from "vitest";

// createTournament/updateTournament persistence of placement_points_multiplier
// and the v2-only fail-closed guard for bomb_pot / boost_rating.
const mocks = vi.hoisted(() => ({
  assertServerActorRole: vi.fn(),
  tournamentCreate: vi.fn(),
  tournamentUpdate: vi.fn(),
  tournamentFindById: vi.fn(),
  seasonListAll: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  assertServerActorRole: mocks.assertServerActorRole,
}));

vi.mock("@/lib/repositories", () => ({
  seasonRepository: { listAll: mocks.seasonListAll },
  tournamentRepository: {
    create: mocks.tournamentCreate,
    update: mocks.tournamentUpdate,
    findById: mocks.tournamentFindById,
  },
}));

const { createTournament, updateTournament } = await import("@/features/tournaments");

const SEASON = {
  id: "autumn",
  title: "Осень 2026",
  start_date: "2026-09-01",
  end_date: "2026-11-30",
  is_active: true,
  created_at: "2026-06-01T00:00:00.000Z",
};

function input(overrides: Record<string, unknown> = {}) {
  return {
    title: "RERAISE MAIN EVENT",
    description: "d",
    location: "l",
    start_at: "2026-10-03T19:00:00+03:00",
    max_players: 40,
    tournament_type: "boost_rating" as const,
    ...overrides,
  };
}

function stored(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    status: "open",
    tournament_type: "boost_rating",
    rating_formula_version: "v2",
    placement_points_multiplier: 1.5,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActorRole.mockResolvedValue({ id: "a", role: "admin" });
  mocks.tournamentCreate.mockResolvedValue({ id: "new" });
  mocks.tournamentUpdate.mockResolvedValue({ id: "t1" });
  mocks.tournamentFindById.mockResolvedValue(stored());
  mocks.seasonListAll.mockResolvedValue([SEASON]);
});

function created() {
  return mocks.tournamentCreate.mock.calls[0][0];
}
function updated() {
  return mocks.tournamentUpdate.mock.calls[0][1];
}

describe("createTournament -- placement_points_multiplier", () => {
  it("boost_rating stores the explicit multiplier (2.0 and 1.5)", async () => {
    await createTournament(input({ placement_points_multiplier: 2 }));
    expect(created().placement_points_multiplier).toBe(2);

    mocks.tournamentCreate.mockClear();
    await createTournament(input({ placement_points_multiplier: 1.5 }));
    expect(created().placement_points_multiplier).toBe(1.5);
  });

  it("boost_rating without a value defaults to 2", async () => {
    await createTournament(input());
    expect(created().placement_points_multiplier).toBe(2);
  });

  it("ordinary tournaments always store 1, even if a stray value is sent", async () => {
    await createTournament(input({ tournament_type: "classic", placement_points_multiplier: 3 }));
    expect(created().placement_points_multiplier).toBe(1);
  });

  it("rejects non-positive / malformed multipliers", async () => {
    await expect(createTournament(input({ placement_points_multiplier: 0 }))).rejects.toThrow();
    await expect(createTournament(input({ placement_points_multiplier: -2 }))).rejects.toThrow();
    await expect(createTournament(input({ placement_points_multiplier: 1.234 }))).rejects.toThrow();
    expect(mocks.tournamentCreate).not.toHaveBeenCalled();
  });
});

describe("updateTournament -- placement_points_multiplier", () => {
  it("an absent value keeps the STORED boost multiplier (never reset to default)", async () => {
    await updateTournament("t1", input());
    expect(updated().placement_points_multiplier).toBe(1.5);
  });

  it("an explicit value replaces the stored one", async () => {
    await updateTournament("t1", input({ placement_points_multiplier: 2 }));
    expect(updated().placement_points_multiplier).toBe(2);
  });

  it("switching boost_rating -> classic stores 1", async () => {
    await updateTournament("t1", input({ tournament_type: "classic", placement_points_multiplier: 2 }));
    expect(updated().placement_points_multiplier).toBe(1);
  });

  it("switching classic -> boost_rating without a value gets the default 2, not the stored 1", async () => {
    mocks.tournamentFindById.mockResolvedValue(
      stored({ tournament_type: "classic", placement_points_multiplier: 1 })
    );
    await updateTournament("t1", input());
    expect(updated().placement_points_multiplier).toBe(2);
  });

  it.each(["bomb_pot", "boost_rating"])(
    "fails closed turning a legacy-formula tournament into %s (no write)",
    async (type) => {
      mocks.tournamentFindById.mockResolvedValue(
        stored({ tournament_type: "classic", rating_formula_version: "legacy", status: "completed" })
      );
      await expect(updateTournament("t1", input({ tournament_type: type }))).rejects.toThrow(/v2/);
      expect(mocks.tournamentUpdate).not.toHaveBeenCalled();
    }
  );

  it("a legacy tournament can still be edited as an existing type", async () => {
    mocks.tournamentFindById.mockResolvedValue(
      stored({ tournament_type: "classic", rating_formula_version: "legacy", status: "completed" })
    );
    await updateTournament("t1", input({ tournament_type: "classic" }));
    expect(updated()).toMatchObject({ tournament_type: "classic", placement_points_multiplier: 1 });
  });
});
