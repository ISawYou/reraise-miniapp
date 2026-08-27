import { describe, expect, it, vi, beforeEach } from "vitest";
import { getFreeSheetColumnLayout } from "@/lib/tournament-sheet-parsing";

const mocks = vi.hoisted(() => ({
  getDerivedEliminationPlaces: vi.fn(),
  getTournamentAttendance: vi.fn(),
  getTournamentById: vi.fn(),
  getTournamentEliminations: vi.fn(),
  getTournamentRebuyState: vi.fn(),
  getTournamentResultsDraft: vi.fn(),
  getTournamentSheetExportData: vi.fn(),
  reorderTournamentEliminations: vi.fn(),
  setTournamentPlayerAttendance: vi.fn(),
  setTournamentPlayerElimination: vi.fn(),
  setTournamentPlayerRebuyState: vi.fn(),
  listExcludingStatus: vi.fn(),
  readSpreadsheetTabValues: vi.fn(),
  batchUpdateSpreadsheetValues: vi.fn(),
  applyNewRosterRowsFormatting: vi.fn(),
}));

vi.mock("@/features/tournaments", () => ({
  getDerivedEliminationPlaces: mocks.getDerivedEliminationPlaces,
  getTournamentAttendance: mocks.getTournamentAttendance,
  getTournamentById: mocks.getTournamentById,
  getTournamentEliminations: mocks.getTournamentEliminations,
  getTournamentRebuyState: mocks.getTournamentRebuyState,
  getTournamentResultsDraft: mocks.getTournamentResultsDraft,
  getTournamentSheetExportData: mocks.getTournamentSheetExportData,
  reorderTournamentEliminations: mocks.reorderTournamentEliminations,
  setTournamentPlayerAttendance: mocks.setTournamentPlayerAttendance,
  setTournamentPlayerElimination: mocks.setTournamentPlayerElimination,
  setTournamentPlayerRebuyState: mocks.setTournamentPlayerRebuyState,
}));

vi.mock("@/lib/repositories", () => ({
  tournamentRepository: { listExcludingStatus: mocks.listExcludingStatus },
}));

vi.mock("@/lib/google-sheets", () => ({
  readSpreadsheetTabValues: mocks.readSpreadsheetTabValues,
  batchUpdateSpreadsheetValues: mocks.batchUpdateSpreadsheetValues,
  applyNewRosterRowsFormatting: mocks.applyNewRosterRowsFormatting,
}));

const {
  reconcileTournamentFromSheet,
  runTournamentSheetSyncPass,
  getActiveFreeTournamentsWithSheet,
  setTournamentPlayerEliminationThroughSheet,
  reorderTournamentEliminationsThroughSheet,
} = await import("@/features/tournament-sheet-sync");

function tournament(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "t1",
    title: "Test",
    kind: "free",
    tournament_type: "classic" as const,
    status: "open" as const,
    google_sheet_tab_name: "Sheet1",
    ...overrides,
  };
}

function metaRows(): string[][] {
  return [
    ["Tournament ID", "t1"],
    ["", "", "Название", "Test Tournament", "100", "50", "0"],
    [],
    [],
    [],
    [],
  ];
}

function sheetValues(dataRows: string[][], type: "classic" = "classic"): string[][] {
  return [...metaRows(), getFreeSheetColumnLayout(type).headers, ...dataRows];
}

function p1Row(overrides: Partial<Record<number, string>> = {}) {
  // 0=id 1=system 2=nick 3=telegram 4=status 5=arrived 6=paid 7=payment
  // 8=free_reentries 9=rebuys 10=addons 11=knockouts 12=place 13=rating
  // 14=eliminated 15=eliminated_at
  const base = ["p1", "alice", "Alice", "@alice", "registered", "false", "false", "", "0", "0", "0", "0", "", "", "false", ""];
  for (const [index, value] of Object.entries(overrides)) {
    base[Number(index)] = value as string;
  }
  return base;
}

