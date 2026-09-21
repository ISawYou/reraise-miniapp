import { beforeEach, describe, expect, it, vi } from "vitest";

// Same mocking shape as tournament-attendance.test.ts / dealers.test.ts:
// getFinanceTournamentExport only talks to repositories + two other
// features (getTournamentDealerPayoutSummary, getTournamentAdminPayoutSummary),
// never Supabase/Postgres directly, so mocking those barrels is enough.
const mocks = vi.hoisted(() => ({
  listCompletedInRange: vi.fn(),
  findAttendanceByTournamentId: vi.fn(),
  getTournamentDealerPayoutSummary: vi.fn(),
  getTournamentAdminPayoutSummary: vi.fn(),
  listShiftsByTournamentId: vi.fn(),
  findSummariesByIds: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  tournamentRepository: {
    listCompletedInRange: mocks.listCompletedInRange,
  },
  resultRepository: {
    findAttendanceByTournamentId: mocks.findAttendanceByTournamentId,
  },
  dealerRepository: {
    listShiftsByTournamentId: mocks.listShiftsByTournamentId,
  },
  playerRepository: {
    findSummariesByIds: mocks.findSummariesByIds,
  },
}));

vi.mock("@/features/dealers", () => ({
  getTournamentDealerPayoutSummary: mocks.getTournamentDealerPayoutSummary,
}));

vi.mock("@/features/admin-shifts", () => ({
  getTournamentAdminPayoutSummary: mocks.getTournamentAdminPayoutSummary,
}));

const {
  getFinanceTournamentExport,
  summarizeTournamentAttendance,
  classifyFreeReentries,
  FreeReentryBreakdownInvariantError,
} = await import("@/features/finance-export");

function tournament(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "t1",
    title: "CLASSIC",
    description: undefined,
    location: undefined,
    google_sheet_tab_name: null,
    start_at: "2026-01-15T20:00:00.000Z",
    max_players: 30,
    kind: "free",
    tournament_type: "classic",
    season_id: null,
    status: "completed",
    created_at: "2026-01-15T18:00:00.000Z",
    rating_formula_version: "v2",
    rating_guarantee: null,
    is_final: false,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.listCompletedInRange.mockReset();
  mocks.findAttendanceByTournamentId.mockReset();
  // Sensible defaults so tests focused on freeReentryBreakdown don't each
  // need their own dealer/admin-payout stub -- explicit tests elsewhere
  // override these where dealerPayrollRub/adminPayrollRub itself is under test.
  mocks.getTournamentDealerPayoutSummary.mockReset().mockResolvedValue({ dealersCount: 0, payoutRub: 0 });
  mocks.getTournamentAdminPayoutSummary.mockReset().mockResolvedValue({ adminsCount: 0, payoutRub: 0 });
  // Same reasoning: every pre-existing test (written before
  // freeReentryBreakdown existed) gets an empty roster/no-shifts default,
  // so free_reentries in those fixtures fall through to promoFreeCount --
  // explicit tests below override these where the breakdown itself is
  // under test.
  mocks.listShiftsByTournamentId.mockReset().mockResolvedValue([]);
  mocks.findSummariesByIds.mockReset().mockResolvedValue([]);
});

