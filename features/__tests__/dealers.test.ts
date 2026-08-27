import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findProfileByPlayerId: vi.fn(),
  listActiveProfiles: vi.fn(),
  createProfile: vi.fn(),
  setProfileActive: vi.fn(),
  setProfileHourlyRate: vi.fn(),
  findOpenShiftByDealerId: vi.fn(),
  findShiftById: vi.fn(),
  createShift: vi.fn(),
  closeShift: vi.fn(),
  updateShiftTimestamps: vi.fn(),
  listShiftsStartedBetween: vi.fn(),
  listRecentCompletedShifts: vi.fn(),
  updateShiftTournament: vi.fn(),
  setShiftTaxiAllowance: vi.fn(),
  reassignShiftDealer: vi.fn(),
  listShiftsByDealerId: vi.fn(),
  listShiftsByTournamentId: vi.fn(),
  listAllShifts: vi.fn(),
  findById: vi.fn(),
  findByIdOrThrow: vi.fn(),
  findSummariesByIds: vi.fn(),
  findTournamentById: vi.fn(),
}));

class MockDealerAlreadyOnShiftError extends Error {
  constructor(dealerPlayerId: string) {
    super(`Dealer ${dealerPlayerId} already has an open shift`);
    this.name = "DealerAlreadyOnShiftError";
  }
}

vi.mock("@/lib/repositories", () => ({
  dealerRepository: {
    findProfileByPlayerId: mocks.findProfileByPlayerId,
    listActiveProfiles: mocks.listActiveProfiles,
    createProfile: mocks.createProfile,
    setProfileActive: mocks.setProfileActive,
    setProfileHourlyRate: mocks.setProfileHourlyRate,
    findOpenShiftByDealerId: mocks.findOpenShiftByDealerId,
    findShiftById: mocks.findShiftById,
    createShift: mocks.createShift,
    closeShift: mocks.closeShift,
    updateShiftTimestamps: mocks.updateShiftTimestamps,
    listShiftsStartedBetween: mocks.listShiftsStartedBetween,
    listRecentCompletedShifts: mocks.listRecentCompletedShifts,
    updateShiftTournament: mocks.updateShiftTournament,
    setShiftTaxiAllowance: mocks.setShiftTaxiAllowance,
    reassignShiftDealer: mocks.reassignShiftDealer,
    listShiftsByDealerId: mocks.listShiftsByDealerId,
    listShiftsByTournamentId: mocks.listShiftsByTournamentId,
    listAllShifts: mocks.listAllShifts,
  },
  playerRepository: {
    findById: mocks.findById,
    findByIdOrThrow: mocks.findByIdOrThrow,
    findSummariesByIds: mocks.findSummariesByIds,
  },
  tournamentRepository: {
    findById: mocks.findTournamentById,
  },
  DealerAlreadyOnShiftError: MockDealerAlreadyOnShiftError,
}));

const {
  activateDealer,
  deactivateDealer,
  updateDealerHourlyRate,
  startDealerShift,
  endDealerShift,
  editDealerShiftTimestamps,
  correctDealerShiftTournament,
  correctDealerShiftDealer,
  setDealerShiftTaxiAllowance,
  getDealerPayrollStats,
  getPersonalDealerSummary,
  getTournamentDealerPayoutSummary,
  listTodayDealerShifts,
  computeShiftPayroll,
  InvalidTournamentIdError,
  InvalidTaxiAllowanceError,
  DealerNotFoundError,
  DealerHasOpenShiftError,
  DealerAlreadyOnShiftError,
  DealerShiftNotFoundError,
  DEFAULT_DEALER_HOURLY_RATE_RUB,
  TAXI_ALLOWANCE_RUB,
} = await import("@/features/dealers");

function profile(overrides: Partial<{ player_id: string; is_active: boolean; hourly_rate_rub: number }> = {}) {
  return {
    player_id: "p1",
    is_active: true,
    hourly_rate_rub: 500,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function shiftRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "s1",
    dealer_player_id: "p1",
    started_at: "2026-01-01T18:00:00.000Z",
    ended_at: null,
    hourly_rate_rub: 500,
    worked_minutes: null,
    paid_hours: null,
    amount_rub: null,
    taxi_allowance_rub: 0,
    tournament_id: null,
    created_by_player_id: null,
    ended_by_player_id: null,
    created_at: "2026-01-01T18:00:00.000Z",
    updated_at: "2026-01-01T18:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findByIdOrThrow.mockResolvedValue({ id: "p1", display_name: "Alice" });
  mocks.createProfile.mockResolvedValue(profile());
  mocks.setProfileActive.mockImplementation(async (playerId: string, isActive: boolean) =>
    profile({ player_id: playerId, is_active: isActive })
  );
  mocks.setProfileHourlyRate.mockImplementation(async (playerId: string, rate: number) =>
    profile({ player_id: playerId, hourly_rate_rub: rate })
  );
  mocks.findOpenShiftByDealerId.mockResolvedValue(null);
  mocks.createShift.mockImplementation(async (row: Record<string, unknown>) =>
    shiftRow({
      dealer_player_id: row.dealer_player_id,
      started_at: row.started_at,
      hourly_rate_rub: row.hourly_rate_rub,
      tournament_id: row.tournament_id ?? null,
    })
  );
  mocks.updateShiftTournament.mockImplementation(async (id: string, tournamentId: string | null) =>
    shiftRow({ id, tournament_id: tournamentId })
  );
  mocks.setShiftTaxiAllowance.mockImplementation(async (id: string, taxiAllowanceRub: number) =>
    shiftRow({ id, taxi_allowance_rub: taxiAllowanceRub })
  );
  mocks.listShiftsByTournamentId.mockResolvedValue([]);
  mocks.findTournamentById.mockResolvedValue({ id: "t1", title: "Classic", start_at: "2026-08-27T18:00:00.000Z" });
  mocks.closeShift.mockImplementation(async (id: string, patch: Record<string, unknown>) =>
    shiftRow({ id, ended_at: patch.ended_at, worked_minutes: patch.worked_minutes, paid_hours: patch.paid_hours, amount_rub: patch.amount_rub })
  );
  mocks.updateShiftTimestamps.mockImplementation(async (id: string, patch: Record<string, unknown>) =>
    shiftRow({ id, started_at: patch.started_at, ended_at: patch.ended_at, worked_minutes: patch.worked_minutes, paid_hours: patch.paid_hours, amount_rub: patch.amount_rub })
  );
  mocks.listShiftsStartedBetween.mockResolvedValue([]);
  mocks.findSummariesByIds.mockResolvedValue([{ id: "p1", display_name: "Alice", username: "alice", email: null, role: "player" }]);
});