function exportRoster(rows: { player_id: string; username?: string | null; display_name?: string; registration_status?: string; rating_points?: number | null }[]) {
  return {
    tournament: tournament(),
    rows: rows.map((r) => ({
      player_id: r.player_id,
      username: r.username ?? "alice",
      display_name: r.display_name ?? "Alice",
      registration_status: r.registration_status ?? "registered",
      rating_points: r.rating_points ?? 80,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTournamentAttendance.mockResolvedValue(new Map());
  mocks.getTournamentEliminations.mockResolvedValue(new Map());
  mocks.getTournamentRebuyState.mockResolvedValue(new Map());
  mocks.getTournamentResultsDraft.mockResolvedValue([
    { player_id: "p1", display_name: "Alice", username: "alice", status: "registered" },
  ]);
  mocks.getTournamentSheetExportData.mockResolvedValue(exportRoster([{ player_id: "p1" }]));
  mocks.setTournamentPlayerAttendance.mockResolvedValue({ arrived: true, arrived_at: null });
  mocks.setTournamentPlayerElimination.mockResolvedValue({ eliminated: true, eliminated_at: null });
  mocks.setTournamentPlayerRebuyState.mockResolvedValue({ rebuys: 0, addons: 0 });
  mocks.getDerivedEliminationPlaces.mockResolvedValue(new Map());
});

describe("reconcileTournamentFromSheet -- live field reconciliation", () => {
  it("GS Пришел=true updates tournament_attendance via setTournamentPlayerAttendance", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.readSpreadsheetTabValues.mockResolvedValue(sheetValues([p1Row({ 5: "true" })]));

    const result = await reconcileTournamentFromSheet("t1");

    expect(mocks.setTournamentPlayerAttendance).toHaveBeenCalledWith("t1", "p1", true);
    expect(result).toMatchObject({ skipped: false, attendanceChanges: 1 });
  });

  it("GS Выбыл=true updates tournament_player_eliminations via setTournamentPlayerElimination, never trusting a GS timestamp", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.readSpreadsheetTabValues.mockResolvedValue(
      sheetValues([p1Row({ 14: "true", 15: "26.08.2026 20:00" })])
    );

    await reconcileTournamentFromSheet("t1");

    expect(mocks.setTournamentPlayerElimination).toHaveBeenCalledWith("t1", "p1", true);
    expect(mocks.setTournamentPlayerElimination).not.toHaveBeenCalledWith("t1", "p1", "26.08.2026 20:00");
  });

  it("GS Выбыл=false un-eliminates using existing semantics", async () => {
    mocks.getTournamentEliminations.mockResolvedValue(new Map([["p1", { eliminated: true, eliminated_at: "x" }]]));
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.readSpreadsheetTabValues.mockResolvedValue(sheetValues([p1Row({ 14: "false" })]));

    await reconcileTournamentFromSheet("t1");

    expect(mocks.setTournamentPlayerElimination).toHaveBeenCalledWith("t1", "p1", false);
  });

  it("GS Re-buy/Add-on update tournament_rebuy_state via setTournamentPlayerRebuyState", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.readSpreadsheetTabValues.mockResolvedValue(sheetValues([p1Row({ 9: "3", 10: "1" })]));

    await reconcileTournamentFromSheet("t1");

    expect(mocks.setTournamentPlayerRebuyState).toHaveBeenCalledWith("t1", "p1", 3, 1);
  });

  it("unchanged values are never rewritten", async () => {
    mocks.getTournamentAttendance.mockResolvedValue(new Map([["p1", { arrived: true, arrived_at: "x" }]]));
    mocks.getTournamentEliminations.mockResolvedValue(new Map([["p1", { eliminated: false, eliminated_at: null }]]));
    mocks.getTournamentRebuyState.mockResolvedValue(new Map([["p1", { rebuys: 2, addons: 1 }]]));
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.readSpreadsheetTabValues.mockResolvedValue(
      sheetValues([p1Row({ 5: "true", 9: "2", 10: "1", 14: "false" })])
    );

    await reconcileTournamentFromSheet("t1");

    expect(mocks.setTournamentPlayerAttendance).not.toHaveBeenCalled();
    expect(mocks.setTournamentPlayerElimination).not.toHaveBeenCalled();
    expect(mocks.setTournamentPlayerRebuyState).not.toHaveBeenCalled();
  });

  it("a waitlisted/unknown player_id in the sheet never becomes live -- only registered/attended roster is eligible", async () => {
    mocks.getTournamentResultsDraft.mockResolvedValue([]); // p1 not registered/attended
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.readSpreadsheetTabValues.mockResolvedValue(sheetValues([p1Row({ 5: "true" })]));

    await reconcileTournamentFromSheet("t1");

    expect(mocks.setTournamentPlayerAttendance).not.toHaveBeenCalled();
    expect(mocks.setTournamentPlayerElimination).not.toHaveBeenCalled();
    expect(mocks.setTournamentPlayerRebuyState).not.toHaveBeenCalled();
  });

  it("a completed tournament is never synced -- no sheet read, no Postgres writes", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ status: "completed" }));

    const result = await reconcileTournamentFromSheet("t1");

    expect(result).toEqual({ skipped: true, reason: "not eligible for GS live-sync" });
    expect(mocks.readSpreadsheetTabValues).not.toHaveBeenCalled();
    expect(mocks.setTournamentPlayerAttendance).not.toHaveBeenCalled();
  });

  it("a tournament with no linked sheet is skipped", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ google_sheet_tab_name: null }));

    const result = await reconcileTournamentFromSheet("t1");
    expect(result).toEqual({ skipped: true, reason: "not eligible for GS live-sync" });
  });

  it("an unexpected sheet layout is rejected -- nothing is written to Postgres", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.readSpreadsheetTabValues.mockResolvedValue([...metaRows(), ["Wrong", "Headers"], p1Row()]);

    const result = await reconcileTournamentFromSheet("t1");

    expect(result.skipped).toBe(true);
    expect(mocks.setTournamentPlayerAttendance).not.toHaveBeenCalled();
  });
});

