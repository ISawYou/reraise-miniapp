import { beforeEach, describe, expect, it, vi } from "vitest";

// FREE-ROLL Finance contract. Same mocking shape as finance-export.test.ts:
// getFinanceTournamentExport only talks to repositories + two other
// features, so mocking those barrels is enough.
const mocks = vi.hoisted(() => ({
  listCompletedInRange: vi.fn(),
  findAttendanceByTournamentId: vi.fn(),
  getTournamentDealerPayoutSummary: vi.fn(),
  getTournamentAdminPayoutSummary: vi.fn(),
  listShiftsByTournamentId: vi.fn(),
  findSummariesByIds: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  tournamentRepository: { listCompletedInRange: mocks.listCompletedInRange },
  resultRepository: { findAttendanceByTournamentId: mocks.findAttendanceByTournamentId },
  dealerRepository: { listShiftsByTournamentId: mocks.listShiftsByTournamentId },
  playerRepository: { findSummariesByIds: mocks.findSummariesByIds },
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
  buildPlayerDiscounts,
  getAutomaticFreeEntryUnitsPerPlayer,
} = await import("@/features/finance-export");

function tournament(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "t1",
    title: "FREE-ROLL",
    description: undefined,
    location: undefined,
    google_sheet_tab_name: null,
    start_at: "2026-10-15T20:00:00.000Z",
    max_players: 30,
    kind: "free",
    tournament_type: "free_roll",
    season_id: null,
    status: "completed",
    created_at: "2026-10-15T18:00:00.000Z",
    rating_formula_version: "v2",
    rating_guarantee: null,
    is_final: false,
    ...overrides,
  };
}

type Row = {
  player_id: string;
  arrived: boolean | null;
  reentries: number;
  addons: number;
  free_reentries: number | null;
  club_discount_percent?: number | null;
};

// The task's worked example: 10 arrived players, 3 paid re-entries
// (raw reentries=2 for three players), 5 add-ons, no recorded free units.
function tenArrived(overrides: (i: number) => Partial<Row> = () => ({})): Row[] {
  return Array.from({ length: 10 }, (_, i) => ({
    player_id: `p${i + 1}`,
    arrived: true,
    reentries: i < 3 ? 2 : 1,
    addons: i < 5 ? 1 : 0,
    free_reentries: 0,
    club_discount_percent: 0,
    ...overrides(i),
  }));
}

function playerSummary(id: string, role: string) {
  return { id, role, display_name: id, username: null, email: null };
}

function dealerShift(dealerPlayerId: string) {
  return {
    id: `shift-${dealerPlayerId}`,
    dealer_player_id: dealerPlayerId,
    started_at: "2026-10-15T18:00:00.000Z",
    ended_at: "2026-10-15T23:00:00.000Z",
    hourly_rate_rub: 500,
    worked_minutes: 300,
    paid_hours: 5,
    amount_rub: 2500,
    taxi_allowance_rub: 0,
    tournament_id: "t1",
    created_by_player_id: null,
    ended_by_player_id: null,
  };
}

function breakdownSum(b: {
  ownerFreeCount: number;
  operatorFreeCount: number;
  dealerFreeCount: number;
  promoFreeCount: number;
}) {
  return b.ownerFreeCount + b.operatorFreeCount + b.dealerFreeCount + b.promoFreeCount;
}

beforeEach(() => {
  mocks.listCompletedInRange.mockReset();
  mocks.findAttendanceByTournamentId.mockReset();
  mocks.getTournamentDealerPayoutSummary.mockReset().mockResolvedValue({ dealersCount: 0, payoutRub: 0 });
  mocks.getTournamentAdminPayoutSummary.mockReset().mockResolvedValue({ adminsCount: 0, payoutRub: 0 });
  mocks.listShiftsByTournamentId.mockReset().mockResolvedValue([]);
  mocks.findSummariesByIds.mockReset().mockResolvedValue([]);
});

describe("getAutomaticFreeEntryUnitsPerPlayer -- keyed only on tournament_type", () => {
  it("is 1 for free_roll and 0 for every other type (or missing type)", () => {
    expect(getAutomaticFreeEntryUnitsPerPlayer("free_roll")).toBe(1);
    for (const type of ["classic", "bomb_pot", "boost_rating", "bounty", "phoenix", undefined]) {
      expect(getAutomaticFreeEntryUnitsPerPlayer(type)).toBe(0);
    }
  });
});

describe("FREE-ROLL -- summarizeTournamentAttendance", () => {
  it("worked example: 10 arrived, 3 paid re-entries, 5 add-ons -> entry=10, reentry=3, addon=5, free=10", () => {
    const result = summarizeTournamentAttendance(tenArrived(), "free_roll");
    expect(result).toMatchObject({
      playersCount: 10,
      entryCount: 10,
      reentryCount: 3,
      addonCount: 5,
      freeReentryCount: 10,
    });
  });

  it("automatic initial free units ADD to recorded free_reentries (2), never replace them", () => {
    const rows = tenArrived((i) => (i < 2 ? { free_reentries: 1 } : {}));
    expect(summarizeTournamentAttendance(rows, "free_roll").freeReentryCount).toBe(12);
    // Same rows as classic: only the recorded units.
    expect(summarizeTournamentAttendance(rows, "classic").freeReentryCount).toBe(2);
  });

  it("only ARRIVED players get the automatic free entry (false / null attendance excluded)", () => {
    const rows: Row[] = [
      ...tenArrived(),
      { player_id: "absent", arrived: false, reentries: 1, addons: 0, free_reentries: 0 },
      { player_id: "unknown", arrived: null, reentries: 1, addons: 0, free_reentries: 0 },
    ];
    const result = summarizeTournamentAttendance(rows, "free_roll");
    expect(result.freeReentryCount).toBe(10);
    expect(result.attendanceUnknownCount).toBe(1);
  });

  it("gross operational counts are identical to classic -- only freeReentryCount differs", () => {
    const rows = tenArrived();
    const classic = summarizeTournamentAttendance(rows, "classic");
    const freeRoll = summarizeTournamentAttendance(rows, "free_roll");
    expect({ ...freeRoll, freeReentryCount: classic.freeReentryCount }).toEqual(classic);
  });
});

describe("FREE-ROLL -- classifyFreeReentries", () => {
  const empty = new Map<string, string>();
  const noDealers = new Set<string>();

  it("every automatic initial free unit is Promo", () => {
    expect(classifyFreeReentries(tenArrived(), empty, noDealers, "free_roll")).toEqual({
      ownerFreeCount: 0,
      operatorFreeCount: 0,
      dealerFreeCount: 0,
      promoFreeCount: 10,
    });
  });

  it("automatic units stay Promo even for admin / operator / on-shift dealer players; their recorded units keep A-D", () => {
    const rows = tenArrived((i) => (i < 3 ? { free_reentries: 3 } : {}));
    const roles = new Map([
      ["p1", "admin"],
      ["p2", "operator"],
      ["p3", "player"],
    ]);
    const dealers = new Set(["p3"]);

    expect(classifyFreeReentries(rows, roles, dealers, "free_roll")).toEqual({
      ownerFreeCount: 3, // p1 recorded units only
      operatorFreeCount: 3, // p2 recorded units only
      dealerFreeCount: 2, // p3 recorded units, capped at 2
      promoFreeCount: 10 + 1, // 10 automatic + p3's dealer remainder
    });
  });
});

describe("FREE-ROLL -- buildPlayerDiscounts", () => {
  it("a discounted free_roll player has entryCount 0; paid re-entries/add-ons computed normally", () => {
    const rows: Row[] = [
      { player_id: "p-d", arrived: true, reentries: 3, addons: 2, free_reentries: 1, club_discount_percent: 10 },
    ];
    expect(buildPlayerDiscounts(rows, "free_roll")).toEqual([
      { playerId: "p-d", entryCount: 0, paidReentryCount: 1, paidAddonCount: 2, discountPercent: 10 },
    ]);
  });

  it("non-free_roll types keep entryCount 1 (with and without an explicit type)", () => {
    const rows: Row[] = [
      { player_id: "p-d", arrived: true, reentries: 3, addons: 2, free_reentries: 1, club_discount_percent: 10 },
    ];
    const expected = [
      { playerId: "p-d", entryCount: 1, paidReentryCount: 1, paidAddonCount: 2, discountPercent: 10 },
    ];
    expect(buildPlayerDiscounts(rows)).toEqual(expected);
    for (const type of ["classic", "bomb_pot", "boost_rating", "bounty"]) {
      expect(buildPlayerDiscounts(rows, type)).toEqual(expected);
    }
  });
});

describe("FREE-ROLL -- getFinanceTournamentExport end to end", () => {
  it("worked example row, with the breakdown invariant holding", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament()]);
    mocks.findAttendanceByTournamentId.mockResolvedValue(tenArrived());

    const [row] = await getFinanceTournamentExport({});

    expect(row).toMatchObject({
      tournamentType: "free_roll",
      playersCount: 10,
      entryCount: 10,
      reentryCount: 3,
      addonCount: 5,
      freeReentryCount: 10,
      freeReentryBreakdown: { ownerFreeCount: 0, operatorFreeCount: 0, dealerFreeCount: 0, promoFreeCount: 10 },
      playerDiscounts: [],
    });
    expect(breakdownSum(row.freeReentryBreakdown)).toBe(row.freeReentryCount);
  });

  it("staff players + recorded free units + a discount: exact row, invariant holds (no InvariantError)", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament()]);
    mocks.findAttendanceByTournamentId.mockResolvedValue(
      tenArrived((i) => {
        if (i === 0) return { free_reentries: 1 }; // admin
        if (i === 1) return { free_reentries: 1 }; // operator
        if (i === 2) return { club_discount_percent: 20 }; // dealer on shift, discounted, raw reentries=2
        return {};
      })
    );
    mocks.findSummariesByIds.mockResolvedValue([playerSummary("p1", "admin"), playerSummary("p2", "operator")]);
    mocks.listShiftsByTournamentId.mockResolvedValue([dealerShift("p3")]);

    const [row] = await getFinanceTournamentExport({});

    expect(row.freeReentryCount).toBe(12);
    expect(row.freeReentryBreakdown).toEqual({
      ownerFreeCount: 1,
      operatorFreeCount: 1,
      dealerFreeCount: 0,
      promoFreeCount: 10,
    });
    expect(breakdownSum(row.freeReentryBreakdown)).toBe(row.freeReentryCount);
    expect(row.playerDiscounts).toEqual([
      { playerId: "p3", entryCount: 0, paidReentryCount: 1, paidAddonCount: 1, discountPercent: 20 },
    ]);
  });

  it("REGRESSION: the identical rows exported as classic are unchanged (no automatic units, entryCount 1)", async () => {
    mocks.listCompletedInRange.mockResolvedValue([tournament({ tournament_type: "classic", title: "CLASSIC" })]);
    mocks.findAttendanceByTournamentId.mockResolvedValue(
      tenArrived((i) => {
        if (i === 0) return { free_reentries: 1 };
        if (i === 1) return { free_reentries: 1 };
        if (i === 2) return { club_discount_percent: 20, free_reentries: 3 };
        return {};
      })
    );
    mocks.findSummariesByIds.mockResolvedValue([
      playerSummary("p1", "admin"),
      playerSummary("p2", "operator"),
      playerSummary("p3", "player"),
    ]);
    mocks.listShiftsByTournamentId.mockResolvedValue([dealerShift("p3")]);

    const [row] = await getFinanceTournamentExport({});

    expect(row).toEqual({
      sourceTournamentId: "t1",
      title: "CLASSIC",
      tournamentType: "classic",
      startAt: "2026-10-15T20:00:00.000Z",
      playersCount: 10,
      entryCount: 10,
      reentryCount: 3,
      addonCount: 5,
      freeReentryCount: 5,
      freeReentryBreakdown: { ownerFreeCount: 1, operatorFreeCount: 1, dealerFreeCount: 2, promoFreeCount: 1 },
      playerDiscounts: [
        { playerId: "p3", entryCount: 1, paidReentryCount: 0, paidAddonCount: 1, discountPercent: 20 },
      ],
      dealerPayrollRub: 0,
      adminPayrollRub: 0,
      attendanceUnknownCount: 0,
      financiallyReliable: true,
      sourceUpdatedAt: null,
    });
  });
});