describe("activateDealer", () => {
  it("activates a dealer from an existing player at the default rate", async () => {
    await activateDealer("p1");
    expect(mocks.findByIdOrThrow).toHaveBeenCalledWith("p1");
    expect(mocks.createProfile).toHaveBeenCalledWith("p1", DEFAULT_DEALER_HOURLY_RATE_RUB);
  });

  it("activating an already-active dealer twice is idempotent -- no error, no duplicate side effect", async () => {
    await activateDealer("p1");
    await activateDealer("p1");
    expect(mocks.createProfile).toHaveBeenCalledTimes(2);
    expect(mocks.createProfile).toHaveBeenNthCalledWith(1, "p1", DEFAULT_DEALER_HOURLY_RATE_RUB);
    expect(mocks.createProfile).toHaveBeenNthCalledWith(2, "p1", DEFAULT_DEALER_HOURLY_RATE_RUB);
  });
});

describe("deactivateDealer", () => {
  it("deactivating flips is_active only -- never touches shift history", async () => {
    mocks.findProfileByPlayerId.mockResolvedValue(profile());
    await deactivateDealer("p1");
    expect(mocks.setProfileActive).toHaveBeenCalledWith("p1", false);
    // No shift-mutating method exists on the mocked repository at all --
    // the interface itself has no "delete shifts" capability, so history
    // preservation is structural, not just behavioral.
    expect(mocks.closeShift).not.toHaveBeenCalled();
    expect(mocks.updateShiftTimestamps).not.toHaveBeenCalled();
  });

  it("a dealer with an open shift cannot be deactivated", async () => {
    mocks.findProfileByPlayerId.mockResolvedValue(profile());
    mocks.findOpenShiftByDealerId.mockResolvedValue(shiftRow());

    await expect(deactivateDealer("p1")).rejects.toThrow(DealerHasOpenShiftError);
    expect(mocks.setProfileActive).not.toHaveBeenCalled();
  });
});

describe("startDealerShift", () => {
  it("cannot start a second open shift for the same dealer", async () => {
    mocks.findProfileByPlayerId.mockResolvedValue(profile());
    mocks.findOpenShiftByDealerId.mockResolvedValue(shiftRow());

    await expect(
      startDealerShift("p1", "2026-01-02T10:00:00.000Z", null, null)
    ).rejects.toThrow(DealerAlreadyOnShiftError);
    expect(mocks.createShift).not.toHaveBeenCalled();
  });

  it("snapshots the dealer's CURRENT hourly rate into the new shift", async () => {
    mocks.findProfileByPlayerId.mockResolvedValue(profile({ hourly_rate_rub: 650 }));

    await startDealerShift("p1", "2026-01-02T10:00:00.000Z", null, "admin-1");

    expect(mocks.createShift).toHaveBeenCalledWith(
      expect.objectContaining({ dealer_player_id: "p1", hourly_rate_rub: 650, created_by_player_id: "admin-1" })
    );
  });

  it("a shift may link to a real tournament", async () => {
    mocks.findProfileByPlayerId.mockResolvedValue(profile());
    mocks.findTournamentById.mockResolvedValue({ id: "t1", title: "Classic", start_at: "x" });

    await startDealerShift("p1", "2026-01-02T10:00:00.000Z", "t1", null);

    expect(mocks.createShift).toHaveBeenCalledWith(expect.objectContaining({ tournament_id: "t1" }));
  });

  it("an invalid/unknown tournament ID is rejected -- never trusted from the client", async () => {
    mocks.findProfileByPlayerId.mockResolvedValue(profile());
    mocks.findTournamentById.mockRejectedValue(new Error("not found"));

    await expect(
      startDealerShift("p1", "2026-01-02T10:00:00.000Z", "bogus-id", null)
    ).rejects.toThrow(InvalidTournamentIdError);
    expect(mocks.createShift).not.toHaveBeenCalled();
  });

  it("historical/no tournament (null) is allowed -- 'Без турнира' is a legitimate choice, never invented", async () => {
    mocks.findProfileByPlayerId.mockResolvedValue(profile());

    await startDealerShift("p1", "2026-01-02T10:00:00.000Z", null, null);

    expect(mocks.createShift).toHaveBeenCalledWith(expect.objectContaining({ tournament_id: null }));
    expect(mocks.findTournamentById).not.toHaveBeenCalled();
  });

  it("actor attribution: created_by_player_id is whatever the caller resolved server-side, passed through unchanged -- this function itself never re-derives or trusts a role", async () => {
    mocks.findProfileByPlayerId.mockResolvedValue(profile());

    await startDealerShift("p1", "2026-01-02T10:00:00.000Z", null, "resolved-actor-id");

    expect(mocks.createShift).toHaveBeenCalledWith(
      expect.objectContaining({ created_by_player_id: "resolved-actor-id" })
    );
  });
});

