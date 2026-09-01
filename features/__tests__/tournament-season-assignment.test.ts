import { beforeEach, describe, expect, it, vi } from "vitest";

// createTournament/updateTournament's season_id assignment -- exercises the
// REAL features/seasons.ts::resolveSeasonForTournamentDate (only its
// seasonRepository.listAll dependency is mocked), so this is genuine
// end-to-end coverage of "tournament date -> season", not a stub standing
// in for it. Authorization itself is covered by
// tournament-admin-actions-auth.test.ts; this file only cares about
// season_id.
const mocks = vi.hoisted(() => ({
  assertServerActorRole: vi.fn().mockResolvedValue({ id: "actor-1", role: "admin" }),
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

const OPENING = {
  id: "opening",
  title: "Открытие",
  start_date: "2026-06-01",
  end_date: "2026-08-31",
  is_active: true,
  created_at: "2026-01-01T00:00:00.000Z",
};
const AUTUMN = {
  id: "autumn",
  title: "Осень 2026",
  start_date: "2026-09-01",
  end_date: "2026-11-30",
  is_active: false,
  created_at: "2026-06-01T00:00:00.000Z",
};

function input(startAt: string) {
  return {
    title: "T",
    description: "",
    location: "",
    start_at: startAt,
    max_players: 20,
    tournament_type: "classic" as const,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActorRole.mockResolvedValue({ id: "actor-1", role: "admin" });
  mocks.tournamentCreate.mockResolvedValue({ id: "new-t" });
  mocks.tournamentUpdate.mockResolvedValue({ id: "t1" });
  mocks.seasonListAll.mockResolvedValue([OPENING, AUTUMN]);
});

describe("createTournament", () => {
  it("assigns the future, still-inactive Autumn season for a September date, even though Opening is the active season", async () => {
    await createTournament(input("2026-09-01T00:30:00+03:00"));

    expect(mocks.tournamentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ season_id: "autumn" })
    );
  });

  it("does NOT fall back to whichever season is active when resolution fails", async () => {
    mocks.seasonListAll.mockResolvedValue([OPENING]); // no season covers December

    await expect(createTournament(input("2026-12-25T18:00:00.000Z"))).rejects.toThrow(
      /не настроен сезон/
    );
    expect(mocks.tournamentCreate).not.toHaveBeenCalled();
  });

  it("an Aug 31 tournament resolves to Opening, not Autumn", async () => {
    await createTournament(input("2026-08-31T18:00:00.000Z"));

    expect(mocks.tournamentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ season_id: "opening" })
    );
  });
});

describe("updateTournament -- season_id recalculation", () => {
  it("a non-completed tournament's season_id is recalculated when start_at crosses a season boundary", async () => {
    mocks.tournamentFindById.mockResolvedValue({ id: "t1", status: "open", season_id: "opening" });

    await updateTournament("t1", input("2026-09-05T18:00:00.000Z"));

    expect(mocks.tournamentUpdate).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ season_id: "autumn" })
    );
  });

  it("a completed tournament's season_id is NEVER recalculated, even if start_at is edited across a season boundary", async () => {
    mocks.tournamentFindById.mockResolvedValue({ id: "t1", status: "completed", season_id: "opening" });

    await updateTournament("t1", input("2026-09-05T18:00:00.000Z"));

    const [, patch] = mocks.tournamentUpdate.mock.calls[0];
    expect(patch).not.toHaveProperty("season_id");
    // Season resolution wasn't even attempted for a completed tournament.
    expect(mocks.seasonListAll).not.toHaveBeenCalled();
  });

  it("a draft tournament's date edit within the same season keeps the same season_id (no-op reassignment, still explicit)", async () => {
    mocks.tournamentFindById.mockResolvedValue({ id: "t1", status: "draft", season_id: "opening" });

    await updateTournament("t1", input("2026-07-15T18:00:00.000Z"));

    expect(mocks.tournamentUpdate).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ season_id: "opening" })
    );
  });

  it("a closed (not completed) tournament still gets season_id recalculated", async () => {
    mocks.tournamentFindById.mockResolvedValue({ id: "t1", status: "closed", season_id: "opening" });

    await updateTournament("t1", input("2026-09-10T18:00:00.000Z"));

    expect(mocks.tournamentUpdate).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ season_id: "autumn" })
    );
  });
});