describe("summarizeTournamentAttendance (pure)", () => {
  it("counts an arrived=true row as one entry", () => {
    const result = summarizeTournamentAttendance([{ arrived: true, reentries: 1, addons: 0 }]);
    expect(result.playersCount).toBe(1);
    expect(result.entryCount).toBe(1);
  });

  it("excludes an arrived=false row entirely", () => {
    const result = summarizeTournamentAttendance([{ arrived: false, reentries: 5, addons: 5 }]);
    expect(result.playersCount).toBe(0);
    expect(result.reentryCount).toBe(0);
    expect(result.addonCount).toBe(0);
    expect(result.attendanceUnknownCount).toBe(0);
  });

  it("counts an arrived=null row toward attendanceUnknownCount, never as false", () => {
    const result = summarizeTournamentAttendance([{ arrived: null, reentries: 2, addons: 1 }]);
    expect(result.playersCount).toBe(0);
    expect(result.attendanceUnknownCount).toBe(1);
    // Never silently folded into the counted totals either.
    expect(result.reentryCount).toBe(0);
    expect(result.addonCount).toBe(0);
  });

  it("normalizes raw reentries=1 (no actual re-entry) to a financial reentryCount of 0", () => {
    const result = summarizeTournamentAttendance([{ arrived: true, reentries: 1, addons: 0 }]);
    expect(result.reentryCount).toBe(0);
  });

  it("normalizes raw reentries=3 (two actual re-entries) to a financial reentryCount of 2", () => {
    const result = summarizeTournamentAttendance([{ arrived: true, reentries: 3, addons: 0 }]);
    expect(result.reentryCount).toBe(2);
  });

  it("sums addons only for arrived players", () => {
    const result = summarizeTournamentAttendance([
      { arrived: true, reentries: 1, addons: 2 },
      { arrived: false, reentries: 1, addons: 10 },
      { arrived: null, reentries: 1, addons: 10 },
    ]);
    expect(result.addonCount).toBe(2);
  });

  it("is financiallyReliable when every row has known attendance", () => {
    const result = summarizeTournamentAttendance([
      { arrived: true, reentries: 1, addons: 0 },
      { arrived: false, reentries: 1, addons: 0 },
    ]);
    expect(result.attendanceUnknownCount).toBe(0);
    expect(result.financiallyReliable).toBe(true);
  });

  it("is NOT financiallyReliable when at least one row has unknown attendance", () => {
    const result = summarizeTournamentAttendance([
      { arrived: true, reentries: 1, addons: 0 },
      { arrived: null, reentries: 1, addons: 0 },
    ]);
    expect(result.attendanceUnknownCount).toBe(1);
    expect(result.financiallyReliable).toBe(false);
  });

  it("returns all-zero, reliable totals for an empty tournament", () => {
    expect(summarizeTournamentAttendance([])).toEqual({
      playersCount: 0,
      entryCount: 0,
      reentryCount: 0,
      addonCount: 0,
      freeReentryCount: 0,
      attendanceUnknownCount: 0,
      financiallyReliable: true,
    });
  });
});

describe("summarizeTournamentAttendance -- freeReentryCount (RERAISE Finance actually-used free units)", () => {
  // A) 0 + 0 + 0 => 0
  it("A: sums to 0 when no row has any free_reentries", () => {
    const result = summarizeTournamentAttendance([
      { arrived: true, reentries: 1, addons: 0, free_reentries: 0 },
      { arrived: true, reentries: 1, addons: 0, free_reentries: 0 },
      { arrived: true, reentries: 1, addons: 0, free_reentries: 0 },
    ]);
    expect(result.freeReentryCount).toBe(0);
  });

  // B) 2 + 0 + 1 => 3
  it("B: sums free_reentries across multiple arrived players", () => {
    const result = summarizeTournamentAttendance([
      { arrived: true, reentries: 1, addons: 0, free_reentries: 2 },
      { arrived: true, reentries: 1, addons: 0, free_reentries: 0 },
      { arrived: true, reentries: 1, addons: 1, free_reentries: 1 },
    ]);
    expect(result.freeReentryCount).toBe(3);
  });

  // C) nullable/missing historical values are treated as 0.
  it("C: treats null and undefined free_reentries as 0, never throwing or producing NaN", () => {
    const result = summarizeTournamentAttendance([
      { arrived: true, reentries: 1, addons: 0, free_reentries: null },
      { arrived: true, reentries: 1, addons: 0, free_reentries: undefined },
      { arrived: true, reentries: 1, addons: 0 },
      { arrived: true, reentries: 1, addons: 0, free_reentries: 2 },
    ]);
    expect(result.freeReentryCount).toBe(2);
    expect(Number.isNaN(result.freeReentryCount)).toBe(false);
  });

  // D) freeReentryCount does not alter entryCount/reentryCount/addonCount.
  it("D: adding free_reentries never changes entryCount, reentryCount, or addonCount", () => {
    const result = summarizeTournamentAttendance([
      { arrived: true, reentries: 3, addons: 2, free_reentries: 4 },
    ]);
    expect(result.entryCount).toBe(1);
    expect(result.reentryCount).toBe(2);
    expect(result.addonCount).toBe(2);
    expect(result.freeReentryCount).toBe(4);
  });

  it("only sums free_reentries for arrived players, same population as reentryCount/addonCount", () => {
    const result = summarizeTournamentAttendance([
      { arrived: true, reentries: 1, addons: 0, free_reentries: 1 },
      { arrived: false, reentries: 1, addons: 0, free_reentries: 9 },
      { arrived: null, reentries: 1, addons: 0, free_reentries: 9 },
    ]);
    expect(result.freeReentryCount).toBe(1);
  });

  it("does not clamp freeReentryCount against gross units -- that validation belongs to Finance, not RERAISE", () => {
    const result = summarizeTournamentAttendance([
      { arrived: true, reentries: 1, addons: 0, free_reentries: 99 },
    ]);
    expect(result.freeReentryCount).toBe(99);
  });
});