describe("correctDealerShiftTournament", () => {
  it("Super Admin may correct the tournament link on an existing shift", async () => {
    mocks.findShiftById.mockResolvedValue(shiftRow({ id: "s1", tournament_id: null }));
    mocks.findTournamentById.mockResolvedValue({ id: "t2", title: "Bounty", start_at: "x" });

    await correctDealerShiftTournament("s1", "t2");

    expect(mocks.updateShiftTournament).toHaveBeenCalledWith("s1", "t2");
  });

  it("rejects an invalid tournament ID", async () => {
    mocks.findShiftById.mockResolvedValue(shiftRow({ id: "s1" }));
    mocks.findTournamentById.mockRejectedValue(new Error("not found"));

    await expect(correctDealerShiftTournament("s1", "bogus")).rejects.toThrow(InvalidTournamentIdError);
    expect(mocks.updateShiftTournament).not.toHaveBeenCalled();
  });
});

describe("setDealerShiftTaxiAllowance (\"Чай\")", () => {
  it("Super Admin can add the allowance to an OPEN shift (before amount_rub is frozen)", async () => {
    mocks.findShiftById.mockResolvedValue(shiftRow({ id: "s1", ended_at: null, amount_rub: null }));

    await setDealerShiftTaxiAllowance("s1", TAXI_ALLOWANCE_RUB);

    expect(mocks.setShiftTaxiAllowance).toHaveBeenCalledWith("s1", 500);
  });

  it("Super Admin can add the allowance to a completed shift", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ id: "s1", ended_at: "x", worked_minutes: 60, paid_hours: 1, amount_rub: 500 })
    );

    await setDealerShiftTaxiAllowance("s1", TAXI_ALLOWANCE_RUB);

    expect(mocks.setShiftTaxiAllowance).toHaveBeenCalledWith("s1", 500);
  });

  it("Super Admin can remove/cancel a mistakenly-added allowance", async () => {
    mocks.findShiftById.mockResolvedValue(shiftRow({ id: "s1", taxi_allowance_rub: 500 }));

    await setDealerShiftTaxiAllowance("s1", 0);

    expect(mocks.setShiftTaxiAllowance).toHaveBeenCalledWith("s1", 0);
  });

  it("only ever resolves to 0 or 500 -- any other value is rejected before touching the repository", async () => {
    mocks.findShiftById.mockResolvedValue(shiftRow({ id: "s1" }));

    await expect(setDealerShiftTaxiAllowance("s1", 250)).rejects.toThrow(InvalidTaxiAllowanceError);
    await expect(setDealerShiftTaxiAllowance("s1", -500)).rejects.toThrow(InvalidTaxiAllowanceError);
    await expect(setDealerShiftTaxiAllowance("s1", 1000)).rejects.toThrow(InvalidTaxiAllowanceError);
    expect(mocks.setShiftTaxiAllowance).not.toHaveBeenCalled();
  });

  it("rejects a non-existent shift", async () => {
    mocks.findShiftById.mockResolvedValue(null);

    await expect(setDealerShiftTaxiAllowance("missing", 500)).rejects.toThrow(DealerShiftNotFoundError);
    expect(mocks.setShiftTaxiAllowance).not.toHaveBeenCalled();
  });

  it("does not change worked_minutes/paid_hours/hourly_rate_rub/amount_rub -- only the repository call, never a payroll recompute", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ id: "s1", ended_at: "x", worked_minutes: 90, paid_hours: 2, hourly_rate_rub: 600, amount_rub: 1200 })
    );

    await setDealerShiftTaxiAllowance("s1", TAXI_ALLOWANCE_RUB);

    expect(mocks.setShiftTaxiAllowance).toHaveBeenCalledWith("s1", 500);
    expect(mocks.closeShift).not.toHaveBeenCalled();
    expect(mocks.updateShiftTimestamps).not.toHaveBeenCalled();
  });
});

describe("computeShiftPayroll -- exact rounding rule", () => {
  const rate = 500;

  it("5h00 -> 5 paid hours, 2500 RUB", () => {
    const result = computeShiftPayroll(new Date(Date.UTC(2026, 0, 1, 10, 0)), new Date(Date.UTC(2026, 0, 1, 15, 0)), rate);
    expect(result).toEqual({ workedMinutes: 300, paidHours: 5, amountRub: 2500 });
  });

  it("5h01 -> 6 paid hours, 3000 RUB", () => {
    const result = computeShiftPayroll(new Date(Date.UTC(2026, 0, 1, 10, 0)), new Date(Date.UTC(2026, 0, 1, 15, 1)), rate);
    expect(result).toEqual({ workedMinutes: 301, paidHours: 6, amountRub: 3000 });
  });

  it("5h30 -> 6 paid hours", () => {
    const result = computeShiftPayroll(new Date(Date.UTC(2026, 0, 1, 10, 0)), new Date(Date.UTC(2026, 0, 1, 15, 30)), rate);
    expect(result.paidHours).toBe(6);
  });

  it("5h59 -> 6 paid hours", () => {
    const result = computeShiftPayroll(new Date(Date.UTC(2026, 0, 1, 10, 0)), new Date(Date.UTC(2026, 0, 1, 15, 59)), rate);
    expect(result.paidHours).toBe(6);
  });

  it("6h00 -> 6 paid hours", () => {
    const result = computeShiftPayroll(new Date(Date.UTC(2026, 0, 1, 10, 0)), new Date(Date.UTC(2026, 0, 1, 16, 0)), rate);
    expect(result.paidHours).toBe(6);
  });

  it("6h01 -> 7 paid hours", () => {
    const result = computeShiftPayroll(new Date(Date.UTC(2026, 0, 1, 10, 0)), new Date(Date.UTC(2026, 0, 1, 16, 1)), rate);
    expect(result.paidHours).toBe(7);
  });

  it("overnight shift (18:30 -> 01:15 next day) works correctly", () => {
    const started = new Date(Date.UTC(2026, 0, 1, 18, 30));
    const ended = new Date(Date.UTC(2026, 0, 2, 1, 15));
    const result = computeShiftPayroll(started, ended, rate);
    expect(result.workedMinutes).toBe(6 * 60 + 45);
    expect(result.paidHours).toBe(7);
    expect(result.amountRub).toBe(3500);
  });

  it("rejects end before start", () => {
    expect(() =>
      computeShiftPayroll(new Date(Date.UTC(2026, 0, 1, 15, 0)), new Date(Date.UTC(2026, 0, 1, 10, 0)), rate)
    ).toThrow();
  });

  it("rejects zero duration", () => {
    const t = new Date(Date.UTC(2026, 0, 1, 10, 0));
    expect(() => computeShiftPayroll(t, new Date(t), rate)).toThrow();
  });

  it("rejects invalid dates", () => {
    expect(() => computeShiftPayroll(new Date("not a date"), new Date(Date.UTC(2026, 0, 1, 10, 0)), rate)).toThrow();
  });
});

