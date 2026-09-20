import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOpenShiftByAdminId: vi.fn(),
  findShiftById: vi.fn(),
  createShift: vi.fn(),
  closeShift: vi.fn(),
  setShiftAmount: vi.fn(),
  listShiftsByAdminId: vi.fn(),
  listRecentShifts: vi.fn(),
  findTournamentById: vi.fn(),
  findSummariesByIds: vi.fn(),
}));

class MockAdminShiftAlreadyOnShiftError extends Error {
  constructor(adminPlayerId: string) {
    super(`Admin ${adminPlayerId} already has an open shift`);
    this.name = "AdminShiftAlreadyOnShiftError";
  }
}

vi.mock("@/lib/repositories", () => ({
  adminShiftRepository: {
    findOpenShiftByAdminId: mocks.findOpenShiftByAdminId,
    findShiftById: mocks.findShiftById,
    createShift: mocks.createShift,
    closeShift: mocks.closeShift,
    setShiftAmount: mocks.setShiftAmount,
    listShiftsByAdminId: mocks.listShiftsByAdminId,
    listRecentShifts: mocks.listRecentShifts,
  },
  tournamentRepository: {
    findById: mocks.findTournamentById,
  },
  playerRepository: {
    findSummariesByIds: mocks.findSummariesByIds,
  },
  AdminShiftAlreadyOnShiftError: MockAdminShiftAlreadyOnShiftError,
}));

const {
  startAdminShift,
  endMyAdminShift,
  setAdminShiftAmount,
  getMyAdminShiftSummary,
  listAdminShiftsForManagement,
  InvalidTournamentIdError,
  InvalidAmountError,
  AdminShiftNotFoundError,
  AdminShiftAlreadyOnShiftError,
  DEFAULT_ADMIN_SHIFT_AMOUNT_RUB,
} = await import("@/features/admin-shifts");

function shiftRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "s1",
    admin_player_id: "p1",
    started_at: "2026-01-01T18:00:00.000Z",
    ended_at: null,
    amount_rub: DEFAULT_ADMIN_SHIFT_AMOUNT_RUB,
    tournament_id: null,
    created_by_player_id: "p1",
    ended_by_player_id: null,
    updated_by_player_id: null,
    created_at: "2026-01-01T18:00:00.000Z",
    updated_at: "2026-01-01T18:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findOpenShiftByAdminId.mockResolvedValue(null);
  mocks.createShift.mockImplementation(async (row: Record<string, unknown>) =>
    shiftRow({
      admin_player_id: row.admin_player_id,
      started_at: row.started_at,
      amount_rub: row.amount_rub,
      tournament_id: row.tournament_id ?? null,
      created_by_player_id: row.created_by_player_id,
    })
  );
  mocks.closeShift.mockImplementation(async (id: string, patch: Record<string, unknown>) =>
    shiftRow({ id, ended_at: patch.ended_at, ended_by_player_id: patch.ended_by_player_id })
  );
  mocks.setShiftAmount.mockImplementation(async (id: string, amountRub: number, updatedBy: string | null) =>
    shiftRow({ id, amount_rub: amountRub, updated_by_player_id: updatedBy })
  );
  mocks.findTournamentById.mockResolvedValue({ id: "t1", title: "Classic", start_at: "2026-08-27T18:00:00.000Z" });
  mocks.listShiftsByAdminId.mockResolvedValue([]);
  mocks.listRecentShifts.mockResolvedValue([]);
  mocks.findSummariesByIds.mockResolvedValue([{ id: "p1", display_name: "Alice", username: "alice", email: null, role: "operator" }]);
});

describe("startAdminShift", () => {
  it("defaults amount_rub to 4000 for a newly created shift", async () => {
    await startAdminShift("p1", "2026-01-02T10:00:00.000Z", null);
    expect(mocks.createShift).toHaveBeenCalledWith(
      expect.objectContaining({ admin_player_id: "p1", amount_rub: 4000 })
    );
  });

  it("cannot start a second open shift for the same admin", async () => {
    mocks.findOpenShiftByAdminId.mockResolvedValue(shiftRow());
    await expect(startAdminShift("p1", "2026-01-02T10:00:00.000Z", null)).rejects.toThrow(
      AdminShiftAlreadyOnShiftError
    );
    expect(mocks.createShift).not.toHaveBeenCalled();
  });

  it("attributes created_by_player_id to the caller themselves (self-service only)", async () => {
    await startAdminShift("p1", "2026-01-02T10:00:00.000Z", null);
    expect(mocks.createShift).toHaveBeenCalledWith(
      expect.objectContaining({ created_by_player_id: "p1" })
    );
  });

  it("a shift may link to a real tournament", async () => {
    await startAdminShift("p1", "2026-01-02T10:00:00.000Z", "t1");
    expect(mocks.createShift).toHaveBeenCalledWith(expect.objectContaining({ tournament_id: "t1" }));
  });

  it("null tournament ('Без турнира') never blocks starting a shift", async () => {
    await startAdminShift("p1", "2026-01-02T10:00:00.000Z", null);
    expect(mocks.createShift).toHaveBeenCalledWith(expect.objectContaining({ tournament_id: null }));
    expect(mocks.findTournamentById).not.toHaveBeenCalled();
  });

  it("an invalid/unknown tournament ID is rejected", async () => {
    mocks.findTournamentById.mockRejectedValue(new Error("not found"));
    await expect(startAdminShift("p1", "2026-01-02T10:00:00.000Z", "bogus")).rejects.toThrow(
      InvalidTournamentIdError
    );
    expect(mocks.createShift).not.toHaveBeenCalled();
  });
});

