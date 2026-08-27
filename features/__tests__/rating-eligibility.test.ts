import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listOrderedByCreatedAtDesc: vi.fn(),
  findByIdOrThrow: vi.fn(),
  findWithPlayerBySeasonId: vi.fn(),
  listBySeasonId: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: {
    listOrderedByCreatedAtDesc: mocks.listOrderedByCreatedAtDesc,
    findByIdOrThrow: mocks.findByIdOrThrow,
  },
  resultRepository: {
    findWithPlayerBySeasonId: mocks.findWithPlayerBySeasonId,
  },
  seasonRatingExclusionRepository: {
    listBySeasonId: mocks.listBySeasonId,
    create: mocks.create,
    remove: mocks.remove,
  },
}));

const { listRatingEligibility, setRatingEligibility } = await import("@/features/rating-eligibility");

function player(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p1",
    display_name: "Player One",
    admin_display_name: undefined,
    username: "player_one",
    role: "player",
    ...overrides,
  };
}

function resultRow(playerId: string, ratingPoints: number) {
  return {
    player_id: playerId,
    rating_points: ratingPoints,
    username: playerId,
    display_name: playerId,
    telegram_avatar_url: null,
    custom_avatar_url: null,
  };
}

beforeEach(() => {
  mocks.listOrderedByCreatedAtDesc.mockReset();
  mocks.findByIdOrThrow.mockReset();
  mocks.findWithPlayerBySeasonId.mockReset().mockResolvedValue([]);
  mocks.listBySeasonId.mockReset().mockResolvedValue([]);
  mocks.create.mockReset();
  mocks.remove.mockReset();
});

describe("listRatingEligibility", () => {
  it("includes every player, defaulting to 0 points and eligible when there is no result/exclusion row", async () => {
    mocks.listOrderedByCreatedAtDesc.mockResolvedValue([player({ id: "p1" })]);

    const rows = await listRatingEligibility("s1");

    expect(rows).toEqual([
      { playerId: "p1", displayName: "Player One", username: "player_one", points: 0, excluded: false, reason: null },
    ]);
  });

  it("never infers exclusion automatically -- a dealer/operator/admin player with no exclusion row is eligible", async () => {
    mocks.listOrderedByCreatedAtDesc.mockResolvedValue([
      player({ id: "dealer-1", role: "player" }),
      player({ id: "operator-1", role: "operator" }),
      player({ id: "admin-1", role: "admin" }),
    ]);
    mocks.listBySeasonId.mockResolvedValue([]); // no explicit exclusions

    const rows = await listRatingEligibility("s1");

    expect(rows.every((row) => row.excluded === false)).toBe(true);
  });

  it("reflects an explicit exclusion row's reason", async () => {
    mocks.listOrderedByCreatedAtDesc.mockResolvedValue([player({ id: "p1" })]);
    mocks.findWithPlayerBySeasonId.mockResolvedValue([resultRow("p1", 1000)]);
    mocks.listBySeasonId.mockResolvedValue([
      { id: "e1", season_id: "s1", player_id: "p1", created_by_player_id: "admin-1", reason: "Владелец", created_at: "x" },
    ]);

    const rows = await listRatingEligibility("s1");

    expect(rows[0]).toEqual({
      playerId: "p1",
      displayName: "Player One",
      username: "player_one",
      points: 1000,
      excluded: true,
      reason: "Владелец",
    });
  });
});

describe("setRatingEligibility", () => {
  it("marking excluded=true creates an exclusion row with the authenticated actor as created_by, never trusting a client-supplied actor", async () => {
    mocks.findByIdOrThrow.mockResolvedValue(player({ id: "p1" }));

    await setRatingEligibility("s1", "p1", true, "Дилер на финале", "actor-1");

    expect(mocks.create).toHaveBeenCalledWith({
      season_id: "s1",
      player_id: "p1",
      created_by_player_id: "actor-1",
      reason: "Дилер на финале",
    });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("marking excluded=false removes the exclusion row (restores eligibility)", async () => {
    mocks.findByIdOrThrow.mockResolvedValue(player({ id: "p1" }));

    await setRatingEligibility("s1", "p1", false, null, "actor-1");

    expect(mocks.remove).toHaveBeenCalledWith("s1", "p1");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("changing season B's exclusion never touches season A's row", async () => {
    mocks.findByIdOrThrow.mockResolvedValue(player({ id: "p1" }));

    await setRatingEligibility("season-b", "p1", true, null, "actor-1");

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ season_id: "season-b" })
    );
    expect(mocks.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ season_id: "season-a" })
    );
  });
});
