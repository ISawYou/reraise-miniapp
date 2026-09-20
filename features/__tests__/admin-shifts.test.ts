import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOpenShiftByAdminId: vi.fn(),
  findShiftById: vi.fn(),
  createShift: vi.fn(),
  closeShift: vi.fn(),
  setShiftAmount: vi.fn(),
  createCompletedShift: vi.fn(),
  updateCompletedShift: vi.fn(),
  listShiftsByAdminId: vi.fn(),
  listRecentShifts: vi.fn(),
  listShiftsByTournamentId: vi.fn(),
  findTournamentById: vi.fn(),
  findSummariesByIds: vi.fn(),
  findPlayerById: vi.fn(),
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
    createCompletedShift: mocks.createCompletedShift,
    updateCompletedShift: mocks.updateCompletedShift,
    listShiftsByAdminId: mocks.listShiftsByAdminId,
    listRecentShifts: mocks.listRecentShifts,
    listShiftsByTournamentId: mocks.listShiftsByTournamentId,
  },
  tournamentRepository: {
    findById: mocks.findTournamentById,
  },
  playerRepository: {
    findSummariesByIds: mocks.findSummariesByIds,
    findById: mocks.findPlayerById,
  },
  AdminShiftAlreadyOnShiftError: MockAdminShiftAlreadyOnShiftError,
}));