describe("endDealerShift", () => {
  it("uses the shift's SNAPSHOTTED rate, not the dealer's current profile rate", async () => {
    mocks.findShiftById.mockResolvedValue(shiftRow({ started_at: "2026-01-01T10:00:00.000Z", hourly_rate_rub: 500 }));

    await endDealerShift("s1", "2026-01-01T15:01:00.000Z", null);

    expect(mocks.closeShift).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ worked_minutes: 301, paid_hours: 6, amount_rub: 3000 })
    );
    // The profile's rate is never even read here.
    expect(mocks.findProfileByPlayerId).not.toHaveBeenCalled();
  });
});

describe("changing dealer rate never affects an existing shift", () => {
  it("updateDealerHourlyRate only writes the profile; a later endDealerShift for an already-open shift still uses the OLD snapshotted rate", async () => {
    mocks.findProfileByPlayerId.mockResolvedValue(profile({ hourly_rate_rub: 500 }));
    await updateDealerHourlyRate("p1", 700);
    expect(mocks.setProfileHourlyRate).toHaveBeenCalledWith("p1", 700);

    // The open shift was created back when the rate was still 500 --
    // its own row already carries hourly_rate_rub: 500 (snapshot), and
    // that's what closeShift must compute from now, not the new 700.
    mocks.findShiftById.mockResolvedValue(shiftRow({ started_at: "2026-01-01T10:00:00.000Z", hourly_rate_rub: 500 }));
    await endDealerShift("s1", "2026-01-01T15:00:00.000Z", null);

    expect(mocks.closeShift).toHaveBeenCalledWith("s1", expect.objectContaining({ amount_rub: 2500 }));
  });
});

describe("editDealerShiftTimestamps", () => {
  it("recalculates worked_minutes/paid_hours/amount_rub from corrected timestamps, keeping the snapshotted rate", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ started_at: "2026-01-01T10:00:00.000Z", ended_at: "2026-01-01T14:00:00.000Z", hourly_rate_rub: 500 })
    );

    await editDealerShiftTimestamps("s1", "2026-01-01T10:00:00.000Z", "2026-01-01T15:01:00.000Z");

    expect(mocks.updateShiftTimestamps).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ worked_minutes: 301, paid_hours: 6, amount_rub: 3000 })
    );
  });

  it("cannot edit-as-completed a shift that is still open", async () => {
    mocks.findShiftById.mockResolvedValue(shiftRow({ ended_at: null }));

    await expect(
      editDealerShiftTimestamps("s1", "2026-01-01T10:00:00.000Z", "2026-01-01T15:00:00.000Z")
    ).rejects.toThrow();
    expect(mocks.updateShiftTimestamps).not.toHaveBeenCalled();
  });

  it("Super Admin can correct the snapshotted hourly_rate_rub, and amount_rub is recomputed with the NEW rate", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ started_at: "2026-01-01T10:00:00.000Z", ended_at: "2026-01-01T14:00:00.000Z", hourly_rate_rub: 500 })
    );

    await editDealerShiftTimestamps(
      "s1",
      "2026-01-01T10:00:00.000Z",
      "2026-01-01T14:00:00.000Z",
      700
    );

    expect(mocks.updateShiftTimestamps).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ hourly_rate_rub: 700, worked_minutes: 240, paid_hours: 4, amount_rub: 2800 })
    );
  });

  it("correcting BOTH timestamps and rate at once recomputes worked_minutes/paid_hours/amount_rub together, not from stale intermediate state", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ started_at: "2026-01-01T10:00:00.000Z", ended_at: "2026-01-01T14:00:00.000Z", hourly_rate_rub: 500 })
    );

    await editDealerShiftTimestamps(
      "s1",
      "2026-01-01T10:00:00.000Z",
      "2026-01-01T13:00:00.000Z", // corrected to 3h instead of 4h
      1000 // corrected rate
    );

    expect(mocks.updateShiftTimestamps).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ worked_minutes: 180, paid_hours: 3, hourly_rate_rub: 1000, amount_rub: 3000 })
    );
  });

  it("omitting hourlyRateRub keeps the existing snapshotted rate unchanged (backward compatible)", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ started_at: "2026-01-01T10:00:00.000Z", ended_at: "2026-01-01T14:00:00.000Z", hourly_rate_rub: 500 })
    );

    await editDealerShiftTimestamps("s1", "2026-01-01T10:00:00.000Z", "2026-01-01T14:00:00.000Z");

    expect(mocks.updateShiftTimestamps).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ hourly_rate_rub: 500 })
    );
  });

  it("rejects a negative corrected rate before touching the repository", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ started_at: "2026-01-01T10:00:00.000Z", ended_at: "2026-01-01T14:00:00.000Z", hourly_rate_rub: 500 })
    );

    await expect(
      editDealerShiftTimestamps("s1", "2026-01-01T10:00:00.000Z", "2026-01-01T14:00:00.000Z", -100)
    ).rejects.toThrow(/неотрицательным/);
    expect(mocks.updateShiftTimestamps).not.toHaveBeenCalled();
  });

  it("there is no way to submit an arbitrary amount_rub directly -- only timestamps/rate flow into the recomputed payroll", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ started_at: "2026-01-01T10:00:00.000Z", ended_at: "2026-01-01T14:00:00.000Z", hourly_rate_rub: 500 })
    );

    // editDealerShiftTimestamps's signature has no amount_rub parameter at
    // all -- amount_rub is always the server-computed
    // paid_hours * hourly_rate_rub, never a caller-supplied value.
    await editDealerShiftTimestamps("s1", "2026-01-01T10:00:00.000Z", "2026-01-01T14:00:00.000Z", 500);

    expect(mocks.updateShiftTimestamps).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ amount_rub: 2000 }) // 4h * 500, never anything else
    );
  });
});

