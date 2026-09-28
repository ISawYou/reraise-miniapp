import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPlayerRepository = { findById: vi.fn() };
const mockResultRepository = {
  findClubDiscountHistoryByPlayerId: vi.fn(),
  updateClubDiscountPercent: vi.fn(),
};

vi.mock("@/lib/repositories", () => ({
  playerRepository: mockPlayerRepository,
  resultRepository: mockResultRepository,
}));

const { previewClubDiscountBackfill, applyClubDiscountBackfill } = await import("../club-discount-backfill");

const PLAYER_ID = "player-1";

function player(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAYER_ID,
    telegram_id: null,
    username: "lee_tg",
    display_name: "Lee",
    role: "player" as const,
    club_discount_percent: 0, // LIVE setting -- deliberately independent of the backfill
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function historyRow(overrides: Partial<{
  resultId: string;
  tournamentId: string;
  tournamentTitle: string;
  tournamentStartAt: Date;
  clubDiscountPercent: number;
}> = {}) {
  return {
    resultId: "result-1",
    tournamentId: "tournament-1",
    tournamentTitle: "CLASSIC",
    tournamentStartAt: new Date("2026-08-01T16:00:00.000Z"),
    clubDiscountPercent: 0,
    ...overrides,
  };
}

beforeEach(() => {
  mockPlayerRepository.findById.mockReset();
  mockResultRepository.findClubDiscountHistoryByPlayerId.mockReset();
  mockResultRepository.updateClubDiscountPercent.mockReset();
});

describe("previewClubDiscountBackfill — read-only", () => {
  it("returns proposed changes without writing anything", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player());
    mockResultRepository.findClubDiscountHistoryByPlayerId.mockResolvedValue([
      historyRow({ resultId: "r1", tournamentStartAt: new Date("2026-08-01T00:00:00Z") }),
    ]);

    const preview = await previewClubDiscountBackfill({
      playerId: PLAYER_ID,
      discountPercent: 10,
      effectiveFrom: "2026-01-01",
    });

    expect(preview.rows).toEqual([
      expect.objectContaining({ resultId: "r1", currentDiscountPercent: 0, proposedDiscountPercent: 10, willChange: true }),
    ]);
    expect(mockResultRepository.updateClubDiscountPercent).not.toHaveBeenCalled();
  });

  it("surfaces the player's display name for information only", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player({ display_name: "Lee Real Name" }));
    mockResultRepository.findClubDiscountHistoryByPlayerId.mockResolvedValue([]);

    const preview = await previewClubDiscountBackfill({ playerId: PLAYER_ID, discountPercent: 10, effectiveFrom: "2026-01-01" });

    expect(preview.playerDisplayName).toBe("Lee Real Name");
  });

  it("effectiveFrom excludes tournaments before the window", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player());
    mockResultRepository.findClubDiscountHistoryByPlayerId.mockResolvedValue([
      historyRow({ resultId: "before", tournamentStartAt: new Date("2025-12-31T23:59:59Z") }),
      historyRow({ resultId: "on-boundary", tournamentStartAt: new Date("2026-01-01T00:00:00Z") }),
      historyRow({ resultId: "after", tournamentStartAt: new Date("2026-06-01T00:00:00Z") }),
    ]);

    const preview = await previewClubDiscountBackfill({ playerId: PLAYER_ID, discountPercent: 10, effectiveFrom: "2026-01-01" });

    expect(preview.rows.map((r) => r.resultId).sort()).toEqual(["after", "on-boundary"]);
  });

  it("effectiveTo, when supplied, excludes tournaments after the window", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player());
    mockResultRepository.findClubDiscountHistoryByPlayerId.mockResolvedValue([
      historyRow({ resultId: "inside", tournamentStartAt: new Date("2026-03-01T00:00:00Z") }),
      historyRow({ resultId: "on-boundary", tournamentStartAt: new Date("2026-06-30T23:59:59.999Z") }),
      historyRow({ resultId: "after", tournamentStartAt: new Date("2026-07-01T00:00:01Z") }),
    ]);

    const preview = await previewClubDiscountBackfill({
      playerId: PLAYER_ID,
      discountPercent: 10,
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-06-30T23:59:59.999Z",
    });

    expect(preview.rows.map((r) => r.resultId).sort()).toEqual(["inside", "on-boundary"]);
  });

  it("without effectiveTo, the window is open-ended (includes the most recent tournaments)", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player());
    mockResultRepository.findClubDiscountHistoryByPlayerId.mockResolvedValue([
      historyRow({ resultId: "recent", tournamentStartAt: new Date("2030-01-01T00:00:00Z") }),
    ]);

    const preview = await previewClubDiscountBackfill({ playerId: PLAYER_ID, discountPercent: 10, effectiveFrom: "2026-01-01" });

    expect(preview.rows.map((r) => r.resultId)).toEqual(["recent"]);
  });

  it("a row already at the proposed percent shows willChange: false", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player());
    mockResultRepository.findClubDiscountHistoryByPlayerId.mockResolvedValue([
      historyRow({ resultId: "already-10", clubDiscountPercent: 10 }),
    ]);

    const preview = await previewClubDiscountBackfill({ playerId: PLAYER_ID, discountPercent: 10, effectiveFrom: "2026-01-01" });

    expect(preview.rows[0].willChange).toBe(false);
  });

  it("rejects an invalid discount percent before touching any repository", async () => {
    await expect(
      previewClubDiscountBackfill({ playerId: PLAYER_ID, discountPercent: 101, effectiveFrom: "2026-01-01" }),
    ).rejects.toThrow(/0 до 100/);
    expect(mockPlayerRepository.findById).not.toHaveBeenCalled();
  });

  it("throws when the player does not exist", async () => {
    mockPlayerRepository.findById.mockResolvedValue(null);
    await expect(
      previewClubDiscountBackfill({ playerId: "missing", discountPercent: 10, effectiveFrom: "2026-01-01" }),
    ).rejects.toThrow("Игрок не найден");
  });
});