describe("getFinanceTournamentExport", () => {
  it("only ever requests completed tournaments from the repository", async () => {
    mocks.listCompletedInRange.mockResolvedValue([]);

    await getFinanceTournamentExport({});

    expect(mocks.listCompletedInRange).toHaveBeenCalledTimes(1);
  });

  it("passes from/to as inclusive UTC day boundaries", async () => {
    mocks.listCompletedInRange.mockResolvedValue([]);

    await getFinanceTournamentExport({ from: "2026-01-01", to: "2026-01-31" });

    expect(mocks.listCompletedInRange).toHaveBeenCalledWith(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-31T23:59:59.999Z")
    );
  });

  it("combines attendance and dealer payroll into one export row per tournament", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([
      { arrived: true, reentries: 3, addons: 2, free_reentries: 1 },
    ]);
    mocks.getTournamentDealerPayoutSummary.mockResolvedValue({ dealersCount: 1, payoutRub: 6500 });

    const rows = await getFinanceTournamentExport({});

    expect(rows).toEqual([
      {
        sourceTournamentId: "t1",
        title: "CLASSIC",
        tournamentType: "classic",
        startAt: "2026-01-15T20:00:00.000Z",
        playersCount: 1,
        entryCount: 1,
        reentryCount: 2,
        addonCount: 2,
        freeReentryCount: 1,
        freeReentryBreakdown: { ownerFreeCount: 0, operatorFreeCount: 0, dealerFreeCount: 0, promoFreeCount: 1 },
        dealerPayrollRub: 6500,
        adminPayrollRub: 0,
        attendanceUnknownCount: 0,
        financiallyReliable: true,
        sourceUpdatedAt: null,
      },
    ]);
    expect(mocks.getTournamentDealerPayoutSummary).toHaveBeenCalledWith("t1");
  });

  // E) existing re-entry normalization remains unchanged.
  it("E: re-entry normalization (raw reentries - 1) is unaffected by freeReentryCount", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([
      { arrived: true, reentries: 4, addons: 0, free_reentries: 2 },
    ]);
    mocks.getTournamentDealerPayoutSummary.mockResolvedValue({ dealersCount: 0, payoutRub: 0 });

    const [row] = await getFinanceTournamentExport({});

    // raw reentries=4 -> normalized reentryCount=3, exactly as before.
    expect(row.reentryCount).toBe(3);
    expect(row.freeReentryCount).toBe(2);
  });

  // F) dealerPayrollRub remains unchanged by this feature.
  it("F: dealerPayrollRub is unaffected by freeReentryCount", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([
      { arrived: true, reentries: 1, addons: 0, free_reentries: 5 },
    ]);
    mocks.getTournamentDealerPayoutSummary.mockResolvedValue({ dealersCount: 2, payoutRub: 9000 });

    const [row] = await getFinanceTournamentExport({});

    expect(row.dealerPayrollRub).toBe(9000);
    expect(row.freeReentryCount).toBe(5);
  });

  // G) attendanceUnknownCount/financiallyReliable existing behavior is unaffected.
  it("G: financiallyReliable/attendanceUnknownCount behavior is unaffected by freeReentryCount, including a large one", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([
      { arrived: true, reentries: 1, addons: 0, free_reentries: 1 },
      { arrived: null, reentries: 1, addons: 0, free_reentries: 999 },
    ]);
    mocks.getTournamentDealerPayoutSummary.mockResolvedValue({ dealersCount: 0, payoutRub: 0 });

    const [row] = await getFinanceTournamentExport({});

    expect(row.attendanceUnknownCount).toBe(1);
    expect(row.financiallyReliable).toBe(false);
    // The unknown-attendance row's free_reentries is never counted either
    // (same "arrived players only" population as reentryCount/addonCount).
    expect(row.freeReentryCount).toBe(1);
  });

  it("surfaces dealer payroll (base + taxi allowance, per getTournamentDealerPayoutSummary) verbatim as dealerPayrollRub", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([]);
    mocks.getTournamentDealerPayoutSummary.mockResolvedValue({ dealersCount: 2, payoutRub: 2000 });

    const [row] = await getFinanceTournamentExport({});

    expect(row.dealerPayrollRub).toBe(2000);
  });

  it("still returns a tournament with unknown attendance, flagged as not financially reliable", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([
      { arrived: true, reentries: 1, addons: 0 },
      { arrived: null, reentries: 1, addons: 0 },
    ]);
    mocks.getTournamentDealerPayoutSummary.mockResolvedValue({ dealersCount: 0, payoutRub: 0 });

    const [row] = await getFinanceTournamentExport({});

    expect(row.attendanceUnknownCount).toBe(1);
    expect(row.financiallyReliable).toBe(false);
    // The tournament is still present, not dropped.
    expect(row.sourceTournamentId).toBe("t1");
  });

  it("produces one export row per tournament, never duplicating a tournament", async () => {
    mocks.listCompletedInRange.mockResolvedValue([
      tournament({ id: "t1" }),
      tournament({ id: "t2" }),
    ]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([]);
    mocks.getTournamentDealerPayoutSummary.mockResolvedValue({ dealersCount: 0, payoutRub: 0 });

    const rows = await getFinanceTournamentExport({});

    expect(rows.map((r) => r.sourceTournamentId)).toEqual(["t1", "t2"]);
  });

  // H) export row contains adminPayrollRub.
  it("H: an export row includes adminPayrollRub from getTournamentAdminPayoutSummary", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([]);
    mocks.getTournamentDealerPayoutSummary.mockResolvedValue({ dealersCount: 0, payoutRub: 0 });
    mocks.getTournamentAdminPayoutSummary.mockResolvedValue({ adminsCount: 2, payoutRub: 8000 });

    const [row] = await getFinanceTournamentExport({});

    expect(row.adminPayrollRub).toBe(8000);
    expect(mocks.getTournamentAdminPayoutSummary).toHaveBeenCalledWith("t1");
  });

  it("a tournament with no completed admin shifts exports a legitimate adminPayrollRub of 0", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([]);
    mocks.getTournamentDealerPayoutSummary.mockResolvedValue({ dealersCount: 0, payoutRub: 0 });
    mocks.getTournamentAdminPayoutSummary.mockResolvedValue({ adminsCount: 0, payoutRub: 0 });

    const [row] = await getFinanceTournamentExport({});

    expect(row.adminPayrollRub).toBe(0);
  });

  // I) dealerPayrollRub remains unchanged by adminPayrollRub.
  it("I: dealerPayrollRub is unaffected by adminPayrollRub", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([]);
    mocks.getTournamentDealerPayoutSummary.mockResolvedValue({ dealersCount: 3, payoutRub: 12000 });
    mocks.getTournamentAdminPayoutSummary.mockResolvedValue({ adminsCount: 1, payoutRub: 4000 });

    const [row] = await getFinanceTournamentExport({});

    expect(row.dealerPayrollRub).toBe(12000);
    expect(row.adminPayrollRub).toBe(4000);
  });

  // J) freeReentryCount remains unchanged.
  it("J: freeReentryCount is unaffected by adminPayrollRub", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([
      { arrived: true, reentries: 1, addons: 0, free_reentries: 3 },
    ]);
    mocks.getTournamentDealerPayoutSummary.mockResolvedValue({ dealersCount: 0, payoutRub: 0 });
    mocks.getTournamentAdminPayoutSummary.mockResolvedValue({ adminsCount: 1, payoutRub: 4000 });

    const [row] = await getFinanceTournamentExport({});

    expect(row.freeReentryCount).toBe(3);
    expect(row.adminPayrollRub).toBe(4000);
  });

  // K) attendanceUnknownCount / financiallyReliable remain unchanged.
  it("K: financiallyReliable/attendanceUnknownCount behavior is unaffected by adminPayrollRub, including a large one", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([
      { arrived: true, reentries: 1, addons: 0, free_reentries: 0 },
      { arrived: null, reentries: 1, addons: 0, free_reentries: 0 },
    ]);
    mocks.getTournamentDealerPayoutSummary.mockResolvedValue({ dealersCount: 0, payoutRub: 0 });
    mocks.getTournamentAdminPayoutSummary.mockResolvedValue({ adminsCount: 1, payoutRub: 99000 });

    const [row] = await getFinanceTournamentExport({});

    expect(row.attendanceUnknownCount).toBe(1);
    expect(row.financiallyReliable).toBe(false);
    expect(row.adminPayrollRub).toBe(99000);
  });
});