describe("correctDealerShiftDealer", () => {
  it("Super Admin can reassign a completed shift to a different (valid) dealer", async () => {
    mocks.findShiftById.mockResolvedValue(shiftRow({ id: "s1", dealer_player_id: "p1", ended_at: "x" }));
    mocks.findProfileByPlayerId.mockResolvedValue(profile({ player_id: "p2" }));

    await correctDealerShiftDealer("s1", "p2");

    expect(mocks.reassignShiftDealer).toHaveBeenCalledWith("s1", "p2");
  });

  it("moves the shift between personal dealer history/stats immediately -- keyed purely off dealer_player_id, no payroll touched", async () => {
    mocks.findShiftById.mockResolvedValue(
      shiftRow({ id: "s1", dealer_player_id: "p1", ended_at: "x", worked_minutes: 60, paid_hours: 1, amount_rub: 500, hourly_rate_rub: 500 })
    );
    mocks.findProfileByPlayerId.mockResolvedValue(profile({ player_id: "p2" }));

    await correctDealerShiftDealer("s1", "p2");

    expect(mocks.reassignShiftDealer).toHaveBeenCalledWith("s1", "p2");
    expect(mocks.updateShiftTimestamps).not.toHaveBeenCalled();
    expect(mocks.closeShift).not.toHaveBeenCalled();
  });

  it("rejects reassigning to a player with no dealer profile at all (not 'has valid dealer history')", async () => {
    mocks.findShiftById.mockResolvedValue(shiftRow({ id: "s1", ended_at: "x" }));
    mocks.findProfileByPlayerId.mockResolvedValue(null);

    await expect(correctDealerShiftDealer("s1", "not-a-dealer")).rejects.toThrow(DealerNotFoundError);
    expect(mocks.reassignShiftDealer).not.toHaveBeenCalled();
  });

  it("allows reassigning to an INACTIVE (deactivated) former dealer -- 'valid dealer history' doesn't require currently active", async () => {
    mocks.findShiftById.mockResolvedValue(shiftRow({ id: "s1", ended_at: "x" }));
    mocks.findProfileByPlayerId.mockResolvedValue(profile({ player_id: "p2", is_active: false }));

    await correctDealerShiftDealer("s1", "p2");

    expect(mocks.reassignShiftDealer).toHaveBeenCalledWith("s1", "p2");
  });

  it("cannot reassign an OPEN shift -- dealer correction is for completed shifts only", async () => {
    mocks.findShiftById.mockResolvedValue(shiftRow({ id: "s1", ended_at: null }));

    await expect(correctDealerShiftDealer("s1", "p2")).rejects.toThrow();
    expect(mocks.reassignShiftDealer).not.toHaveBeenCalled();
  });

  it("rejects a non-existent shift", async () => {
    mocks.findShiftById.mockResolvedValue(null);

    await expect(correctDealerShiftDealer("missing", "p2")).rejects.toThrow(DealerShiftNotFoundError);
    expect(mocks.reassignShiftDealer).not.toHaveBeenCalled();
  });
});

describe("listTodayDealerShifts -- grouping by started_at", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15, 10, 30));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("queries the repository with today's local-day boundaries", async () => {
    await listTodayDealerShifts();
    expect(mocks.listShiftsStartedBetween).toHaveBeenCalledWith(
      new Date(2026, 0, 15).toISOString(),
      new Date(2026, 0, 16).toISOString()
    );
  });

  it("an overnight shift belongs to the day it STARTED, not the day it ended", async () => {
    mocks.listShiftsStartedBetween.mockResolvedValue([
      shiftRow({
        id: "overnight",
        started_at: new Date(2026, 0, 15, 20, 0).toISOString(),
        ended_at: new Date(2026, 0, 16, 2, 0).toISOString(),
        worked_minutes: 360,
        paid_hours: 6,
        amount_rub: 3000,
      }),
    ]);

    const { shifts } = await listTodayDealerShifts();
    expect(shifts).toHaveLength(1);
    expect(shifts[0].id).toBe("overnight");
  });

  it("excludes still-open shifts from the today summary", async () => {
    mocks.listShiftsStartedBetween.mockResolvedValue([shiftRow({ id: "open", ended_at: null })]);

    const { shifts, totalPayoutRub } = await listTodayDealerShifts();
    expect(shifts).toHaveLength(0);
    expect(totalPayoutRub).toBe(0);
  });

  it("totalPayoutRub includes the taxi allowance, not just the base amount", async () => {
    mocks.listShiftsStartedBetween.mockResolvedValue([
      shiftRow({ id: "s1", ended_at: "x", worked_minutes: 60, paid_hours: 1, amount_rub: 500, taxi_allowance_rub: 500 }),
    ]);

    const { totalPayoutRub } = await listTodayDealerShifts();
    expect(totalPayoutRub).toBe(1000);
  });
});

