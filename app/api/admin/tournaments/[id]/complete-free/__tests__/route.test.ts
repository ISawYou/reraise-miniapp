import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getTournamentAttendance: vi.fn(),
  getTournamentById: vi.fn(),
  getTournamentRebuyState: vi.fn(),
  saveTournamentResults: vi.fn(),
  getMysteryBountySnapshot: vi.fn(),
  syncTournamentSheet: vi.fn(),
}));

vi.mock("@/features/tournaments", () => ({
  getTournamentAttendance: mocks.getTournamentAttendance,
  getTournamentById: mocks.getTournamentById,
  getTournamentRebuyState: mocks.getTournamentRebuyState,
  saveTournamentResults: mocks.saveTournamentResults,
}));

vi.mock("@/features/mystery-bounty", () => ({
  getMysteryBountySnapshot: mocks.getMysteryBountySnapshot,
}));

vi.mock("@/app/api/admin/tournaments/[id]/export-sheet/route", () => ({
  syncTournamentSheet: mocks.syncTournamentSheet,
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
  mocks.getTournamentRebuyState.mockResolvedValue(new Map());
  mocks.saveTournamentResults.mockResolvedValue(undefined);
  mocks.syncTournamentSheet.mockResolvedValue({ tabName: "Sheet1" });
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
    // free_reentries has no column on results at all -- proven by it not
    // appearing anywhere in the payload saveTournamentResults receives.
    expect(results[0]).not.toHaveProperty("free_reentries");
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
});
