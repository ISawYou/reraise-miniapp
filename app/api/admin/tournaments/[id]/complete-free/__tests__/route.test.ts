import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getDerivedEliminationPlaces: vi.fn(),
  getTournamentAttendance: vi.fn(),
  getTournamentById: vi.fn(),
  getTournamentEliminations: vi.fn(),
  getTournamentRebuyState: vi.fn(),
  saveTournamentResults: vi.fn(),
  getMysteryBountySnapshot: vi.fn(),
  getTournamentLateRegistrationSnapshot: vi.fn(),
  syncTournamentSheet: vi.fn(),
  readAndParseFreeTournamentSheet: vi.fn(),
  applyLiveFieldsFromSheetSnapshot: vi.fn(),
}));

vi.mock("@/features/tournaments", () => ({
  getDerivedEliminationPlaces: mocks.getDerivedEliminationPlaces,
  getTournamentAttendance: mocks.getTournamentAttendance,
  getTournamentById: mocks.getTournamentById,
  getTournamentEliminations: mocks.getTournamentEliminations,
  getTournamentRebuyState: mocks.getTournamentRebuyState,
  saveTournamentResults: mocks.saveTournamentResults,
}));

vi.mock("@/features/mystery-bounty", () => ({
  getMysteryBountySnapshot: mocks.getMysteryBountySnapshot,
}));

vi.mock("@/features/late-registration", () => ({
  getTournamentLateRegistrationSnapshot: mocks.getTournamentLateRegistrationSnapshot,
}));

vi.mock("@/app/api/admin/tournaments/[id]/export-sheet/route", () => ({
  syncTournamentSheet: mocks.syncTournamentSheet,
}));

vi.mock("@/features/tournament-sheet-sync", () => ({
  readAndParseFreeTournamentSheet: mocks.readAndParseFreeTournamentSheet,
  applyLiveFieldsFromSheetSnapshot: mocks.applyLiveFieldsFromSheetSnapshot,
}));

const { POST } = await import("@/app/api/admin/tournaments/[id]/complete-free/route");

function context(id = "t1") {
  return { params: Promise.resolve({ id }) };
}