describe("reconcileTournamentFromSheet -- roster sync", () => {
  it("a registered player missing from the sheet is appended with identity fields and natural defaults", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.getTournamentResultsDraft.mockResolvedValue([
      { player_id: "p1", display_name: "Alice", username: "alice", status: "registered" },
      { player_id: "p2", display_name: "Bob", username: "bob", status: "registered" },
    ]);
    mocks.getTournamentSheetExportData.mockResolvedValue(
      exportRoster([{ player_id: "p1" }, { player_id: "p2", username: "bob", display_name: "Bob" }])
    );
    mocks.readSpreadsheetTabValues.mockResolvedValue(sheetValues([p1Row()])); // only p1 present

    const result = await reconcileTournamentFromSheet("t1");

    expect(result).toMatchObject({ skipped: false, appended: 1 });
    expect(mocks.batchUpdateSpreadsheetValues).toHaveBeenCalledTimes(1);
    const [updates] = mocks.batchUpdateSpreadsheetValues.mock.calls[0];
    const appendUpdate = updates.find((u: { range: string }) => u.range.startsWith("Sheet1!A9"));
    expect(appendUpdate).toBeDefined();
    expect(appendUpdate.values[0]).toEqual([
      "p2", "bob", "Bob", "@bob", "registered", false, false, "", 0, 0, 0, 0, "", 80, false, "",
    ]);
    expect(mocks.applyNewRosterRowsFormatting).toHaveBeenCalledWith("Sheet1", 9, 1, 16, [14]);
  });

  it("existing operational values are never overwritten by roster sync -- only columns B:E are touched", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    // Sheet already has different identity text (stale Ник) but real
    // operational data (Re-buy=3) that must survive untouched.
    mocks.readSpreadsheetTabValues.mockResolvedValue(
      sheetValues([p1Row({ 2: "Old Nick", 9: "3" })])
    );

    await reconcileTournamentFromSheet("t1");

    expect(mocks.batchUpdateSpreadsheetValues).toHaveBeenCalledTimes(1);
    const [updates] = mocks.batchUpdateSpreadsheetValues.mock.calls[0];
    expect(updates).toHaveLength(1);
    expect(updates[0].range).toBe("Sheet1!B8:E8");
    expect(updates[0].values).toEqual([["alice", "Alice", "@alice", "registered"]]);
  });

  it("waitlist -> registered promotion updates only the Статус регистрации cell (and any other identity cell), never operational columns", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.getTournamentSheetExportData.mockResolvedValue(
      exportRoster([{ player_id: "p1", registration_status: "registered" }])
    );
    mocks.readSpreadsheetTabValues.mockResolvedValue(
      sheetValues([p1Row({ 4: "waitlist" })])
    );

    await reconcileTournamentFromSheet("t1");

    const [updates] = mocks.batchUpdateSpreadsheetValues.mock.calls[0];
    expect(updates[0].range).toBe("Sheet1!B8:E8");
    expect(updates[0].values[0][3]).toBe("registered");
  });

  it("no identity drift and no missing players: no sheet write happens at all", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.readSpreadsheetTabValues.mockResolvedValue(sheetValues([p1Row()]));

    const result = await reconcileTournamentFromSheet("t1");

    expect(result).toMatchObject({ appended: 0, identityUpdated: 0 });
    expect(mocks.batchUpdateSpreadsheetValues).not.toHaveBeenCalled();
    expect(mocks.applyNewRosterRowsFormatting).not.toHaveBeenCalled();
  });
});