describe("applyClubDiscountBackfill — writes ONLY the previewed rows, ONLY club_discount_percent", () => {
  it("applies the discount to exactly the given result ids", async () => {
    mockResultRepository.findClubDiscountHistoryByPlayerId.mockResolvedValue([
      historyRow({ resultId: "r1" }),
      historyRow({ resultId: "r2" }),
    ]);

    const result = await applyClubDiscountBackfill({ playerId: PLAYER_ID, discountPercent: 10, resultIds: ["r1", "r2"] });

    expect(result.updatedCount).toBe(2);
    expect(mockResultRepository.updateClubDiscountPercent).toHaveBeenCalledWith("r1", 10);
    expect(mockResultRepository.updateClubDiscountPercent).toHaveBeenCalledWith("r2", 10);
    expect(mockResultRepository.updateClubDiscountPercent).toHaveBeenCalledTimes(2);
  });

  it("refuses to apply a result id that does not belong to the given player -- nothing gets written", async () => {
    mockResultRepository.findClubDiscountHistoryByPlayerId.mockResolvedValue([historyRow({ resultId: "r1" })]);

    await expect(
      applyClubDiscountBackfill({ playerId: PLAYER_ID, discountPercent: 10, resultIds: ["r1", "someone-elses-result"] }),
    ).rejects.toThrow(/не принадлежат игроку/);
    expect(mockResultRepository.updateClubDiscountPercent).not.toHaveBeenCalled();
  });

  it("is idempotent -- applying the same input twice produces the same end state, no error, no duplication", async () => {
    mockResultRepository.findClubDiscountHistoryByPlayerId.mockResolvedValue([historyRow({ resultId: "r1" })]);

    await applyClubDiscountBackfill({ playerId: PLAYER_ID, discountPercent: 10, resultIds: ["r1"] });
    await applyClubDiscountBackfill({ playerId: PLAYER_ID, discountPercent: 10, resultIds: ["r1"] });

    expect(mockResultRepository.updateClubDiscountPercent).toHaveBeenCalledTimes(2);
    expect(mockResultRepository.updateClubDiscountPercent).toHaveBeenNthCalledWith(1, "r1", 10);
    expect(mockResultRepository.updateClubDiscountPercent).toHaveBeenNthCalledWith(2, "r1", 10);
  });

  it("touches ONLY updateClubDiscountPercent -- never insertMany/deleteByTournamentId or any other write path (rating/results/free-reentry untouched)", async () => {
    mockResultRepository.findClubDiscountHistoryByPlayerId.mockResolvedValue([historyRow({ resultId: "r1" })]);
    await applyClubDiscountBackfill({ playerId: PLAYER_ID, discountPercent: 10, resultIds: ["r1"] });

    const calledMethods = Object.keys(mockResultRepository).filter(
      (key) => (mockResultRepository as Record<string, ReturnType<typeof vi.fn>>)[key].mock.calls.length > 0,
    );
    expect(calledMethods.sort()).toEqual(["findClubDiscountHistoryByPlayerId", "updateClubDiscountPercent"]);
  });

  it("never writes to players.club_discount_percent -- the live setting stays independent (playerRepository.update is never called)", async () => {
    mockResultRepository.findClubDiscountHistoryByPlayerId.mockResolvedValue([historyRow({ resultId: "r1" })]);
    await applyClubDiscountBackfill({ playerId: PLAYER_ID, discountPercent: 10, resultIds: ["r1"] });
    expect(mockPlayerRepository.findById).not.toHaveBeenCalled(); // apply doesn't even need to read the player
  });

  it("an unrelated player's rows are never touched -- history lookup is scoped to the given playerId", async () => {
    mockResultRepository.findClubDiscountHistoryByPlayerId.mockResolvedValue([historyRow({ resultId: "r1" })]);
    await applyClubDiscountBackfill({ playerId: "player-A", discountPercent: 10, resultIds: ["r1"] });
    expect(mockResultRepository.findClubDiscountHistoryByPlayerId).toHaveBeenCalledWith("player-A");
  });

  it("an empty resultIds array is a safe no-op", async () => {
    const result = await applyClubDiscountBackfill({ playerId: PLAYER_ID, discountPercent: 10, resultIds: [] });
    expect(result.updatedCount).toBe(0);
    expect(mockResultRepository.findClubDiscountHistoryByPlayerId).not.toHaveBeenCalled();
    expect(mockResultRepository.updateClubDiscountPercent).not.toHaveBeenCalled();
  });

  it("rejects an invalid discount percent before touching any repository", async () => {
    await expect(
      applyClubDiscountBackfill({ playerId: PLAYER_ID, discountPercent: -1, resultIds: ["r1"] }),
    ).rejects.toThrow(/0 до 100/);
    expect(mockResultRepository.findClubDiscountHistoryByPlayerId).not.toHaveBeenCalled();
  });
});