function request(body: unknown) {
  return new Request("http://localhost/api/admin/tournaments/t1/complete-free", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function row(overrides: Partial<{
  player_id: string;
  rebuys: number;
  addons: number;
  arrived: boolean;
  knockouts: number;
  place: number;
}> = {}) {
  return {
    player_id: "p1",
    display_name: "Alice",
    arrived: true,
    rebuys: 1,
    addons: 0,
    knockouts: 0,
    place: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTournamentById.mockResolvedValue({
    id: "t1",
    tournament_type: "classic",
    rating_formula_version: "v2",
    rating_guarantee: null,
  });
  mocks.getTournamentAttendance.mockResolvedValue(new Map());
  mocks.getTournamentEliminations.mockResolvedValue(new Map());
  mocks.getTournamentRebuyState.mockResolvedValue(new Map());
  mocks.getDerivedEliminationPlaces.mockResolvedValue(new Map());
  mocks.saveTournamentResults.mockResolvedValue(undefined);
  mocks.syncTournamentSheet.mockResolvedValue({ tabName: "Sheet1" });
  mocks.getTournamentLateRegistrationSnapshot.mockResolvedValue(null);
  mocks.applyLiveFieldsFromSheetSnapshot.mockResolvedValue({
    attendanceChanges: 0,
    eliminationChanges: 0,
    rebuyChanges: 0,
    unEliminatedPlayerIds: [],
  });
});

describe("POST /api/admin/tournaments/[id]/complete-free -- live rebuy-state reconciliation", () => {
  it("live tournament_rebuy_state wins over the submitted row when a live row exists (same precedence as arrived)", async () => {
    mocks.getTournamentRebuyState.mockResolvedValue(new Map([["p1", { rebuys: 5, addons: 2 }]]));

    await POST(request({ rows: [row({ rebuys: 1, addons: 0 })] }), context());

    expect(mocks.saveTournamentResults).toHaveBeenCalledTimes(1);
    const [, results] = mocks.saveTournamentResults.mock.calls[0];
    expect(results[0]).toMatchObject({ player_id: "p1", reentries: 5, addons: 2 });
  });

  it("falls back to the submitted row when no live rebuy-state row exists for that player", async () => {
    mocks.getTournamentRebuyState.mockResolvedValue(new Map());

    await POST(request({ rows: [row({ rebuys: 3, addons: 1 })] }), context());

    const [, results] = mocks.saveTournamentResults.mock.calls[0];
    expect(results[0]).toMatchObject({ player_id: "p1", reentries: 3, addons: 1 });
  });

  it("falls back to 0/0 when neither a live row nor a submitted value exists", async () => {
    mocks.getTournamentRebuyState.mockResolvedValue(new Map());

    await POST(
      request({ rows: [{ player_id: "p1", display_name: "Alice", arrived: true, knockouts: 0, place: 1, rebuys: undefined, addons: undefined }] }),
      context()
    );

    const [, results] = mocks.saveTournamentResults.mock.calls[0];
    expect(results[0]).toMatchObject({ reentries: 0, addons: 0 });
  });

  it("a stale second tab's submitted rebuys/addons can never overwrite what's live in tournament_rebuy_state -- same authoritative semantics as arrived", async () => {
    // Second tab loaded before the admin bumped Re-buy to 2 in the first
    // tab and it live-persisted -- this tab still submits the old value 1.
    mocks.getTournamentRebuyState.mockResolvedValue(new Map([["p1", { rebuys: 2, addons: 0 }]]));

    await POST(request({ rows: [row({ rebuys: 1, addons: 0 })] }), context());

    const [, results] = mocks.saveTournamentResults.mock.calls[0];
    expect(results[0].reentries).toBe(2);
  });

  it("rating calculation uses the reconciled (live) rebuys, not the submitted one", async () => {
    mocks.getTournamentRebuyState.mockResolvedValue(new Map([["p1", { rebuys: 5, addons: 0 }]]));

    await POST(
      request({ rows: [row({ player_id: "p1", rebuys: 1, place: 1 }), row({ player_id: "p2", rebuys: 1, place: 2 })] }),
      context()
    );

    const [, results] = mocks.saveTournamentResults.mock.calls[0];
    const p1 = results.find((r: { player_id: string }) => r.player_id === "p1");
    const p2 = results.find((r: { player_id: string }) => r.player_id === "p2");
    // p1's reconciled entries (5) differ from p2's (1, unchanged) -- rating
    // points must reflect that split, not a shared/flattened value.
    expect(p1.reentries).toBe(5);
    expect(p2.reentries).toBe(1);
  });

  it("free_reentries and mystery_bounty_points are untouched by rebuy-state reconciliation", async () => {
    mocks.getTournamentRebuyState.mockResolvedValue(new Map([["p1", { rebuys: 2, addons: 1 }]]));
    mocks.getTournamentById.mockResolvedValue({
      id: "t1",
      tournament_type: "classic",
      rating_formula_version: "v2",
      rating_guarantee: null,
    });

    await POST(
      request({
        rows: [{ ...row({ rebuys: 1, addons: 0 }), free_reentries: 4, mystery_bounty_points: 0 }],
      }),
      context()
    );

    const [, results] = mocks.saveTournamentResults.mock.calls[0];
    // reconciled from live state, not the submitted 1/0
    expect(results[0].reentries).toBe(2);
    expect(results[0].addons).toBe(1);
    // free_reentries is now persisted canonically (results.free_reentries)
    // and is NOT part of the rebuy-state reconciliation -- the submitted
    // value passes through unchanged, exactly like mystery_bounty_points.
    expect(results[0].free_reentries).toBe(4);
    expect(results[0].mystery_bounty_points).toBe(0);
  });

  it("Mystery Bounty guard is unaffected by rebuy-state reconciliation -- still blocks completion on pool mismatch", async () => {
    mocks.getTournamentById.mockResolvedValue({
      id: "t1",
      tournament_type: "mystery_bounty",
      rating_formula_version: "v2",
      rating_guarantee: null,
    });
    mocks.getMysteryBountySnapshot.mockResolvedValue({ mystery_pool: 100 });
    mocks.getTournamentRebuyState.mockResolvedValue(new Map([["p1", { rebuys: 2, addons: 0 }]]));

    const response = await POST(
      request({ rows: [{ ...row(), mystery_bounty_points: 40 }] }),
      context()
    );

    expect(response.status).toBe(400);
    expect(mocks.saveTournamentResults).not.toHaveBeenCalled();
  });

  it("still writes to results even when it's the untouched default (0/0) -- no crash, no undefined leaking through", async () => {
    await POST(request({ rows: [row({ rebuys: 0, addons: 0 })] }), context());

    const [, results] = mocks.saveTournamentResults.mock.calls[0];
    expect(results[0].reentries).toBe(0);
    expect(results[0].addons).toBe(0);
  });

  it("uses frozen points-per-place after close even when live Re-buy/Add-on values later change", async () => {
    mocks.getTournamentLateRegistrationSnapshot.mockResolvedValue({
      rating_places: [
        { place: 1, points: 70 },
        { place: 2, points: 53 },
        { place: 3, points: 39 },
      ],
    });
    mocks.getTournamentRebuyState.mockResolvedValue(
      new Map([
        ["p1", { rebuys: 9, addons: 5 }],
        ["p2", { rebuys: 9, addons: 5 }],
        ["p3", { rebuys: 9, addons: 5 }],
      ])
    );

    await POST(
      request({
        rows: [
          row({ player_id: "p1", place: 1 }),
          row({ player_id: "p2", place: 2 }),
          row({ player_id: "p3", place: 3 }),
        ],
      }),
      context()
    );

    const [, results] = mocks.saveTournamentResults.mock.calls[0];
    expect(results.map((result: { rating_points: number; itm_points: number }) => ({
      rating_points: result.rating_points,
      itm_points: result.itm_points,
    }))).toEqual([
      { rating_points: 72, itm_points: 70 },
      { rating_points: 55, itm_points: 53 },
      { rating_points: 41, itm_points: 39 },
    ]);
  });

  it("keeps the existing fresh-calculation behavior when Late Registration was never closed", async () => {
    mocks.getTournamentLateRegistrationSnapshot.mockResolvedValue(null);

    await POST(
      request({
        rows: [
          row({ player_id: "p1", place: 1 }),
          row({ player_id: "p2", place: 2 }),
          row({ player_id: "p3", place: 3 }),
        ],
      }),
      context()
    );

    const [, results] = mocks.saveTournamentResults.mock.calls[0];
    expect(results.map((result: { rating_points: number }) => result.rating_points)).toEqual([
      72,
      55,
      41,
    ]);
  });
});

describe("POST /api/admin/tournaments/[id]/complete-free -- GS-linked freshness guarantee", () => {
  function withSheet() {
    mocks.getTournamentById.mockResolvedValue({
      id: "t1",
      tournament_type: "classic",
      rating_formula_version: "v2",
      rating_guarantee: null,
      google_sheet_tab_name: "Sheet1",
    });
  }

  it("reads the sheet fresh and reconciles live Postgres BEFORE calculating results -- admin never needs a prior 'Обновить из GS'", async () => {
    withSheet();
    mocks.readAndParseFreeTournamentSheet.mockResolvedValue({
      ok: true,
      rows: new Map([["p1", { player_id: "p1", knockouts: 2, boss_knockouts: 0, mystery_bounty_points: 0, place: 1, eliminated: true }]]),
      dataRowCount: 1,
    });

    await POST(request({ rows: [row({ knockouts: 0, place: 1 })] }), context());

    expect(mocks.readAndParseFreeTournamentSheet).toHaveBeenCalledTimes(1);
    expect(mocks.applyLiveFieldsFromSheetSnapshot).toHaveBeenCalledWith(
      "t1",
      expect.any(Map),
      new Set(["p1"])
    );
    // applyLiveFieldsFromSheetSnapshot must be awaited BEFORE saveTournamentResults.
    const applyOrder = mocks.applyLiveFieldsFromSheetSnapshot.mock.invocationCallOrder[0];
    const saveOrder = mocks.saveTournamentResults.mock.invocationCallOrder[0];
    expect(applyOrder).toBeLessThan(saveOrder);
  });

  it("fresh KO/Boss KO/Mystery points/Место from the sheet win over stale client-submitted values", async () => {
    withSheet();
    mocks.readAndParseFreeTournamentSheet.mockResolvedValue({
      ok: true,
      rows: new Map([
        ["p1", { player_id: "p1", knockouts: 5, boss_knockouts: 2, mystery_bounty_points: 0, place: 3, eliminated: true }],
      ]),
      dataRowCount: 1,
    });

    await POST(request({ rows: [row({ knockouts: 0, place: 1 })] }), context());

    const [, results] = mocks.saveTournamentResults.mock.calls[0];
    expect(results[0]).toMatchObject({ knockouts: 5, boss_knockouts: 2, place: 3 });
  });

  it("uses live arrived/eliminated/rebuys/addons even when the background poller has not run yet -- reads Postgres AFTER the reconciliation write", async () => {
    withSheet();
    mocks.readAndParseFreeTournamentSheet.mockResolvedValue({
      ok: true,
      rows: new Map([["p1", { player_id: "p1", knockouts: 0, boss_knockouts: 0, mystery_bounty_points: 0, place: 1, eliminated: true }]]),
      dataRowCount: 1,
    });
    // Simulate the reconciliation write having landed by the time these
    // reads happen (applyLiveFieldsFromSheetSnapshot itself is mocked, but
    // the live tables it would have written are what these mocks return).
    mocks.getTournamentAttendance.mockResolvedValue(new Map([["p1", { arrived: true, arrived_at: "x" }]]));
    mocks.getTournamentEliminations.mockResolvedValue(new Map([["p1", { eliminated: true, eliminated_at: "x" }]]));
    mocks.getTournamentRebuyState.mockResolvedValue(new Map([["p1", { rebuys: 4, addons: 2 }]]));

    await POST(request({ rows: [row({ arrived: false, rebuys: 1, addons: 0 })] }), context());

    const [, results] = mocks.saveTournamentResults.mock.calls[0];
    expect(results[0]).toMatchObject({ arrived: true, reentries: 4, addons: 2 });
  });

  it("GS read failure blocks completion -- fail closed, no partial results, no status mutation", async () => {
    withSheet();
    mocks.readAndParseFreeTournamentSheet.mockResolvedValue({
      ok: false,
      reason: "Google Sheets read failed",
    });

    const response = await POST(request({ rows: [row()] }), context());

    expect(response.status).toBe(409);
    expect(mocks.saveTournamentResults).not.toHaveBeenCalled();
    expect(mocks.syncTournamentSheet).not.toHaveBeenCalled();
  });

  it("a tournament with no linked sheet is entirely unaffected -- no fresh read attempted, existing behavior preserved", async () => {
    // No google_sheet_tab_name -- the default beforeEach mock.
    await POST(request({ rows: [row()] }), context());

    expect(mocks.readAndParseFreeTournamentSheet).not.toHaveBeenCalled();
    expect(mocks.applyLiveFieldsFromSheetSnapshot).not.toHaveBeenCalled();
    expect(mocks.saveTournamentResults).toHaveBeenCalledTimes(1);
  });

  it("rating calculation itself is unaffected -- same formula, only its inputs are fresher", async () => {
    withSheet();
    mocks.readAndParseFreeTournamentSheet.mockResolvedValue({
      ok: true,
      rows: new Map([
        ["p1", { player_id: "p1", knockouts: 0, boss_knockouts: 0, mystery_bounty_points: 0, place: 1, eliminated: false }],
        ["p2", { player_id: "p2", knockouts: 0, boss_knockouts: 0, mystery_bounty_points: 0, place: 2, eliminated: false }],
        ["p3", { player_id: "p3", knockouts: 0, boss_knockouts: 0, mystery_bounty_points: 0, place: 3, eliminated: false }],
      ]),
      dataRowCount: 3,
    });

    await POST(
      request({
        rows: [
          row({ player_id: "p1", place: 1 }),
          row({ player_id: "p2", place: 2 }),
          row({ player_id: "p3", place: 3 }),
        ],
      }),
      context()
    );

    const [, results] = mocks.saveTournamentResults.mock.calls[0];
    expect(results.map((result: { rating_points: number }) => result.rating_points)).toEqual([
      72,
      55,
      41,
    ]);
  });
});