describe("getActiveFreeTournamentsWithSheet", () => {
  it("only returns kind='free' tournaments with a linked sheet -- listExcludingStatus already excludes completed", async () => {
    mocks.listExcludingStatus.mockResolvedValue([
      tournament({ id: "a", kind: "free", google_sheet_tab_name: "Sheet1" }),
      tournament({ id: "b", kind: "free", google_sheet_tab_name: null }),
      tournament({ id: "c", kind: "cash", google_sheet_tab_name: "Sheet2" }),
    ]);

    const result = await getActiveFreeTournamentsWithSheet();

    expect(mocks.listExcludingStatus).toHaveBeenCalledWith("completed");
    expect(result.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("runTournamentSheetSyncPass -- poll loop", () => {
  it("one broken tournament's reconciliation failure never stops the pass for the others", async () => {
    mocks.listExcludingStatus.mockResolvedValue([
      tournament({ id: "broken" }),
      tournament({ id: "ok" }),
    ]);
    mocks.getTournamentById.mockImplementation(async (id: string) => {
      if (id === "broken") throw new Error("boom");
      return tournament({ id: "ok" });
    });
    mocks.readSpreadsheetTabValues.mockResolvedValue(sheetValues([p1Row({ 5: "true" })]));

    await expect(runTournamentSheetSyncPass()).resolves.toBeUndefined();

    expect(mocks.setTournamentPlayerAttendance).toHaveBeenCalledWith("ok", "p1", true);
  });
});

// Same formatting the SUT uses (formatEliminationTimestamp in
// tournament-sheet-sync.ts) -- duplicated here so the expected string is
// computed the same way in the same process/timezone as the code under
// test, rather than hardcoding a locale-formatted string that would be
// flaky across machines in different timezones.
function expectedTimeCell(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// classic layout: placeIndex=12 (column M), eliminatedAtIndex=15 (column P).
const PLACE_RANGE = "Sheet1!M8";
const TIME_RANGE = "Sheet1!P8";

describe("reconcileTournamentFromSheet -- derived placement write-back", () => {
  it("GS Выбыл=true writes the authoritative derived Место and server-derived Время выбытия back to the sheet", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.readSpreadsheetTabValues.mockResolvedValue(sheetValues([p1Row({ 5: "true", 14: "true" })]));
    mocks.getTournamentAttendance.mockResolvedValue(new Map([["p1", { arrived: true, arrived_at: "x" }]]));
    mocks.getTournamentEliminations.mockResolvedValue(
      new Map([["p1", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }]])
    );

    const result = await reconcileTournamentFromSheet("t1");

    expect(result).toMatchObject({ skipped: false, placesUpdated: 2 });
    const [updates] = mocks.batchUpdateSpreadsheetValues.mock.calls[0];
    expect(updates).toEqual(
      expect.arrayContaining([
        { range: PLACE_RANGE, values: [["1"]] },
        { range: TIME_RANGE, values: [[expectedTimeCell("2026-08-25T19:00:00.000Z")]] },
      ])
    );
  });

  it("unchanged derived cells are never rewritten -- no batch call at all when the sheet already matches", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.readSpreadsheetTabValues.mockResolvedValue(
      sheetValues([
        p1Row({ 5: "true", 14: "true", 12: "1", 15: expectedTimeCell("2026-08-25T19:00:00.000Z") }),
      ])
    );
    mocks.getTournamentAttendance.mockResolvedValue(new Map([["p1", { arrived: true, arrived_at: "x" }]]));
    mocks.getTournamentEliminations.mockResolvedValue(
      new Map([["p1", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }]])
    );

    const result = await reconcileTournamentFromSheet("t1");

    expect(result).toMatchObject({ placesUpdated: 0 });
    expect(mocks.batchUpdateSpreadsheetValues).not.toHaveBeenCalled();
  });

  it("un-eliminate (Выбыл false) clears Место and Время выбытия on the sheet", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    // Sheet currently says false, but a stale Место/Время is still sitting
    // there from before the un-check -- exactly the transition
    // unEliminatedPlayerIds exists to catch.
    mocks.readSpreadsheetTabValues.mockResolvedValue(
      sheetValues([p1Row({ 5: "true", 14: "false", 12: "17", 15: "26.08.2026, 20:00" })])
    );
    mocks.getTournamentAttendance.mockResolvedValue(new Map([["p1", { arrived: true, arrived_at: "x" }]]));
    // Was eliminated before this call; the sheet says false now.
    mocks.getTournamentEliminations.mockResolvedValueOnce(
      new Map([["p1", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }]])
    );
    mocks.getTournamentEliminations.mockResolvedValue(new Map([["p1", { eliminated: false, eliminated_at: null }]]));

    await reconcileTournamentFromSheet("t1");

    const [updates] = mocks.batchUpdateSpreadsheetValues.mock.calls[0];
    expect(updates).toEqual(
      expect.arrayContaining([
        { range: PLACE_RANGE, values: [[""]] },
        { range: TIME_RANGE, values: [[""]] },
      ])
    );
  });

  it("does not touch Место for a row that was already non-eliminated (an admin's manual winner entry survives)", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.readSpreadsheetTabValues.mockResolvedValue(
      sheetValues([p1Row({ 5: "true", 14: "false", 12: "1" })]) // manually-entered "1st place"
    );
    mocks.getTournamentAttendance.mockResolvedValue(new Map([["p1", { arrived: true, arrived_at: "x" }]]));
    mocks.getTournamentEliminations.mockResolvedValue(new Map()); // never eliminated, no transition

    await reconcileTournamentFromSheet("t1");

    expect(mocks.batchUpdateSpreadsheetValues).not.toHaveBeenCalled();
  });

  it("a completed tournament is never recalculated -- reconcileTournamentFromSheet returns before any placement logic runs", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ status: "completed" }));

    await reconcileTournamentFromSheet("t1");

    expect(mocks.readSpreadsheetTabValues).not.toHaveBeenCalled();
    expect(mocks.batchUpdateSpreadsheetValues).not.toHaveBeenCalled();
  });

  // Reproduces the exact "un-eliminate one of several eliminated players"
  // scenario: 5 arrived, p1/p2/p3 eliminated in that chronological order
  // (p1 first -> worst place, p3 most recently -> best of the three), then
  // GS flips p2's Выбыл back to false. A single poller tick must: clear
  // p2's own Место/Время (already covered above for the single-player
  // case), recompute p3's place now that p2 no longer separates it from
  // p1, leave p1's place alone (nothing about its own position changed),
  // and never require the admin to re-toggle p1 or p3 themselves.
  it("un-eliminating one of several eliminated players recomputes every remaining eliminated player's place -- no other player needs to be manually toggled", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.getTournamentResultsDraft.mockResolvedValue(
      ["p1", "p2", "p3", "p4", "p5"].map((id) => ({
        player_id: id,
        display_name: "Alice",
        username: "alice",
        status: "registered",
      }))
    );
    mocks.getTournamentSheetExportData.mockResolvedValue(
      exportRoster(["p1", "p2", "p3", "p4", "p5"].map((id) => ({ player_id: id })))
    );

    const P1_AT = "2026-01-01T00:00:00.000Z";
    const P2_AT = "2026-01-01T00:01:00.000Z";
    const P3_AT = "2026-01-01T00:02:00.000Z";

    // Sheet state THIS tick: p1 and p3 still say Выбыл=true (unchanged --
    // their own raw Место/Время already match what the algorithm will
    // recompute for p1, but are stale for p3). p2 now says Выбыл=false,
    // with its old Место/Время still sitting in the row from before.
    mocks.readSpreadsheetTabValues.mockResolvedValue(
      sheetValues([
        p1Row({ 0: "p1", 5: "true", 14: "true", 12: "5", 15: expectedTimeCell(P1_AT) }),
        p1Row({ 0: "p2", 5: "true", 14: "false", 12: "4", 15: expectedTimeCell(P2_AT) }),
        p1Row({ 0: "p3", 5: "true", 14: "true", 12: "3", 15: expectedTimeCell(P3_AT) }),
        p1Row({ 0: "p4", 5: "true", 14: "false" }),
        p1Row({ 0: "p5", 5: "true", 14: "false" }),
      ])
    );
    mocks.getTournamentAttendance.mockResolvedValue(
      new Map(["p1", "p2", "p3", "p4", "p5"].map((id) => [id, { arrived: true, arrived_at: "x" }]))
    );

    // BEFORE this tick's reconciliation (read by applyLiveFieldsFromSheetSnapshot).
    mocks.getTournamentEliminations.mockResolvedValueOnce(
      new Map([
        ["p1", { eliminated: true, eliminated_at: P1_AT }],
        ["p2", { eliminated: true, eliminated_at: P2_AT }],
        ["p3", { eliminated: true, eliminated_at: P3_AT }],
      ])
    );
    // AFTER Postgres was updated for p2 (read fresh by syncDerivedPlacementToSheet).
    mocks.getTournamentEliminations.mockResolvedValue(
      new Map([
        ["p1", { eliminated: true, eliminated_at: P1_AT }],
        ["p2", { eliminated: false, eliminated_at: null }],
        ["p3", { eliminated: true, eliminated_at: P3_AT }],
      ])
    );

    const result = await reconcileTournamentFromSheet("t1");

    // p1 and p3 are never re-toggled in Postgres -- only p2's own
    // elimination flag actually changed this tick.
    expect(mocks.setTournamentPlayerElimination).toHaveBeenCalledTimes(1);
    expect(mocks.setTournamentPlayerElimination).toHaveBeenCalledWith("t1", "p2", false);

    expect(result).toMatchObject({ skipped: false, eliminationChanges: 1 });

    const [updates] = mocks.batchUpdateSpreadsheetValues.mock.calls[0];
    // p2 (row 9): Место/Время cleared.
    expect(updates).toEqual(
      expect.arrayContaining([
        { range: "Sheet1!M9", values: [[""]] },
        { range: "Sheet1!P9", values: [[""]] },
        // p3 (row 10): was 3rd (behind p1 and p2), now 4th with p2 no
        // longer counted as eliminated -- recomputed automatically.
        { range: "Sheet1!M10", values: [["4"]] },
      ])
    );
    // p1 (row 8) keeps its own place (5th, unaffected by p2's removal) --
    // its sheet cell already matches, so it must NOT appear as an update.
    expect(updates.find((u: { range: string }) => u.range === "Sheet1!M8")).toBeUndefined();
  });
});