describe("getDealerPayrollStats", () => {
  it("aggregates correctly by dealer -- multiple shifts across multiple tournaments for one dealer", async () => {
    mocks.listAllShifts.mockResolvedValue([
      shiftRow({ id: "s1", dealer_player_id: "p1", tournament_id: "t1", ended_at: "x", worked_minutes: 60, paid_hours: 1, amount_rub: 500 }),
      shiftRow({ id: "s2", dealer_player_id: "p1", tournament_id: "t2", ended_at: "x", worked_minutes: 120, paid_hours: 2, amount_rub: 1000 }),
    ]);
    mocks.findSummariesByIds.mockResolvedValue([{ id: "p1", display_name: "Alice", username: "alice", email: null, role: "player" }]);
    mocks.findTournamentById.mockImplementation(async (id: string) => ({ id, title: `T-${id}`, start_at: "2026-08-01T00:00:00.000Z" }));

    const stats = await getDealerPayrollStats("all");

    expect(stats.byDealer).toEqual([
      {
        dealerPlayerId: "p1",
        dealerDisplayName: "Alice",
        tournamentCount: 2,
        shiftCount: 2,
        workedMinutes: 180,
        paidHours: 3,
        amountRub: 1500,
        taxiAllowanceRub: 0,
        payoutRub: 1500,
      },
    ]);
  });

  it("aggregates correctly by tournament -- multiple dealers on the same tournament", async () => {
    mocks.listAllShifts.mockResolvedValue([
      shiftRow({ id: "s1", dealer_player_id: "p1", tournament_id: "t1", ended_at: "x", worked_minutes: 60, paid_hours: 1, amount_rub: 500 }),
      shiftRow({ id: "s2", dealer_player_id: "p2", tournament_id: "t1", ended_at: "x", worked_minutes: 60, paid_hours: 1, amount_rub: 500 }),
    ]);
    mocks.findSummariesByIds.mockResolvedValue([
      { id: "p1", display_name: "Alice", username: "alice", email: null, role: "player" },
      { id: "p2", display_name: "Bob", username: "bob", email: null, role: "player" },
    ]);
    mocks.findTournamentById.mockResolvedValue({ id: "t1", title: "Classic", start_at: "2026-08-01T00:00:00.000Z" });

    const stats = await getDealerPayrollStats("all");

    expect(stats.byTournament).toEqual([
      {
        tournamentId: "t1",
        tournamentTitle: "Classic",
        tournamentDate: "2026-08-01T00:00:00.000Z",
        dealerCount: 2,
        shiftCount: 2,
        workedMinutes: 120,
        paidHours: 2,
        amountRub: 1000,
        taxiAllowanceRub: 0,
        payoutRub: 1000,
      },
    ]);
    expect(stats.summary).toEqual({
      completedShiftCount: 2,
      uniqueTournamentCount: 1,
      workedMinutes: 120,
      paidHours: 2,
      amountRub: 1000,
      taxiAllowanceRub: 0,
      payoutRub: 1000,
    });
  });

  it("a shift with no linked tournament is grouped under 'Без турнира' in byTournament, but still counted in the summary", async () => {
    mocks.listAllShifts.mockResolvedValue([
      shiftRow({ id: "s1", dealer_player_id: "p1", tournament_id: null, ended_at: "x", worked_minutes: 60, paid_hours: 1, amount_rub: 500 }),
    ]);
    mocks.findSummariesByIds.mockResolvedValue([{ id: "p1", display_name: "Alice", username: "alice", email: null, role: "player" }]);

    const stats = await getDealerPayrollStats("all");

    expect(stats.byTournament).toEqual([
      expect.objectContaining({ tournamentId: null, tournamentTitle: "Без турнира", shiftCount: 1, amountRub: 500 }),
    ]);
    expect(stats.summary.amountRub).toBe(500);
    expect(stats.summary.uniqueTournamentCount).toBe(0);
  });

  it("open shifts are excluded from finalized payroll totals entirely", async () => {
    mocks.listAllShifts.mockResolvedValue([
      shiftRow({ id: "open", dealer_player_id: "p1", ended_at: null, worked_minutes: null, paid_hours: null, amount_rub: null }),
      shiftRow({ id: "closed", dealer_player_id: "p1", tournament_id: "t1", ended_at: "x", worked_minutes: 60, paid_hours: 1, amount_rub: 500 }),
    ]);
    mocks.findSummariesByIds.mockResolvedValue([{ id: "p1", display_name: "Alice", username: "alice", email: null, role: "player" }]);
    mocks.findTournamentById.mockResolvedValue({ id: "t1", title: "Classic", start_at: "x" });

    const stats = await getDealerPayrollStats("all");

    expect(stats.summary.completedShiftCount).toBe(1);
    expect(stats.summary.amountRub).toBe(500);
  });

  it("'month' period queries only the current local calendar month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 10, 0));
    mocks.listShiftsStartedBetween.mockResolvedValue([]);

    await getDealerPayrollStats("month");

    expect(mocks.listShiftsStartedBetween).toHaveBeenCalledWith(
      new Date(2026, 7, 1).toISOString(),
      new Date(2026, 8, 1).toISOString()
    );
    expect(mocks.listAllShifts).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("Super Admin dealer stats include the taxi allowance in payoutRub, keeping amountRub as base-only", async () => {
    mocks.listAllShifts.mockResolvedValue([
      shiftRow({ id: "s1", dealer_player_id: "p1", tournament_id: "t1", ended_at: "x", worked_minutes: 60, paid_hours: 1, amount_rub: 500, taxi_allowance_rub: 500 }),
      shiftRow({ id: "s2", dealer_player_id: "p1", tournament_id: "t1", ended_at: "x", worked_minutes: 60, paid_hours: 1, amount_rub: 500, taxi_allowance_rub: 0 }),
    ]);
    mocks.findSummariesByIds.mockResolvedValue([{ id: "p1", display_name: "Alice", username: "alice", email: null, role: "player" }]);
    mocks.findTournamentById.mockResolvedValue({ id: "t1", title: "Classic", start_at: "x" });

    const stats = await getDealerPayrollStats("all");

    expect(stats.summary).toEqual(
      expect.objectContaining({ amountRub: 1000, taxiAllowanceRub: 500, payoutRub: 1500 })
    );
    expect(stats.byDealer[0]).toEqual(
      expect.objectContaining({ amountRub: 1000, taxiAllowanceRub: 500, payoutRub: 1500 })
    );
    expect(stats.byTournament[0]).toEqual(
      expect.objectContaining({ amountRub: 1000, taxiAllowanceRub: 500, payoutRub: 1500 })
    );
  });
});

describe("getTournamentDealerPayoutSummary", () => {
  it("counts unique dealers with completed linked shifts and sums base + allowance", async () => {
    mocks.listShiftsByTournamentId.mockResolvedValue([
      shiftRow({ id: "s1", dealer_player_id: "p1", tournament_id: "t1", ended_at: "x", amount_rub: 500, taxi_allowance_rub: 500 }),
      shiftRow({ id: "s2", dealer_player_id: "p1", tournament_id: "t1", ended_at: "x", amount_rub: 500, taxi_allowance_rub: 0 }),
      shiftRow({ id: "s3", dealer_player_id: "p2", tournament_id: "t1", ended_at: "x", amount_rub: 500, taxi_allowance_rub: 0 }),
    ]);

    const summary = await getTournamentDealerPayoutSummary("t1");

    expect(summary).toEqual({ dealersCount: 2, payoutRub: 2000 });
    expect(mocks.listShiftsByTournamentId).toHaveBeenCalledWith("t1");
  });

  it("excludes an open shift (no frozen amount_rub) from the payout total", async () => {
    mocks.listShiftsByTournamentId.mockResolvedValue([
      shiftRow({ id: "open", dealer_player_id: "p1", tournament_id: "t1", ended_at: null, amount_rub: null }),
      shiftRow({ id: "closed", dealer_player_id: "p1", tournament_id: "t1", ended_at: "x", amount_rub: 500, taxi_allowance_rub: 0 }),
    ]);

    const summary = await getTournamentDealerPayoutSummary("t1");

    expect(summary).toEqual({ dealersCount: 1, payoutRub: 500 });
  });

  it("only queries shifts scoped to this exact tournament -- 'Без турнира' shifts are never attributed", async () => {
    // listShiftsByTournamentId itself is the tournament_id filter -- a shift
    // with tournament_id NULL would never be returned by it in the first
    // place, so this test asserts the repository is queried with the right
    // scope rather than re-filtering client-side.
    mocks.listShiftsByTournamentId.mockResolvedValue([]);

    const summary = await getTournamentDealerPayoutSummary("t1");

    expect(summary).toEqual({ dealersCount: 0, payoutRub: 0 });
    expect(mocks.listShiftsByTournamentId).toHaveBeenCalledWith("t1");
  });
});

describe("getPersonalDealerSummary", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("an ordinary player who never had a dealer profile gets dealer: null and no shift query is made", async () => {
    mocks.findProfileByPlayerId.mockResolvedValue(null);

    const result = await getPersonalDealerSummary("p1");

    expect(result.dealer).toBeNull();
    expect(result.history).toEqual([]);
    expect(result.openShift).toBeNull();
    expect(mocks.listShiftsByDealerId).not.toHaveBeenCalled();
  });

  it("queries shifts scoped to exactly the requested dealer's own player id", async () => {
    mocks.findProfileByPlayerId.mockResolvedValue(profile({ player_id: "p1", is_active: true }));
    mocks.listShiftsByDealerId.mockResolvedValue([]);

    await getPersonalDealerSummary("p1");

    expect(mocks.listShiftsByDealerId).toHaveBeenCalledWith("p1");
    expect(mocks.listShiftsByDealerId).toHaveBeenCalledTimes(1);
  });

  it("an inactive (deactivated) former dealer still gets dealer: {isActive: false} and keeps their history", async () => {
    mocks.findProfileByPlayerId.mockResolvedValue(profile({ player_id: "p1", is_active: false }));
    mocks.listShiftsByDealerId.mockResolvedValue([
      shiftRow({ id: "s1", ended_at: "2026-01-01T20:00:00.000Z", worked_minutes: 60, paid_hours: 1, amount_rub: 500 }),
    ]);

    const result = await getPersonalDealerSummary("p1");

    expect(result.dealer).toEqual({ isActive: false });
    expect(result.history).toHaveLength(1);
  });

  it("an open shift is shown separately and excluded from completed month/history totals", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 10, 0));
    mocks.findProfileByPlayerId.mockResolvedValue(profile());
    mocks.listShiftsByDealerId.mockResolvedValue([
      shiftRow({ id: "open", started_at: "2026-08-15T18:00:00.000Z", ended_at: null, worked_minutes: null, paid_hours: null, amount_rub: null }),
      shiftRow({ id: "closed", started_at: "2026-08-10T18:00:00.000Z", ended_at: "2026-08-10T20:00:00.000Z", worked_minutes: 120, paid_hours: 2, amount_rub: 1000 }),
    ]);

    const result = await getPersonalDealerSummary("p1");

    expect(result.openShift).toEqual(
      expect.objectContaining({ startedAt: "2026-08-15T18:00:00.000Z" })
    );
    expect(result.history).toHaveLength(1);
    expect(result.history[0].id).toBe("closed");
    expect(result.monthSummary.completedShiftCount).toBe(1);
    expect(result.monthSummary.amountRub).toBe(1000);
  });

  it("current-month summary only aggregates completed shifts started within the current local calendar month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 10, 0));
    mocks.findProfileByPlayerId.mockResolvedValue(profile());
    mocks.listShiftsByDealerId.mockResolvedValue([
      shiftRow({ id: "this-month", started_at: "2026-08-05T18:00:00.000Z", ended_at: "x", worked_minutes: 60, paid_hours: 1, amount_rub: 500, tournament_id: "t1" }),
      shiftRow({ id: "last-month", started_at: "2026-07-30T18:00:00.000Z", ended_at: "x", worked_minutes: 60, paid_hours: 1, amount_rub: 500 }),
    ]);
    mocks.findTournamentById.mockResolvedValue({ id: "t1", title: "Classic", start_at: "2026-08-05T18:00:00.000Z" });

    const result = await getPersonalDealerSummary("p1");

    expect(result.monthSummary).toEqual({
      completedShiftCount: 1,
      uniqueTournamentCount: 1,
      workedMinutes: 60,
      paidHours: 1,
      amountRub: 500,
      taxiAllowanceRub: 0,
      payoutRub: 500,
    });
    expect(result.history).toHaveLength(2);
  });

  it("an overnight shift belongs to the month/day it STARTED, not the day it ended", async () => {
    vi.useFakeTimers();
    // Local-time constructors throughout (not UTC ISO literals) so this
    // test is correct regardless of the machine's timezone: July 31
    // 23:00 local -> August 1 03:00 local, crossing midnight but starting
    // in July.
    vi.setSystemTime(new Date(2026, 7, 15, 10, 0));
    mocks.findProfileByPlayerId.mockResolvedValue(profile());
    mocks.listShiftsByDealerId.mockResolvedValue([
      shiftRow({
        id: "overnight",
        started_at: new Date(2026, 6, 31, 23, 0).toISOString(),
        ended_at: new Date(2026, 7, 1, 3, 0).toISOString(),
        worked_minutes: 240,
        paid_hours: 4,
        amount_rub: 2000,
      }),
    ]);

    const result = await getPersonalDealerSummary("p1");

    expect(result.monthSummary.completedShiftCount).toBe(0);
    expect(result.monthSummary.amountRub).toBe(0);
    expect(result.history[0].id).toBe("overnight");
  });

  it("displays the linked tournament's title and date for a completed shift", async () => {
    mocks.findProfileByPlayerId.mockResolvedValue(profile());
    mocks.listShiftsByDealerId.mockResolvedValue([
      shiftRow({ id: "s1", tournament_id: "t1", ended_at: "x", worked_minutes: 60, paid_hours: 1, amount_rub: 500 }),
    ]);
    mocks.findTournamentById.mockResolvedValue({ id: "t1", title: "Classic", start_at: "2026-08-27T18:00:00.000Z" });

    const result = await getPersonalDealerSummary("p1");

    expect(result.history[0]).toEqual(
      expect.objectContaining({ tournamentId: "t1", tournamentTitle: "Classic", tournamentDate: "2026-08-27T18:00:00.000Z" })
    );
  });

  it("a NULL tournament_id is returned as tournamentTitle: null, never fabricated from timestamps", async () => {
    mocks.findProfileByPlayerId.mockResolvedValue(profile());
    mocks.listShiftsByDealerId.mockResolvedValue([
      shiftRow({ id: "s1", tournament_id: null, ended_at: "x", worked_minutes: 60, paid_hours: 1, amount_rub: 500 }),
    ]);

    const result = await getPersonalDealerSummary("p1");

    expect(result.history[0]).toEqual(
      expect.objectContaining({ tournamentId: null, tournamentTitle: null, tournamentDate: null })
    );
    expect(mocks.findTournamentById).not.toHaveBeenCalled();
  });

  it("uses the shift's own snapshotted amount_rub unchanged, never recalculated from the dealer's current rate", async () => {
    mocks.findProfileByPlayerId.mockResolvedValue(profile({ hourly_rate_rub: 900 }));
    mocks.listShiftsByDealerId.mockResolvedValue([
      shiftRow({ id: "s1", hourly_rate_rub: 400, ended_at: "x", worked_minutes: 60, paid_hours: 1, amount_rub: 400 }),
    ]);

    const result = await getPersonalDealerSummary("p1");

    expect(result.history[0].amountRub).toBe(400);
  });

  it("allowance defaults to 0 when a shift never had chai added", async () => {
    mocks.findProfileByPlayerId.mockResolvedValue(profile());
    mocks.listShiftsByDealerId.mockResolvedValue([
      shiftRow({ id: "s1", ended_at: "x", worked_minutes: 60, paid_hours: 1, amount_rub: 500 }),
    ]);

    const result = await getPersonalDealerSummary("p1");

    expect(result.history[0]).toEqual(
      expect.objectContaining({ amountRub: 500, taxiAllowanceRub: 0, payoutRub: 500 })
    );
  });

  it("month summary and shift history both include the taxi allowance in the payout total", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 10, 0));
    mocks.findProfileByPlayerId.mockResolvedValue(profile());
    mocks.listShiftsByDealerId.mockResolvedValue([
      shiftRow({ id: "s1", started_at: "2026-08-05T18:00:00.000Z", ended_at: "x", worked_minutes: 60, paid_hours: 1, amount_rub: 3000, taxi_allowance_rub: 500 }),
    ]);

    const result = await getPersonalDealerSummary("p1");

    expect(result.monthSummary).toEqual(
      expect.objectContaining({ amountRub: 3000, taxiAllowanceRub: 500, payoutRub: 3500 })
    );
    expect(result.history[0]).toEqual(
      expect.objectContaining({ amountRub: 3000, taxiAllowanceRub: 500, payoutRub: 3500 })
    );
  });

  it("an open shift's allowance is visible even though there is no final payout yet", async () => {
    mocks.findProfileByPlayerId.mockResolvedValue(profile());
    mocks.listShiftsByDealerId.mockResolvedValue([
      shiftRow({ id: "open", ended_at: null, amount_rub: null, taxi_allowance_rub: 500 }),
    ]);

    const result = await getPersonalDealerSummary("p1");

    expect(result.openShift).toEqual(expect.objectContaining({ taxiAllowanceRub: 500 }));
  });
});
