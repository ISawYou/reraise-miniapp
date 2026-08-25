import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getTournamentById: vi.fn(),
  getTournamentResultsDraft: vi.fn(),
  getTournamentLiveEntries: vi.fn(),
  applyTournamentLiveSheetRows: vi.fn(),
  setTournamentPlayerAttendance: vi.fn(),
  setTournamentPlayerRebuyState: vi.fn(),
  readSpreadsheetTabValues: vi.fn(),
}));

vi.mock("@/features/tournaments", () => ({
  getTournamentById: mocks.getTournamentById,
  getTournamentResultsDraft: mocks.getTournamentResultsDraft,
  getTournamentLiveEntries: mocks.getTournamentLiveEntries,
  applyTournamentLiveSheetRows: mocks.applyTournamentLiveSheetRows,
  setTournamentPlayerAttendance: mocks.setTournamentPlayerAttendance,
  setTournamentPlayerRebuyState: mocks.setTournamentPlayerRebuyState,
}));

vi.mock("@/lib/google-sheets", () => ({
  readSpreadsheetTabValues: mocks.readSpreadsheetTabValues,
}));

const { POST } = await import("@/app/api/admin/tournaments/[id]/pull-sheet/route");

function context(id = "t1") {
  return { params: Promise.resolve({ id }) };
}