describe("setTournamentPlayerEliminationThroughSheet", () => {
  it("for a GS-linked active tournament, writes the Выбыл cell through to the sheet before/with the Postgres write, so the next poller tick agrees and cannot revert it", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.readSpreadsheetTabValues.mockResolvedValue(sheetValues([p1Row({ 5: "true", 14: "false" })]));
    mocks.setTournamentPlayerElimination.mockResolvedValue({ eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" });
    mocks.getTournamentAttendance.mockResolvedValue(new Map([["p1", { arrived: true, arrived_at: "x" }]]));
    mocks.getTournamentEliminations.mockResolvedValue(
      new Map([["p1", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }]])
    );
    mocks.getDerivedEliminationPlaces.mockResolvedValue(new Map([["p1", 1]]));

    const result = await setTournamentPlayerEliminationThroughSheet("t1", "p1", true);

    // The Выбыл cell write happens in its own batch call, distinct from
    // the placement write-back call.
    const eliminatedCellWrite = mocks.batchUpdateSpreadsheetValues.mock.calls
      .flatMap((call) => call[0])
      .find((u: { range: string }) => u.range === "Sheet1!O8");
    expect(eliminatedCellWrite).toEqual({ range: "Sheet1!O8", values: [[true]] });
    expect(mocks.setTournamentPlayerElimination).toHaveBeenCalledWith("t1", "p1", true);
    expect(result).toEqual({ eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z", place: 1 });
  });

  it("does not rewrite the Выбыл cell when the sheet already agrees", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.readSpreadsheetTabValues.mockResolvedValue(sheetValues([p1Row({ 5: "true", 14: "true" })]));
    mocks.setTournamentPlayerElimination.mockResolvedValue({ eliminated: true, eliminated_at: "x" });
    mocks.getDerivedEliminationPlaces.mockResolvedValue(new Map());

    await setTournamentPlayerEliminationThroughSheet("t1", "p1", true);

    const eliminatedCellWrite = mocks.batchUpdateSpreadsheetValues.mock.calls
      .flatMap((call) => call[0])
      .find((u: { range: string }) => u.range === "Sheet1!O8");
    expect(eliminatedCellWrite).toBeUndefined();
  });

  it("for a tournament with no linked sheet, preserves the exact prior direct-Postgres behavior -- no sheet read, no sheet write", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ google_sheet_tab_name: null }));
    mocks.setTournamentPlayerElimination.mockResolvedValue({ eliminated: true, eliminated_at: "x" });
    mocks.getDerivedEliminationPlaces.mockResolvedValue(new Map([["p1", 5]]));

    const result = await setTournamentPlayerEliminationThroughSheet("t1", "p1", true);

    expect(mocks.readSpreadsheetTabValues).not.toHaveBeenCalled();
    expect(mocks.batchUpdateSpreadsheetValues).not.toHaveBeenCalled();
    expect(result).toEqual({ eliminated: true, eliminated_at: "x", place: 5 });
  });

  it("for a completed tournament, preserves direct-Postgres behavior even if a sheet is linked", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ status: "completed" }));
    mocks.setTournamentPlayerElimination.mockResolvedValue({ eliminated: false, eliminated_at: null });
    mocks.getDerivedEliminationPlaces.mockResolvedValue(new Map());

    await setTournamentPlayerEliminationThroughSheet("t1", "p1", false);

    expect(mocks.readSpreadsheetTabValues).not.toHaveBeenCalled();
  });

  describe("failClosedOnSheetWrite (\"Вернуть в игру\")", () => {
    it("with the flag OMITTED, a sheet write failure stays fail-open -- Postgres still applies (unchanged default behavior)", async () => {
      mocks.getTournamentById.mockResolvedValue(tournament());
      mocks.readSpreadsheetTabValues.mockResolvedValue(sheetValues([p1Row({ 5: "true", 14: "true" })]));
      mocks.batchUpdateSpreadsheetValues.mockRejectedValueOnce(new Error("Sheets API down"));
      mocks.setTournamentPlayerElimination.mockResolvedValue({ eliminated: false, eliminated_at: null });
      mocks.getDerivedEliminationPlaces.mockResolvedValue(new Map());

      const result = await setTournamentPlayerEliminationThroughSheet("t1", "p1", false);

      expect(mocks.setTournamentPlayerElimination).toHaveBeenCalledWith("t1", "p1", false);
      expect(result.eliminated).toBe(false);
    });

    it("sheet checkbox write failure -> throws, and Postgres is NEVER touched (no GS=true/Postgres=false split)", async () => {
      mocks.getTournamentById.mockResolvedValue(tournament());
      mocks.readSpreadsheetTabValues.mockResolvedValue(sheetValues([p1Row({ 5: "true", 14: "true" })]));
      mocks.batchUpdateSpreadsheetValues.mockRejectedValueOnce(new Error("Sheets API down"));

      await expect(
        setTournamentPlayerEliminationThroughSheet("t1", "p1", false, { failClosedOnSheetWrite: true })
      ).rejects.toThrow();

      expect(mocks.setTournamentPlayerElimination).not.toHaveBeenCalled();
    });

    it("sheet cannot be read -> throws, Postgres untouched", async () => {
      mocks.getTournamentById.mockResolvedValue(tournament());
      mocks.readSpreadsheetTabValues.mockRejectedValue(new Error("network error"));

      await expect(
        setTournamentPlayerEliminationThroughSheet("t1", "p1", false, { failClosedOnSheetWrite: true })
      ).rejects.toThrow();

      expect(mocks.setTournamentPlayerElimination).not.toHaveBeenCalled();
    });

    it("player's row missing from this moment's sheet snapshot -> throws, Postgres untouched", async () => {
      mocks.getTournamentById.mockResolvedValue(tournament());
      // Sheet read succeeds but has no row for p1 (e.g. a mid-edit gap).
      mocks.readSpreadsheetTabValues.mockResolvedValue(sheetValues([]));

      await expect(
        setTournamentPlayerEliminationThroughSheet("t1", "p1", false, { failClosedOnSheetWrite: true })
      ).rejects.toThrow();

      expect(mocks.setTournamentPlayerElimination).not.toHaveBeenCalled();
    });

    it("sheet write succeeds -> proceeds exactly like the default path (Postgres updated, place returned)", async () => {
      mocks.getTournamentById.mockResolvedValue(tournament());
      mocks.readSpreadsheetTabValues.mockResolvedValue(sheetValues([p1Row({ 5: "true", 14: "true" })]));
      mocks.setTournamentPlayerElimination.mockResolvedValue({ eliminated: false, eliminated_at: null });
      mocks.getDerivedEliminationPlaces.mockResolvedValue(new Map());

      const result = await setTournamentPlayerEliminationThroughSheet(
        "t1",
        "p1",
        false,
        { failClosedOnSheetWrite: true }
      );

      expect(mocks.setTournamentPlayerElimination).toHaveBeenCalledWith("t1", "p1", false);
      expect(result).toEqual({ eliminated: false, eliminated_at: null, place: null });
    });
  });
});