const {
  startAdminShift,
  endMyAdminShift,
  setAdminShiftAmount,
  createHistoricalAdminShift,
  correctAdminShift,
  getMyAdminShiftSummary,
  listAdminShiftsForManagement,
  getTournamentAdminPayoutSummary,
  InvalidTournamentIdError,
  InvalidAmountError,
  AdminShiftNotFoundError,
  AdminShiftAlreadyOnShiftError,
  AdminShiftOpenError,
  AdminShiftDuplicateError,
  AdminShiftOverlapError,
  AdminShiftTargetPlayerNotFoundError,
  InvalidStaffPlayerError,
  TournamentRequiredError,
  InvalidShiftRangeError,
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
  mocks.createCompletedShift.mockImplementation(async (row: Record<string, unknown>) =>
    shiftRow({
      admin_player_id: row.admin_player_id,
      tournament_id: row.tournament_id ?? null,
      started_at: row.started_at,
      ended_at: row.ended_at,
      amount_rub: row.amount_rub,
      created_by_player_id: row.created_by_player_id,
      ended_by_player_id: row.ended_by_player_id,
    })
  );
  mocks.updateCompletedShift.mockImplementation(async (id: string, patch: Record<string, unknown>) =>
    shiftRow({
      id,
      tournament_id: patch.tournament_id ?? null,
      started_at: patch.started_at,
      ended_at: patch.ended_at,
      amount_rub: patch.amount_rub,
      updated_by_player_id: patch.updated_by_player_id,
    })
  );
  mocks.findTournamentById.mockResolvedValue({ id: "t1", title: "Classic", start_at: "2026-08-27T18:00:00.000Z" });
  mocks.listShiftsByAdminId.mockResolvedValue([]);
  mocks.listRecentShifts.mockResolvedValue([]);
  mocks.listShiftsByTournamentId.mockResolvedValue([]);
  mocks.findSummariesByIds.mockResolvedValue([{ id: "p1", display_name: "Alice", username: "alice", email: null, role: "operator" }]);
  mocks.findPlayerById.mockResolvedValue({ id: "p1", display_name: "Alice", role: "operator" });
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

const HISTORICAL_INPUT = {
  adminPlayerId: "p1",
  tournamentId: "t1",
  startedAt: "2026-01-01T18:00:00.000Z",
  endedAt: "2026-01-01T22:00:00.000Z",
  createdByPlayerId: "superadmin-1",
};

describe("createHistoricalAdminShift -- Super Admin backfill", () => {
  // Role authorization itself (Super Admin only) is enforced by the
  // route/middleware layer, never re-checked inside this feature function
  // (same split as every other function in this file) -- so "operator
  // cannot" is verified at the route/permission-allowlist level (see
  // lib/__tests__/admin-permissions.test.ts), not here.

  it("Super Admin can create a completed historical shift", async () => {
    const shift = await createHistoricalAdminShift({ ...HISTORICAL_INPUT, amountRub: 4000 });
    expect(mocks.createCompletedShift).toHaveBeenCalledWith(
      expect.objectContaining({
        admin_player_id: "p1",
        tournament_id: "t1",
        started_at: "2026-01-01T18:00:00.000Z",
        ended_at: "2026-01-01T22:00:00.000Z",
        amount_rub: 4000,
        created_by_player_id: "superadmin-1",
        ended_by_player_id: "superadmin-1",
      })
    );
    expect(shift.ended_at).not.toBeNull();
  });

  it("defaults amount to 4000 when the caller passes it through explicitly (DEFAULT_ADMIN_SHIFT_AMOUNT_RUB)", async () => {
    await createHistoricalAdminShift({ ...HISTORICAL_INPUT, amountRub: DEFAULT_ADMIN_SHIFT_AMOUNT_RUB });
    expect(mocks.createCompletedShift).toHaveBeenCalledWith(
      expect.objectContaining({ amount_rub: 4000 })
    );
  });

  it("accepts a custom amount", async () => {
    await createHistoricalAdminShift({ ...HISTORICAL_INPUT, amountRub: 2500 });
    expect(mocks.createCompletedShift).toHaveBeenCalledWith(
      expect.objectContaining({ amount_rub: 2500 })
    );
  });

  it("accepts amount 0 -- current business validation permits zero (same rule as the live flow's InvalidAmountError)", async () => {
    await createHistoricalAdminShift({ ...HISTORICAL_INPUT, amountRub: 0 });
    expect(mocks.createCompletedShift).toHaveBeenCalledWith(
      expect.objectContaining({ amount_rub: 0 })
    );
  });

  it("rejects a negative amount", async () => {
    await expect(createHistoricalAdminShift({ ...HISTORICAL_INPUT, amountRub: -100 })).rejects.toThrow(
      InvalidAmountError
    );
    expect(mocks.createCompletedShift).not.toHaveBeenCalled();
  });

  it("rejects an invalid/unknown tournament", async () => {
    mocks.findTournamentById.mockRejectedValue(new Error("not found"));
    await expect(
      createHistoricalAdminShift({ ...HISTORICAL_INPUT, amountRub: 4000 })
    ).rejects.toThrow(InvalidTournamentIdError);
    expect(mocks.createCompletedShift).not.toHaveBeenCalled();
  });

  it("requires a tournament for historical backfill -- empty tournamentId is rejected before touching the repository", async () => {
    await expect(
      createHistoricalAdminShift({ ...HISTORICAL_INPUT, tournamentId: "", amountRub: 4000 })
    ).rejects.toThrow(TournamentRequiredError);
    expect(mocks.createCompletedShift).not.toHaveBeenCalled();
  });

  it("rejects an invalid/unknown target player", async () => {
    mocks.findPlayerById.mockResolvedValue(null);
    await expect(
      createHistoricalAdminShift({ ...HISTORICAL_INPUT, amountRub: 4000 })
    ).rejects.toThrow(AdminShiftTargetPlayerNotFoundError);
    expect(mocks.createCompletedShift).not.toHaveBeenCalled();
  });

  it("rejects a target player who is not staff (plain 'player' role)", async () => {
    mocks.findPlayerById.mockResolvedValue({ id: "p1", display_name: "Not Staff", role: "player" });
    await expect(
      createHistoricalAdminShift({ ...HISTORICAL_INPUT, amountRub: 4000 })
    ).rejects.toThrow(InvalidStaffPlayerError);
    expect(mocks.createCompletedShift).not.toHaveBeenCalled();
  });

  it("accepts a target player with role 'admin' (Super Admin), not just 'operator'", async () => {
    mocks.findPlayerById.mockResolvedValue({ id: "p1", display_name: "Boss", role: "admin" });
    await createHistoricalAdminShift({ ...HISTORICAL_INPUT, amountRub: 4000 });
    expect(mocks.createCompletedShift).toHaveBeenCalled();
  });

  it("rejects endedAt before startedAt", async () => {
    await expect(
      createHistoricalAdminShift({
        ...HISTORICAL_INPUT,
        startedAt: "2026-01-01T22:00:00.000Z",
        endedAt: "2026-01-01T18:00:00.000Z",
        amountRub: 4000,
      })
    ).rejects.toThrow(InvalidShiftRangeError);
    expect(mocks.createCompletedShift).not.toHaveBeenCalled();
  });

  it("the created row is completed immediately -- ended_at is set from the very first insert, never via a separate end step", async () => {
    const shift = await createHistoricalAdminShift({ ...HISTORICAL_INPUT, amountRub: 4000 });
    expect(shift.ended_at).toBe("2026-01-01T22:00:00.000Z");
    expect(mocks.closeShift).not.toHaveBeenCalled();
    expect(mocks.createShift).not.toHaveBeenCalled();
  });

  it("created_by and ended_by both correspond to the Super Admin actor", async () => {
    await createHistoricalAdminShift({ ...HISTORICAL_INPUT, amountRub: 4000, createdByPlayerId: "superadmin-42" });
    expect(mocks.createCompletedShift).toHaveBeenCalledWith(
      expect.objectContaining({ created_by_player_id: "superadmin-42", ended_by_player_id: "superadmin-42" })
    );
  });
});

describe("createHistoricalAdminShift -- duplicate / overlap safety", () => {
  it("rejects an exact duplicate (same admin + tournament + start + end + amount)", async () => {
    mocks.listShiftsByAdminId.mockResolvedValue([
      shiftRow({
        id: "existing",
        admin_player_id: "p1",
        tournament_id: "t1",
        started_at: "2026-01-01T18:00:00.000Z",
        ended_at: "2026-01-01T22:00:00.000Z",
        amount_rub: 4000,
      }),
    ]);
    await expect(createHistoricalAdminShift({ ...HISTORICAL_INPUT, amountRub: 4000 })).rejects.toThrow(
      AdminShiftDuplicateError
    );
    expect(mocks.createCompletedShift).not.toHaveBeenCalled();
  });

  it("rejects a time-overlapping shift for the SAME admin, even with a different tournament/amount", async () => {
    mocks.listShiftsByAdminId.mockResolvedValue([
      shiftRow({
        id: "existing",
        admin_player_id: "p1",
        tournament_id: "t2",
        started_at: "2026-01-01T19:00:00.000Z",
        ended_at: "2026-01-01T21:00:00.000Z",
        amount_rub: 2000,
      }),
    ]);
    await expect(createHistoricalAdminShift({ ...HISTORICAL_INPUT, amountRub: 4000 })).rejects.toThrow(
      AdminShiftOverlapError
    );
    expect(mocks.createCompletedShift).not.toHaveBeenCalled();
  });

  it("allows the SAME tournament/time for a DIFFERENT admin -- overlap is only ever checked within one admin's own shifts", async () => {
    mocks.listShiftsByAdminId.mockImplementation(async (adminPlayerId: string) =>
      adminPlayerId === "p2"
        ? [
            shiftRow({
              id: "other-admin-shift",
              admin_player_id: "p2",
              tournament_id: "t1",
              started_at: "2026-01-01T18:00:00.000Z",
              ended_at: "2026-01-01T22:00:00.000Z",
              amount_rub: 4000,
            }),
          ]
        : []
    );
    await createHistoricalAdminShift({ ...HISTORICAL_INPUT, amountRub: 4000 });
    expect(mocks.createCompletedShift).toHaveBeenCalled();
  });

  it("back-to-back shifts (one ending exactly when the other starts) are NOT treated as an overlap", async () => {
    mocks.listShiftsByAdminId.mockResolvedValue([
      shiftRow({
        id: "existing",
        admin_player_id: "p1",
        tournament_id: "t2",
        started_at: "2026-01-01T14:00:00.000Z",
        ended_at: "2026-01-01T18:00:00.000Z", // ends exactly when HISTORICAL_INPUT starts
        amount_rub: 4000,
      }),
    ]);
    await createHistoricalAdminShift({ ...HISTORICAL_INPUT, amountRub: 4000 });
    expect(mocks.createCompletedShift).toHaveBeenCalled();
  });

  it("never compares against the admin's own currently-open shift (no ended_at to overlap with)", async () => {
    mocks.listShiftsByAdminId.mockResolvedValue([
      shiftRow({ id: "open", admin_player_id: "p1", ended_at: null }),
    ]);
    await createHistoricalAdminShift({ ...HISTORICAL_INPUT, amountRub: 4000 });
    expect(mocks.createCompletedShift).toHaveBeenCalled();
  });
});

describe("correctAdminShift -- Super Admin correction of a completed shift", () => {
  it("Super Admin can edit the tournament", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ id: "s1", admin_player_id: "p1", tournament_id: "t1", started_at: "2026-01-01T18:00:00.000Z", ended_at: "2026-01-01T22:00:00.000Z", amount_rub: 4000 })
    );
    await correctAdminShift("s1", { tournamentId: "t2" }, "superadmin-1");
    expect(mocks.updateCompletedShift).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ tournament_id: "t2", updated_by_player_id: "superadmin-1" })
    );
  });

  it("Super Admin can edit start/end timestamps", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ id: "s1", admin_player_id: "p1", started_at: "2026-01-01T18:00:00.000Z", ended_at: "2026-01-01T22:00:00.000Z", amount_rub: 4000 })
    );
    await correctAdminShift(
      "s1",
      { startedAt: "2026-01-01T17:00:00.000Z", endedAt: "2026-01-01T21:00:00.000Z" },
      "superadmin-1"
    );
    expect(mocks.updateCompletedShift).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ started_at: "2026-01-01T17:00:00.000Z", ended_at: "2026-01-01T21:00:00.000Z" })
    );
  });

  it("Super Admin can edit the amount", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ id: "s1", admin_player_id: "p1", started_at: "2026-01-01T18:00:00.000Z", ended_at: "2026-01-01T22:00:00.000Z", amount_rub: 4000 })
    );
    await correctAdminShift("s1", { amountRub: 1500 }, "superadmin-1");
    expect(mocks.updateCompletedShift).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ amount_rub: 1500 })
    );
  });

  it("never accepts/changes adminPlayerId -- the correction input type has no such field at all", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ id: "s1", admin_player_id: "p1", started_at: "2026-01-01T18:00:00.000Z", ended_at: "2026-01-01T22:00:00.000Z", amount_rub: 4000 })
    );
    await correctAdminShift("s1", { amountRub: 1500 }, "superadmin-1");
    const patchArg = mocks.updateCompletedShift.mock.calls[0][1];
    expect(patchArg).not.toHaveProperty("admin_player_id");
  });

  it("rejects correcting a still-OPEN shift", async () => {
    mocks.findShiftById.mockResolvedValue(shiftRow({ id: "s1", ended_at: null }));
    await expect(correctAdminShift("s1", { amountRub: 1500 }, "superadmin-1")).rejects.toThrow(
      AdminShiftOpenError
    );
    expect(mocks.updateCompletedShift).not.toHaveBeenCalled();
  });

  it("rejects endedAt before startedAt", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ id: "s1", started_at: "2026-01-01T18:00:00.000Z", ended_at: "2026-01-01T22:00:00.000Z" })
    );
    await expect(
      correctAdminShift("s1", { startedAt: "2026-01-01T23:00:00.000Z" }, "superadmin-1")
    ).rejects.toThrow(InvalidShiftRangeError);
    expect(mocks.updateCompletedShift).not.toHaveBeenCalled();
  });

  it("rejects a negative amount", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ id: "s1", started_at: "2026-01-01T18:00:00.000Z", ended_at: "2026-01-01T22:00:00.000Z" })
    );
    await expect(correctAdminShift("s1", { amountRub: -1 }, "superadmin-1")).rejects.toThrow(InvalidAmountError);
    expect(mocks.updateCompletedShift).not.toHaveBeenCalled();
  });

  it("the corrected shift remains completed -- ended_at is always re-persisted, never cleared", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ id: "s1", started_at: "2026-01-01T18:00:00.000Z", ended_at: "2026-01-01T22:00:00.000Z", amount_rub: 4000 })
    );
    await correctAdminShift("s1", { amountRub: 1500 }, "superadmin-1");
    const patchArg = mocks.updateCompletedShift.mock.calls[0][1];
    expect(patchArg.ended_at).toBe("2026-01-01T22:00:00.000Z");
  });

  it("never recomputes the amount from elapsed time -- editing timestamps alone leaves amount_rub exactly as it was", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ id: "s1", started_at: "2026-01-01T18:00:00.000Z", ended_at: "2026-01-01T22:00:00.000Z", amount_rub: 4000 })
    );
    await correctAdminShift(
      "s1",
      { startedAt: "2026-01-01T10:00:00.000Z", endedAt: "2026-01-01T23:00:00.000Z" },
      "superadmin-1"
    );
    const patchArg = mocks.updateCompletedShift.mock.calls[0][1];
    expect(patchArg.amount_rub).toBe(4000);
  });

  it("rejects a correction that would overlap another shift belonging to the same admin", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ id: "s1", admin_player_id: "p1", started_at: "2026-01-01T18:00:00.000Z", ended_at: "2026-01-01T22:00:00.000Z", amount_rub: 4000 })
    );
    mocks.listShiftsByAdminId.mockResolvedValue([
      shiftRow({ id: "s1", admin_player_id: "p1", started_at: "2026-01-01T18:00:00.000Z", ended_at: "2026-01-01T22:00:00.000Z" }),
      shiftRow({
        id: "s2",
        admin_player_id: "p1",
        started_at: "2026-01-02T18:00:00.000Z",
        ended_at: "2026-01-02T22:00:00.000Z",
      }),
    ]);
    await expect(
      correctAdminShift("s1", { startedAt: "2026-01-02T19:00:00.000Z", endedAt: "2026-01-02T21:00:00.000Z" }, "superadmin-1")
    ).rejects.toThrow(AdminShiftOverlapError);
    expect(mocks.updateCompletedShift).not.toHaveBeenCalled();
  });

  it("never conflicts with itself -- editing a shift's own amount/tournament without moving its time is not flagged as an overlap", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ id: "s1", admin_player_id: "p1", started_at: "2026-01-01T18:00:00.000Z", ended_at: "2026-01-01T22:00:00.000Z", amount_rub: 4000 })
    );
    mocks.listShiftsByAdminId.mockResolvedValue([
      shiftRow({ id: "s1", admin_player_id: "p1", started_at: "2026-01-01T18:00:00.000Z", ended_at: "2026-01-01T22:00:00.000Z" }),
    ]);
    await correctAdminShift("s1", { amountRub: 5000 }, "superadmin-1");
    expect(mocks.updateCompletedShift).toHaveBeenCalled();
  });

  it("rejects an invalid/unknown tournament on correction", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ id: "s1", started_at: "2026-01-01T18:00:00.000Z", ended_at: "2026-01-01T22:00:00.000Z" })
    );
    mocks.findTournamentById.mockRejectedValue(new Error("not found"));
    await expect(correctAdminShift("s1", { tournamentId: "bogus" }, "superadmin-1")).rejects.toThrow(
      InvalidTournamentIdError
    );
    expect(mocks.updateCompletedShift).not.toHaveBeenCalled();
  });

  it("allows clearing the tournament to null ('Без турнира') on correction, same as the live flow's convention", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ id: "s1", started_at: "2026-01-01T18:00:00.000Z", ended_at: "2026-01-01T22:00:00.000Z", tournament_id: "t1" })
    );
    await correctAdminShift("s1", { tournamentId: null }, "superadmin-1");
    expect(mocks.updateCompletedShift).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ tournament_id: null })
    );
    expect(mocks.findTournamentById).not.toHaveBeenCalled();
  });

  it("rejects a non-existent shift", async () => {
    mocks.findShiftById.mockResolvedValue(null);
    await expect(correctAdminShift("missing", { amountRub: 1000 }, "superadmin-1")).rejects.toThrow(
      AdminShiftNotFoundError
    );
  });
});