// Automatic owner/operator/dealer/promo classification of freeReentryCount
// -- pure function tests. dealerPlayerIdsForTournament is always the
// CALLER's already-per-tournament-scoped set (built by buildExportRow from
// dealerRepository.listShiftsByTournamentId(tournament.id)), so
// classifyFreeReentries itself never re-checks "which tournament".
describe("classifyFreeReentries (pure) -- automatic owner/operator/dealer/promo classification", () => {
  function row(player_id: string, free_reentries: number, arrived: boolean | null = true) {
    return { player_id, arrived, free_reentries };
  }

  // A) owner (DB role "admin" = Super Admin) -- all free units, none shared.
  it("A: owner role (admin), free=3 -> owner=3, others=0", () => {
    const result = classifyFreeReentries([row("p1", 3)], new Map([["p1", "admin"]]), new Set());
    expect(result).toEqual({ ownerFreeCount: 3, operatorFreeCount: 0, dealerFreeCount: 0, promoFreeCount: 0 });
  });

  // B) operator (DB role "operator" = club Administrator).
  it("B: operator role, free=2 -> operator=2", () => {
    const result = classifyFreeReentries([row("p1", 2)], new Map([["p1", "operator"]]), new Set());
    expect(result).toEqual({ ownerFreeCount: 0, operatorFreeCount: 2, dealerFreeCount: 0, promoFreeCount: 0 });
  });

  // C) dealer_profile existence alone is irrelevant here -- classifyFreeReentries
  // only ever consults the caller-supplied per-tournament dealer set.
  it("C: not in the per-tournament dealer set (no shift on THIS tournament), free=2 -> promo=2", () => {
    const result = classifyFreeReentries([row("p1", 2)], new Map([["p1", "player"]]), new Set());
    expect(result).toEqual({ ownerFreeCount: 0, operatorFreeCount: 0, dealerFreeCount: 0, promoFreeCount: 2 });
  });

  // D-G) worked this tournament (in the dealer set) -- capped at 2 units.
  it("D: dealer on this tournament, free=1 -> dealer=1", () => {
    const result = classifyFreeReentries([row("p1", 1)], new Map(), new Set(["p1"]));
    expect(result).toEqual({ ownerFreeCount: 0, operatorFreeCount: 0, dealerFreeCount: 1, promoFreeCount: 0 });
  });

  it("E: dealer on this tournament, free=2 -> dealer=2", () => {
    const result = classifyFreeReentries([row("p1", 2)], new Map(), new Set(["p1"]));
    expect(result).toEqual({ ownerFreeCount: 0, operatorFreeCount: 0, dealerFreeCount: 2, promoFreeCount: 0 });
  });

  it("F: dealer on this tournament, free=3 -> dealer=2, promo=1", () => {
    const result = classifyFreeReentries([row("p1", 3)], new Map(), new Set(["p1"]));
    expect(result).toEqual({ ownerFreeCount: 0, operatorFreeCount: 0, dealerFreeCount: 2, promoFreeCount: 1 });
  });

  it("G: dealer on this tournament, free=5 -> dealer=2, promo=3", () => {
    const result = classifyFreeReentries([row("p1", 5)], new Map(), new Set(["p1"]));
    expect(result).toEqual({ ownerFreeCount: 0, operatorFreeCount: 0, dealerFreeCount: 2, promoFreeCount: 3 });
  });

  // H) ordinary player, no role/dealer match.
  it("H: ordinary player, free=2 -> promo=2", () => {
    const result = classifyFreeReentries([row("p1", 2)], new Map([["p1", "player"]]), new Set());
    expect(result).toEqual({ ownerFreeCount: 0, operatorFreeCount: 0, dealerFreeCount: 0, promoFreeCount: 2 });
  });

  // I) owner/operator priority over dealer status -- STRICT priority order.
  it("I: owner who ALSO worked this tournament as dealer -- owner wins, dealer=0", () => {
    const result = classifyFreeReentries([row("p1", 3)], new Map([["p1", "admin"]]), new Set(["p1"]));
    expect(result).toEqual({ ownerFreeCount: 3, operatorFreeCount: 0, dealerFreeCount: 0, promoFreeCount: 0 });
  });

  it("I: operator who ALSO worked this tournament as dealer -- operator wins, dealer=0", () => {
    const result = classifyFreeReentries([row("p1", 2)], new Map([["p1", "operator"]]), new Set(["p1"]));
    expect(result).toEqual({ ownerFreeCount: 0, operatorFreeCount: 2, dealerFreeCount: 0, promoFreeCount: 0 });
  });

  // J) a dealer shift on a DIFFERENT tournament never counts here --
  // enforced by the caller only ever passing in THIS tournament's set.
  it("J: dealer set scoped to a different tournament -- this player is not counted as dealer here", () => {
    const result = classifyFreeReentries([row("p1", 2)], new Map(), new Set(["someone-else-entirely"]));
    expect(result).toEqual({ ownerFreeCount: 0, operatorFreeCount: 0, dealerFreeCount: 0, promoFreeCount: 2 });
  });

  it("skips non-arrived and zero/negative free_reentries rows entirely", () => {
    const result = classifyFreeReentries(
      [row("p1", 5, false), row("p2", 0, true), row("p3", 5, null)],
      new Map([["p1", "admin"], ["p2", "admin"], ["p3", "admin"]]),
      new Set()
    );
    expect(result).toEqual({ ownerFreeCount: 0, operatorFreeCount: 0, dealerFreeCount: 0, promoFreeCount: 0 });
  });

  it("FreeReentryBreakdownInvariantError carries the tournament id and both sums in its message", () => {
    const err = new FreeReentryBreakdownInvariantError("t1", 5, 3);
    expect(err.name).toBe("FreeReentryBreakdownInvariantError");
    expect(err.message).toContain("t1");
    expect(err.message).toContain("5");
    expect(err.message).toContain("3");
  });
});