describe("reorderTournamentEliminationsThroughSheet -- \"Исправить порядок выбывания\"", () => {
  it("completed tournament rejects the correction outright", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ status: "completed" }));

    const result = await reorderTournamentEliminationsThroughSheet("t1", ["p1"]);

    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(mocks.reorderTournamentEliminations).not.toHaveBeenCalled();
  });

  it("propagates a stale-list rejection from reorderTournamentEliminations without touching the sheet", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.reorderTournamentEliminations.mockResolvedValue({ ok: false, error: "stale" });

    const result = await reorderTournamentEliminationsThroughSheet("t1", ["p1"]);

    expect(result).toEqual({ ok: false, error: "stale" });
    expect(mocks.readSpreadsheetTabValues).not.toHaveBeenCalled();
    expect(mocks.batchUpdateSpreadsheetValues).not.toHaveBeenCalled();
  });

  it("on success, pushes recomputed Место/Время выбытия for the corrected set to the sheet", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.reorderTournamentEliminations.mockResolvedValue({ ok: true });
    mocks.readSpreadsheetTabValues.mockResolvedValue(
      sheetValues([p1Row({ 5: "true", 14: "true", 12: "1" })]) // stale Место, needs recompute
    );
    mocks.getTournamentAttendance.mockResolvedValue(new Map([["p1", { arrived: true, arrived_at: "x" }]]));
    mocks.getTournamentEliminations.mockResolvedValue(
      new Map([["p1", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }]])
    );

    const result = await reorderTournamentEliminationsThroughSheet("t1", ["p1"]);

    expect(result).toEqual({ ok: true });
    expect(mocks.batchUpdateSpreadsheetValues).toHaveBeenCalled();
  });

  it("a sheet-side failure after a successful Postgres reorder is swallowed -- the correction still reports ok (self-heals on the next poll)", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.reorderTournamentEliminations.mockResolvedValue({ ok: true });
    mocks.readSpreadsheetTabValues.mockRejectedValue(new Error("Sheets API down"));

    const result = await reorderTournamentEliminationsThroughSheet("t1", ["p1"]);

    expect(result).toEqual({ ok: true });
  });

  it("no linked sheet -- Postgres reorder still applies, no sheet interaction attempted", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ google_sheet_tab_name: null }));
    mocks.reorderTournamentEliminations.mockResolvedValue({ ok: true });

    const result = await reorderTournamentEliminationsThroughSheet("t1", ["p1"]);

    expect(result).toEqual({ ok: true });
    expect(mocks.readSpreadsheetTabValues).not.toHaveBeenCalled();
  });

  it("the very next poller tick after a reorder is idempotent -- no elimination checkbox changed, so nothing is undone", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament());
    mocks.reorderTournamentEliminations.mockResolvedValue({ ok: true });
    // Simulates state immediately after a successful reorder: sheet already
    // reflects the corrected Место/Время, Выбыл is untouched (still true).
    mocks.readSpreadsheetTabValues.mockResolvedValue(
      sheetValues([
        p1Row({
          5: "true",
          14: "true",
          12: "1",
          15: new Date("2026-08-25T19:00:00.000Z").toLocaleString("ru-RU", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          }),
        }),
      ])
    );
    mocks.getTournamentAttendance.mockResolvedValue(new Map([["p1", { arrived: true, arrived_at: "x" }]]));
    mocks.getTournamentEliminations.mockResolvedValue(
      new Map([["p1", { eliminated: true, eliminated_at: "2026-08-25T19:00:00.000Z" }]])
    );

    await reconcileTournamentFromSheet("t1");

    // No un-elimination, no re-elimination -- the poller found nothing to
    // reconcile because Postgres and the sheet already agree.
    expect(mocks.setTournamentPlayerElimination).not.toHaveBeenCalled();
    expect(mocks.batchUpdateSpreadsheetValues).not.toHaveBeenCalled();
  });
});