describe("historical creation does not interfere with the one-open-shift constraint or today's live shift", () => {
  it("startAdminShift (self-service) is completely unaffected by historical backfill existing in the same module", async () => {
    mocks.findOpenShiftByAdminId.mockResolvedValue(null);
    await startAdminShift("p1", "2026-01-02T10:00:00.000Z", null);
    expect(mocks.createShift).toHaveBeenCalledTimes(1);
    expect(mocks.createCompletedShift).not.toHaveBeenCalled();
  });

  it("creating a historical shift never calls createShift/closeShift, so it can never trip the one-open-per-admin unique index", async () => {
    await createHistoricalAdminShift({ ...HISTORICAL_INPUT, amountRub: 4000 });
    expect(mocks.createShift).not.toHaveBeenCalled();
    expect(mocks.closeShift).not.toHaveBeenCalled();
    expect(mocks.createCompletedShift).toHaveBeenCalledTimes(1);
  });

  it("an admin with a real open shift can still have a historical shift backfilled for a different, past time range", async () => {
    mocks.listShiftsByAdminId.mockResolvedValue([
      shiftRow({ id: "today-open", admin_player_id: "p1", started_at: "2026-09-20T10:00:00.000Z", ended_at: null }),
    ]);
    await createHistoricalAdminShift({ ...HISTORICAL_INPUT, amountRub: 4000 });
    expect(mocks.createCompletedShift).toHaveBeenCalled();
  });
});