function playerSummary(id: string, role: string) {
  return { id, role, display_name: id, username: null, email: null };
}

function dealerShift(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "shift-1",
    dealer_player_id: "dealer1",
    started_at: "2026-09-01T18:00:00.000Z",
    ended_at: "2026-09-01T23:00:00.000Z",
    hourly_rate_rub: 500,
    worked_minutes: 300,
    paid_hours: 5,
    amount_rub: 2500,
    taxi_allowance_rub: 0,
    tournament_id: "t1",
    created_by_player_id: null,
    ended_by_player_id: null,
    ...overrides,
  };
}

describe("getFinanceTournamentExport -- freeReentryBreakdown wiring (bulk role + dealer-shift lookups)", () => {
  it("classifies owner (Super Admin) free_reentries via the player's current role", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([
      { player_id: "owner1", arrived: true, reentries: 1, addons: 0, free_reentries: 3 },
    ]);
    mocks.findSummariesByIds.mockResolvedValue([playerSummary("owner1", "admin")]);

    const [row] = await getFinanceTournamentExport({});

    expect(row.freeReentryBreakdown).toEqual({
      ownerFreeCount: 3,
      operatorFreeCount: 0,
      dealerFreeCount: 0,
      promoFreeCount: 0,
    });
    expect(mocks.findSummariesByIds).toHaveBeenCalledWith(["owner1"]);
  });

  it("classifies a dealer's free_reentries only when a COMPLETED shift ties them to THIS tournament", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([
      { player_id: "dealer1", arrived: true, reentries: 1, addons: 0, free_reentries: 2 },
    ]);
    mocks.findSummariesByIds.mockResolvedValue([playerSummary("dealer1", "player")]);
    mocks.listShiftsByTournamentId.mockResolvedValue([dealerShift({ dealer_player_id: "dealer1" })]);

    const [row] = await getFinanceTournamentExport({});

    expect(row.freeReentryBreakdown).toEqual({
      ownerFreeCount: 0,
      operatorFreeCount: 0,
      dealerFreeCount: 2,
      promoFreeCount: 0,
    });
    expect(mocks.listShiftsByTournamentId).toHaveBeenCalledWith("t1");
  });

  // K) confirm current canonical semantics first: an OPEN dealer shift
  // (ended_at === null) is not a "worked" shift -- same rule
  // getTournamentDealerPayoutSummary already applies to payroll -- so this
  // player is NOT classified as dealer, falling back to promo.
  it("K: an OPEN dealer shift on this tournament does not count as dealer work -- falls back to promo", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([
      { player_id: "dealer1", arrived: true, reentries: 1, addons: 0, free_reentries: 2 },
    ]);
    mocks.findSummariesByIds.mockResolvedValue([playerSummary("dealer1", "player")]);
    mocks.listShiftsByTournamentId.mockResolvedValue([
      dealerShift({ dealer_player_id: "dealer1", ended_at: null, amount_rub: null, worked_minutes: null, paid_hours: null }),
    ]);

    const [row] = await getFinanceTournamentExport({});

    expect(row.freeReentryBreakdown).toEqual({
      ownerFreeCount: 0,
      operatorFreeCount: 0,
      dealerFreeCount: 0,
      promoFreeCount: 2,
    });
  });

  // L) the control formula: breakdown always sums to freeReentryCount, across a mixed tournament.
  it("L: owner + operator + dealer(capped) + promo sums exactly to freeReentryCount", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([
      { player_id: "owner1", arrived: true, reentries: 1, addons: 0, free_reentries: 1 },
      { player_id: "op1", arrived: true, reentries: 1, addons: 0, free_reentries: 1 },
      { player_id: "dealer1", arrived: true, reentries: 1, addons: 0, free_reentries: 3 },
      { player_id: "promo1", arrived: true, reentries: 1, addons: 0, free_reentries: 2 },
    ]);
    mocks.findSummariesByIds.mockResolvedValue([
      playerSummary("owner1", "admin"),
      playerSummary("op1", "operator"),
      playerSummary("dealer1", "player"),
      playerSummary("promo1", "player"),
    ]);
    mocks.listShiftsByTournamentId.mockResolvedValue([dealerShift({ dealer_player_id: "dealer1" })]);

    const [row] = await getFinanceTournamentExport({});

    const b = row.freeReentryBreakdown;
    expect(b).toEqual({ ownerFreeCount: 1, operatorFreeCount: 1, dealerFreeCount: 2, promoFreeCount: 3 });
    expect(b.ownerFreeCount + b.operatorFreeCount + b.dealerFreeCount + b.promoFreeCount).toBe(
      row.freeReentryCount
    );
    expect(row.freeReentryCount).toBe(7);
  });

  // M) freeReentryCount=0 -> breakdown all zero, and no wasted role lookup.
  it("M: freeReentryCount 0 -> breakdown is all-zero, and the role lookup is skipped entirely", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([
      { player_id: "p1", arrived: true, reentries: 1, addons: 0, free_reentries: 0 },
    ]);

    const [row] = await getFinanceTournamentExport({});

    expect(row.freeReentryBreakdown).toEqual({
      ownerFreeCount: 0,
      operatorFreeCount: 0,
      dealerFreeCount: 0,
      promoFreeCount: 0,
    });
    expect(mocks.findSummariesByIds).not.toHaveBeenCalled();
  });

  // N) existing freeReentryCount logic is untouched by the breakdown addition.
  it("N: freeReentryCount itself is computed exactly as before, unaffected by breakdown classification", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([
      { player_id: "p1", arrived: true, reentries: 1, addons: 0, free_reentries: 4 },
      { player_id: "p2", arrived: false, reentries: 1, addons: 0, free_reentries: 9 },
      { player_id: "p3", arrived: null, reentries: 1, addons: 0, free_reentries: 9 },
    ]);
    mocks.findSummariesByIds.mockResolvedValue([playerSummary("p1", "player")]);

    const [row] = await getFinanceTournamentExport({});

    expect(row.freeReentryCount).toBe(4);
  });

  // O) dealerPayrollRub unaffected.
  it("O: dealerPayrollRub is unaffected by freeReentryBreakdown classification", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([
      { player_id: "dealer1", arrived: true, reentries: 1, addons: 0, free_reentries: 2 },
    ]);
    mocks.findSummariesByIds.mockResolvedValue([playerSummary("dealer1", "player")]);
    mocks.listShiftsByTournamentId.mockResolvedValue([dealerShift({ dealer_player_id: "dealer1" })]);
    mocks.getTournamentDealerPayoutSummary.mockResolvedValue({ dealersCount: 1, payoutRub: 6500 });

    const [row] = await getFinanceTournamentExport({});

    expect(row.dealerPayrollRub).toBe(6500);
    expect(row.freeReentryBreakdown.dealerFreeCount).toBe(2);
  });

  // P) adminPayrollRub unaffected.
  it("P: adminPayrollRub is unaffected by freeReentryBreakdown classification", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([
      { player_id: "owner1", arrived: true, reentries: 1, addons: 0, free_reentries: 3 },
    ]);
    mocks.findSummariesByIds.mockResolvedValue([playerSummary("owner1", "admin")]);
    mocks.getTournamentAdminPayoutSummary.mockResolvedValue({ adminsCount: 1, payoutRub: 4000 });

    const [row] = await getFinanceTournamentExport({});

    expect(row.adminPayrollRub).toBe(4000);
    expect(row.freeReentryBreakdown.ownerFreeCount).toBe(3);
  });

  // Q) entry/reentry/addon counts unaffected.
  it("Q: entryCount/reentryCount/addonCount are unaffected by freeReentryBreakdown classification", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ id: "t1" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue([
      { player_id: "dealer1", arrived: true, reentries: 4, addons: 2, free_reentries: 5 },
    ]);
    mocks.findSummariesByIds.mockResolvedValue([playerSummary("dealer1", "player")]);
    mocks.listShiftsByTournamentId.mockResolvedValue([dealerShift({ dealer_player_id: "dealer1" })]);

    const [row] = await getFinanceTournamentExport({});

    expect(row.entryCount).toBe(1);
    expect(row.reentryCount).toBe(3);
    expect(row.addonCount).toBe(2);
    expect(row.freeReentryBreakdown).toEqual({
      ownerFreeCount: 0,
      operatorFreeCount: 0,
      dealerFreeCount: 2,
      promoFreeCount: 3,
    });
  });
});