describe("endMyAdminShift", () => {
  it("closes the caller's own open shift, resolved server-side (no shiftId parameter exists at all)", async () => {
    mocks.findOpenShiftByAdminId.mockResolvedValue(shiftRow({ id: "s1", admin_player_id: "p1" }));
    await endMyAdminShift("p1", "2026-01-01T20:00:00.000Z");
    expect(mocks.findOpenShiftByAdminId).toHaveBeenCalledWith("p1");
    expect(mocks.closeShift).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ ended_by_player_id: "p1" })
    );
  });

  it("never mutates amount_rub when ending a shift", async () => {
    mocks.findOpenShiftByAdminId.mockResolvedValue(shiftRow({ id: "s1", amount_rub: 4000 }));
    await endMyAdminShift("p1", "2026-01-01T20:00:00.000Z");
    const patch = mocks.closeShift.mock.calls[0][1];
    expect(patch).not.toHaveProperty("amount_rub");
  });

  it("rejects ending when there is no open shift for the caller", async () => {
    mocks.findOpenShiftByAdminId.mockResolvedValue(null);
    await expect(endMyAdminShift("p1", "2026-01-01T20:00:00.000Z")).rejects.toThrow(AdminShiftNotFoundError);
    expect(mocks.closeShift).not.toHaveBeenCalled();
  });
});

describe("setAdminShiftAmount (Super Admin explicit correction)", () => {
  it("applies an explicit stored correction, attributed to the editor", async () => {
    mocks.findShiftById.mockResolvedValue(shiftRow({ id: "s1" }));
    await setAdminShiftAmount("s1", 2000, "super-admin-1");
    expect(mocks.setShiftAmount).toHaveBeenCalledWith("s1", 2000, "super-admin-1");
  });

  it("rejects a negative amount", async () => {
    mocks.findShiftById.mockResolvedValue(shiftRow({ id: "s1" }));
    await expect(setAdminShiftAmount("s1", -100, "super-admin-1")).rejects.toThrow(InvalidAmountError);
    expect(mocks.setShiftAmount).not.toHaveBeenCalled();
  });

  it("rejects a non-integer amount", async () => {
    mocks.findShiftById.mockResolvedValue(shiftRow({ id: "s1" }));
    await expect(setAdminShiftAmount("s1", 100.5, "super-admin-1")).rejects.toThrow(InvalidAmountError);
    expect(mocks.setShiftAmount).not.toHaveBeenCalled();
  });

  it("rejects a non-existent shift", async () => {
    mocks.findShiftById.mockResolvedValue(null);
    await expect(setAdminShiftAmount("missing", 2000, "super-admin-1")).rejects.toThrow(
      AdminShiftNotFoundError
    );
    expect(mocks.setShiftAmount).not.toHaveBeenCalled();
  });

  it("works on a completed shift (amount is never recomputed from time, so there's nothing to freeze against)", async () => {
    mocks.findShiftById.mockResolvedValue(shiftRow({ id: "s1", ended_at: "2026-01-01T20:00:00.000Z" }));
    await setAdminShiftAmount("s1", 3000, "super-admin-1");
    expect(mocks.setShiftAmount).toHaveBeenCalledWith("s1", 3000, "super-admin-1");
  });
});

describe("getMyAdminShiftSummary", () => {
  it("separates the open shift from completed history", async () => {
    mocks.listShiftsByAdminId.mockResolvedValue([
      shiftRow({ id: "open", ended_at: null }),
      shiftRow({ id: "closed", ended_at: "2026-01-01T20:00:00.000Z" }),
    ]);
    const result = await getMyAdminShiftSummary("p1");
    expect(result.openShift?.id).toBe("open");
    expect(result.history).toHaveLength(1);
    expect(result.history[0].id).toBe("closed");
  });

  it("a NULL tournament_id is returned as tournamentTitle: null, never fabricated", async () => {
    mocks.listShiftsByAdminId.mockResolvedValue([shiftRow({ id: "s1", tournament_id: null })]);
    const result = await getMyAdminShiftSummary("p1");
    expect(result.openShift).toEqual(expect.objectContaining({ tournamentId: null, tournamentTitle: null }));
    expect(mocks.findTournamentById).not.toHaveBeenCalled();
  });
});

describe("listAdminShiftsForManagement", () => {
  it("resolves display names for each admin", async () => {
    mocks.listRecentShifts.mockResolvedValue([shiftRow({ id: "s1", admin_player_id: "p1" })]);
    const result = await listAdminShiftsForManagement();
    expect(result[0]).toEqual(expect.objectContaining({ adminPlayerId: "p1", adminDisplayName: "Alice" }));
  });
});
