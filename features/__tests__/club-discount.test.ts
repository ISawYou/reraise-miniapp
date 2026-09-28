import { beforeEach, describe, expect, it, vi } from "vitest";

// setPlayerClubDiscount (features/admin.ts) -- validation + persistence of
// the LIVE players.club_discount_percent setting. See that column's doc
// comment: this is never re-read for a completed tournament's financial
// facts, only for players resulted for the FIRST time afterward.
const mockPlayerRepository = {
  findById: vi.fn(),
  update: vi.fn(),
};

vi.mock("@/lib/repositories", () => ({
  playerRepository: mockPlayerRepository,
}));

const { setPlayerClubDiscount } = await import("@/features/admin");

function player(overrides: Record<string, unknown> = {}) {
  return {
    id: "player-1",
    telegram_id: null,
    username: null,
    display_name: "Player One",
    role: "player" as const,
    is_blocked: false,
    club_discount_percent: 0,
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockPlayerRepository.findById.mockReset();
  mockPlayerRepository.update.mockReset();
});

describe("setPlayerClubDiscount", () => {
  it("saves a valid discount percent (0-100)", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player());
    mockPlayerRepository.update.mockResolvedValue(player({ club_discount_percent: 10 }));

    await setPlayerClubDiscount("player-1", 10);

    expect(mockPlayerRepository.update).toHaveBeenCalledWith("player-1", { club_discount_percent: 10 });
  });

  it("accepts 0 (no discount) and 100 (fully free) as the boundary values", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player());
    mockPlayerRepository.update.mockResolvedValue(player());

    await setPlayerClubDiscount("player-1", 0);
    await setPlayerClubDiscount("player-1", 100);

    expect(mockPlayerRepository.update).toHaveBeenCalledTimes(2);
  });

  it("rejects a negative percent, never reaching the repository", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player());
    await expect(setPlayerClubDiscount("player-1", -1)).rejects.toThrow(/0 до 100/);
    expect(mockPlayerRepository.update).not.toHaveBeenCalled();
  });

  it("rejects a percent above 100", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player());
    await expect(setPlayerClubDiscount("player-1", 101)).rejects.toThrow(/0 до 100/);
    expect(mockPlayerRepository.update).not.toHaveBeenCalled();
  });

  it("rejects a non-integer percent", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player());
    await expect(setPlayerClubDiscount("player-1", 10.5)).rejects.toThrow(/0 до 100/);
    expect(mockPlayerRepository.update).not.toHaveBeenCalled();
  });

  it("throws when the player does not exist", async () => {
    mockPlayerRepository.findById.mockResolvedValue(null);
    await expect(setPlayerClubDiscount("missing", 10)).rejects.toThrow("Игрок не найден");
    expect(mockPlayerRepository.update).not.toHaveBeenCalled();
  });

  it("has no staff/role restriction, unlike setPlayerBlocked -- staff may legitimately have a discount too", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player({ role: "operator" }));
    mockPlayerRepository.update.mockResolvedValue(player({ role: "operator", club_discount_percent: 10 }));

    await expect(setPlayerClubDiscount("player-1", 10)).resolves.toBeDefined();
  });
});

describe("finance-export playerDiscounts breakdown (buildPlayerDiscounts) -- pure, no mocking needed", () => {
  function row(overrides: Record<string, unknown> = {}) {
    return {
      player_id: "p1",
      arrived: true as boolean | null,
      reentries: 1,
      addons: 0,
      free_reentries: 0,
      club_discount_percent: 0,
      ...overrides,
    };
  }

  it("EXCLUDES a player with 0% discount -- Finance treats absence as no discount", async () => {
    const { buildPlayerDiscounts } = await import("@/features/finance-export");
    expect(buildPlayerDiscounts([row({ club_discount_percent: 0 })])).toEqual([]);
  });

  it("EXCLUDES a player with no club_discount_percent at all (undefined/null, legacy row)", async () => {
    const { buildPlayerDiscounts } = await import("@/features/finance-export");
    expect(buildPlayerDiscounts([row({ club_discount_percent: null })])).toEqual([]);
  });

  it("EXCLUDES a non-arrived player even with a nonzero discount", async () => {
    const { buildPlayerDiscounts } = await import("@/features/finance-export");
    expect(buildPlayerDiscounts([row({ arrived: false, club_discount_percent: 10 })])).toEqual([]);
    expect(buildPlayerDiscounts([row({ arrived: null, club_discount_percent: 10 })])).toEqual([]);
  });

  it("includes a discounted player with entry+reentry+addon counts, paid reentries net of free ones", async () => {
    const { buildPlayerDiscounts } = await import("@/features/finance-export");
    const result = buildPlayerDiscounts([
      row({ player_id: "p-discounted", reentries: 3, addons: 2, free_reentries: 1, club_discount_percent: 10 }),
    ]);
    // reentries=3 -> normalized (3-1=2) paid entries beyond the first, minus 1 free = 1 paid reentry.
    expect(result).toEqual([
      { playerId: "p-discounted", entryCount: 1, paidReentryCount: 1, paidAddonCount: 2, discountPercent: 10 },
    ]);
  });

  it("a free re-entry never becomes negative/discounted -- free_reentries >= paid reentries clamps to 0, not negative", async () => {
    const { buildPlayerDiscounts } = await import("@/features/finance-export");
    const result = buildPlayerDiscounts([
      row({ reentries: 1, free_reentries: 5, club_discount_percent: 10 }),
    ]);
    expect(result[0].paidReentryCount).toBe(0);
  });

  it("entry is always 1 and always included in the breakdown -- entry is never free in this data model", async () => {
    const { buildPlayerDiscounts } = await import("@/features/finance-export");
    const result = buildPlayerDiscounts([row({ reentries: 1, addons: 0, club_discount_percent: 10 })]);
    expect(result[0].entryCount).toBe(1);
  });

  it("two discounted players in the same tournament are handled independently, each with their own percent", async () => {
    const { buildPlayerDiscounts } = await import("@/features/finance-export");
    const result = buildPlayerDiscounts([
      row({ player_id: "p-a", club_discount_percent: 10 }),
      row({ player_id: "p-b", club_discount_percent: 25 }),
      row({ player_id: "p-c", club_discount_percent: 0 }),
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.playerId === "p-a")?.discountPercent).toBe(10);
    expect(result.find((r) => r.playerId === "p-b")?.discountPercent).toBe(25);
    expect(result.find((r) => r.playerId === "p-c")).toBeUndefined();
  });

  it("is deterministic/idempotent -- calling it twice on the same input yields the same result", async () => {
    const { buildPlayerDiscounts } = await import("@/features/finance-export");
    const input = [row({ player_id: "p-a", club_discount_percent: 10 })];
    expect(buildPlayerDiscounts(input)).toEqual(buildPlayerDiscounts(input));
  });
});