// RERAISE Finance export's admin-payroll aggregation. Same test shape as
// getTournamentDealerPayoutSummary's own describe block in dealers.test.ts.
describe("getTournamentAdminPayoutSummary", () => {
  // A) no shifts -> 0
  it("A: returns payoutRub 0 when there are no shifts at all for this tournament", async () => {
    mocks.listShiftsByTournamentId.mockResolvedValue([]);
    const summary = await getTournamentAdminPayoutSummary("t1");
    expect(summary).toEqual({ adminsCount: 0, payoutRub: 0 });
    expect(mocks.listShiftsByTournamentId).toHaveBeenCalledWith("t1");
  });

  // B) one completed linked shift: 4000 -> 4000
  it("B: sums a single completed linked shift", async () => {
    mocks.listShiftsByTournamentId.mockResolvedValue([
      shiftRow({ id: "s1", admin_player_id: "p1", tournament_id: "t1", ended_at: "2026-01-01T22:00:00.000Z", amount_rub: 4000 }),
    ]);
    const summary = await getTournamentAdminPayoutSummary("t1");
    expect(summary).toEqual({ adminsCount: 1, payoutRub: 4000 });
  });

  // C) two completed linked shifts: 4000 + 2000 -> 6000
  it("C: sums multiple completed linked shifts across different admins", async () => {
    mocks.listShiftsByTournamentId.mockResolvedValue([
      shiftRow({ id: "s1", admin_player_id: "p1", tournament_id: "t1", ended_at: "2026-01-01T22:00:00.000Z", amount_rub: 4000 }),
      shiftRow({ id: "s2", admin_player_id: "p2", tournament_id: "t1", ended_at: "2026-01-02T22:00:00.000Z", amount_rub: 2000 }),
    ]);
    const summary = await getTournamentAdminPayoutSummary("t1");
    expect(summary).toEqual({ adminsCount: 2, payoutRub: 6000 });
  });

  // D) open linked shift -> ignored
  it("D: excludes a still-open shift (ended_at null) even if linked to this tournament", async () => {
    mocks.listShiftsByTournamentId.mockResolvedValue([
      shiftRow({ id: "open", admin_player_id: "p1", tournament_id: "t1", ended_at: null, amount_rub: 4000 }),
    ]);
    const summary = await getTournamentAdminPayoutSummary("t1");
    expect(summary).toEqual({ adminsCount: 0, payoutRub: 0 });
  });

  // E) completed shift with tournament_id = null -> ignored (structural --
  // listShiftsByTournamentId itself is the tournament_id filter, so a NULL
  // row could never be returned by it in the first place; asserted here by
  // confirming the repository is queried with the exact scope, not
  // re-filtered client-side).
  it("E: only ever queries shifts scoped to this exact tournament -- 'Без турнира' shifts are never attributed", async () => {
    mocks.listShiftsByTournamentId.mockResolvedValue([]);
    const summary = await getTournamentAdminPayoutSummary("t1");
    expect(summary).toEqual({ adminsCount: 0, payoutRub: 0 });
    expect(mocks.listShiftsByTournamentId).toHaveBeenCalledWith("t1");
  });

  // F) shift from another tournament -> ignored (same structural reasoning
  // as E: the mock only ever returns what a real query scoped to "t1"
  // would, so a shift belonging to "t2" is never in the input at all).
  it("F: never sums a shift belonging to a different tournament", async () => {
    mocks.listShiftsByTournamentId.mockImplementation(async (tournamentId: string) =>
      tournamentId === "t1"
        ? [shiftRow({ id: "s1", tournament_id: "t1", ended_at: "2026-01-01T22:00:00.000Z", amount_rub: 4000 })]
        : []
    );
    const summary = await getTournamentAdminPayoutSummary("t2");
    expect(summary).toEqual({ adminsCount: 0, payoutRub: 0 });
  });

  // G) historical completed shift and live completed shift -> summed identically
  it("G: a historical (backfilled) shift and a live self-service shift sum identically -- no distinction once completed", async () => {
    mocks.listShiftsByTournamentId.mockResolvedValue([
      // "Historical" shift: created_by === ended_by (both set by the same
      // Super Admin action, see createHistoricalAdminShift).
      shiftRow({
        id: "historical",
        admin_player_id: "p1",
        tournament_id: "t1",
        ended_at: "2026-01-01T22:00:00.000Z",
        amount_rub: 4000,
        created_by_player_id: "superadmin-1",
        ended_by_player_id: "superadmin-1",
      }),
      // "Live" shift: created_by is the admin themselves (self-service).
      shiftRow({
        id: "live",
        admin_player_id: "p2",
        tournament_id: "t1",
        ended_at: "2026-01-02T22:00:00.000Z",
        amount_rub: 4000,
        created_by_player_id: "p2",
        ended_by_player_id: "p2",
      }),
    ]);
    const summary = await getTournamentAdminPayoutSummary("t1");
    expect(summary).toEqual({ adminsCount: 2, payoutRub: 8000 });
  });

  it("uses the shift's own frozen amount_rub, never a duration/default/role-based inference", async () => {
    mocks.listShiftsByTournamentId.mockResolvedValue([
      shiftRow({
        id: "s1",
        admin_player_id: "p1",
        tournament_id: "t1",
        started_at: "2026-01-01T10:00:00.000Z",
        ended_at: "2026-01-01T22:00:00.000Z", // 12 hours -- irrelevant to the payout
        amount_rub: 1500, // deliberately NOT the 4000 default
      }),
    ]);
    const summary = await getTournamentAdminPayoutSummary("t1");
    expect(summary.payoutRub).toBe(1500);
  });
});