function request(body?: unknown) {
  return new Request("http://localhost/api/admin/tournaments/t1/pull-sheet", {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// One free-tournament data row: player_id, username, display_name,
// telegram, reg_status, arrived, paid, payment_type, free_reentries,
// rebuys, addons, knockouts, place -- matches pull-sheet/route.ts's
// non-boss/non-mystery column layout (knockoutsIndex=11, placeIndex=12).
// The real Google Sheets API always returns string cells, and
// parseNumberCell/parseBooleanCell call .trim() on every value -- every
// cell here must be a string, exactly like production data, or those calls
// throw.
function freeSheetValues(dataRow: string[]) {
  return [
    ["Tournament ID", "t1"],
    ["", "", "Название", "Test Tournament", "100", "50", "0"],
    [],
    [],
    [],
    [],
    [],
    dataRow,
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setTournamentPlayerAttendance.mockResolvedValue({ arrived: true, arrived_at: null });
  mocks.setTournamentPlayerRebuyState.mockResolvedValue({ rebuys: 0, addons: 0 });
});

describe("POST /api/admin/tournaments/[id]/pull-sheet (kind=free)", () => {
  beforeEach(() => {
    mocks.getTournamentById.mockResolvedValue({
      id: "t1",
      kind: "free",
      tournament_type: "classic",
      google_sheet_tab_name: "Sheet1",
    });
    mocks.getTournamentResultsDraft.mockResolvedValue([
      { player_id: "p1", display_name: "Alice", username: "alice" },
    ]);
    mocks.readSpreadsheetTabValues.mockResolvedValue(
      freeSheetValues(["p1", "alice", "Alice", "@alice", "registered", "true", "false", "", "0", "3", "1", "0", ""])
    );
  });

  it("without commit (no body, matches the automatic read-only preview fetch on page load): returns parsed rows but writes nothing to Postgres", async () => {
    const response = await POST(request(), context());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.rows).toEqual([
      expect.objectContaining({ player_id: "p1", arrived: true, rebuys: 3, addons: 1 }),
    ]);
    expect(mocks.setTournamentPlayerAttendance).not.toHaveBeenCalled();
    expect(mocks.setTournamentPlayerRebuyState).not.toHaveBeenCalled();
  });

  it("with commit:false explicitly: still writes nothing (same as omitted)", async () => {
    const response = await POST(request({ commit: false }), context());
    expect(response.status).toBe(200);
    expect(mocks.setTournamentPlayerAttendance).not.toHaveBeenCalled();
    expect(mocks.setTournamentPlayerRebuyState).not.toHaveBeenCalled();
  });

  it("with commit:true (the explicit \"Обновить из GS\" click): persists arrived into tournament_attendance and rebuys/addons into tournament_rebuy_state for every row", async () => {
    const response = await POST(request({ commit: true }), context());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.setTournamentPlayerAttendance).toHaveBeenCalledWith("t1", "p1", true);
    expect(mocks.setTournamentPlayerRebuyState).toHaveBeenCalledWith("t1", "p1", 3, 1);
    // The response payload is unaffected by commit -- same shape either way.
    expect(json.rows).toEqual([
      expect.objectContaining({ player_id: "p1", arrived: true, rebuys: 3, addons: 1 }),
    ]);
  });

  it("commit:true with Re-buy 0->1->2 across successive pulls: each pull persists the latest sheet value", async () => {
    mocks.readSpreadsheetTabValues.mockResolvedValueOnce(
      freeSheetValues(["p1", "alice", "Alice", "@alice", "registered", "true", "false", "", "0", "0", "0", "0", ""])
    );
    await POST(request({ commit: true }), context());
    expect(mocks.setTournamentPlayerRebuyState).toHaveBeenLastCalledWith("t1", "p1", 0, 0);

    mocks.readSpreadsheetTabValues.mockResolvedValueOnce(
      freeSheetValues(["p1", "alice", "Alice", "@alice", "registered", "true", "false", "", "0", "1", "0", "0", ""])
    );
    await POST(request({ commit: true }), context());
    expect(mocks.setTournamentPlayerRebuyState).toHaveBeenLastCalledWith("t1", "p1", 1, 0);

    mocks.readSpreadsheetTabValues.mockResolvedValueOnce(
      freeSheetValues(["p1", "alice", "Alice", "@alice", "registered", "true", "false", "", "0", "2", "0", "0", ""])
    );
    await POST(request({ commit: true }), context());
    expect(mocks.setTournamentPlayerRebuyState).toHaveBeenLastCalledWith("t1", "p1", 2, 0);
  });

  it("commit:true with arrived flipping false->true: persists the new value into tournament_attendance", async () => {
    mocks.readSpreadsheetTabValues.mockResolvedValueOnce(
      freeSheetValues(["p1", "alice", "Alice", "@alice", "registered", "false", "false", "", "0", "0", "0", "0", ""])
    );
    await POST(request({ commit: true }), context());
    expect(mocks.setTournamentPlayerAttendance).toHaveBeenLastCalledWith("t1", "p1", false);

    mocks.readSpreadsheetTabValues.mockResolvedValueOnce(
      freeSheetValues(["p1", "alice", "Alice", "@alice", "registered", "true", "false", "", "0", "0", "0", "0", ""])
    );
    await POST(request({ commit: true }), context());
    expect(mocks.setTournamentPlayerAttendance).toHaveBeenLastCalledWith("t1", "p1", true);
  });

  it("free_reentries and bounty points are parsed for display but never sent to the rebuy-state write -- only rebuys/addons are", async () => {
    mocks.readSpreadsheetTabValues.mockResolvedValueOnce(
      freeSheetValues(["p1", "alice", "Alice", "@alice", "registered", "true", "false", "", "7", "3", "1", "0", ""])
    );
    await POST(request({ commit: true }), context());

    expect(mocks.setTournamentPlayerRebuyState).toHaveBeenCalledWith("t1", "p1", 3, 1);
    expect(mocks.setTournamentPlayerRebuyState).not.toHaveBeenCalledWith("t1", "p1", 7, expect.anything());
  });
});

describe("POST /api/admin/tournaments/[id]/pull-sheet (kind=cash, unaffected)", () => {
  it("commit:true has no effect on the free-tournament write path -- paid/cash still only calls applyTournamentLiveSheetRows", async () => {
    mocks.getTournamentById.mockResolvedValue({
      id: "t1",
      kind: "cash",
      tournament_type: "classic",
      google_sheet_tab_name: "Sheet1",
    });
    mocks.readSpreadsheetTabValues.mockResolvedValue([
      ["Tournament ID", "t1"],
      ["", "", "Название", "Test", "100", "50", "0"],
      [],
      [],
      [],
      [],
      [],
      // Live-branch column layout (pull-sheet/route.ts): 0=player_id,
      // 4=arrived, 5=paid, 6=payment_type, 7=free_reentries, 8=rebuys,
      // 9=addons, 10=knockouts, 11=place.
      ["p1", "", "", "", "true", "false", "", "0", "2", "0", "0", ""],
    ]);
    mocks.applyTournamentLiveSheetRows.mockResolvedValue([]);
    mocks.getTournamentLiveEntries.mockResolvedValue([]);

    const response = await POST(request({ commit: true }), context());

    expect(response.status).toBe(200);
    expect(mocks.applyTournamentLiveSheetRows).toHaveBeenCalledTimes(1);
    expect(mocks.setTournamentPlayerAttendance).not.toHaveBeenCalled();
    expect(mocks.setTournamentPlayerRebuyState).not.toHaveBeenCalled();
  });
});
