import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFreeSheetColumnLayout } from "@/lib/tournament-sheet-parsing";

// Operational-roster stale-row REMOVAL in features/tournament-sheet-sync.ts,
// against a STATEFUL fake tab: value writes are really applied by A1 range
// and row deletions are really applied in the order given (exactly like
// Sheets applies one batchUpdate's requests sequentially). A wrong deletion
// order, a deletion by nickname, or a row-number write computed from a
// pre-deletion snapshot would therefore corrupt the fake tab and fail here.

type Cell = string | number | boolean | null;

const sheet = vi.hoisted(() => ({
  values: [] as string[][],
  deleteCalls: [] as number[][],
  reads: 0,
  failDelete: false,
  failReadAfter: Infinity,
}));

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function cellText(value: Cell): string {
  if (value === true) return "TRUE";
  if (value === false) return "FALSE";
  return value == null ? "" : String(value);
}

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
  reconcileTournamentWaitlistCapacity: vi.fn(),
  assertTournamentSeatAvailableForReturn: vi.fn(),
  batchWrites: [] as { range: string; values: Cell[][] }[],
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
vi.mock("@/features/tournament-waitlist-capacity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/tournament-waitlist-capacity")>()),
  reconcileTournamentWaitlistCapacity: mocks.reconcileTournamentWaitlistCapacity,
  assertTournamentSeatAvailableForReturn: mocks.assertTournamentSeatAvailableForReturn,
}));
vi.mock("@/lib/repositories", () => ({
  tournamentRepository: { listExcludingStatus: mocks.listExcludingStatus },
}));
vi.mock("@/lib/google-sheets", () => ({
  readSpreadsheetTabValues: vi.fn(async () => {
    sheet.reads++;
    if (sheet.reads > sheet.failReadAfter) throw new Error("fake read failure");
    return sheet.values.map((row) => [...row]);
  }),
  batchUpdateSpreadsheetValues: vi.fn(async (updates: { range: string; values: Cell[][] }[]) => {
    for (const update of updates) {
      mocks.batchWrites.push(update);
      const match = /^(.*)!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(update.range)!;
      const startCol = columnIndex(match[2]);
      const startRow = Number(match[3]);
      update.values.forEach((cells, r) => {
        const index = startRow - 1 + r;
        while (sheet.values.length <= index) sheet.values.push([]);
        cells.forEach((value, c) => {
          const target = sheet.values[index];
          while (target.length <= startCol + c) target.push("");
          target[startCol + c] = cellText(value);
        });
      });
    }
  }),
  deleteSpreadsheetTabRows: vi.fn(async (_tab: string, rowNumbers: number[], minRowNumber: number) => {
    if (sheet.failDelete) throw new Error("fake delete failure");
    sheet.deleteCalls.push([...rowNumbers]);
    for (const rowNumber of rowNumbers) {
      if (rowNumber < minRowNumber) throw new Error("protected row");
      sheet.values.splice(rowNumber - 1, 1);
    }
    return rowNumbers;
  }),
  applyNewRosterRowsFormatting: vi.fn(async () => undefined),
}));

const { reconcileTournamentFromSheet, syncOperationalRosterToSheet, syncTournamentRosterToSheet } =
  await import("@/features/tournament-sheet-sync");

const HEADERS = getFreeSheetColumnLayout("classic").headers;
const META: string[][] = [["Tournament ID", "t1"], ["", "", "Название", "Test", "100"], [], [], [], []];

function tournament(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "Test",
    kind: "free",
    tournament_type: "classic" as const,
    status: "open" as const,
    google_sheet_tab_name: "Tab",
    ...overrides,
  };
}

// 0=id 1=system 2=nick 3=telegram 4=status 5=arrived 6=paid 7=payment
// 8=free 9=rebuys 10=addons 11=KO 12=place 13=rating 14=eliminated 15=time
function dataRow(id: string, opts: { nick?: string; status?: string; arrived?: boolean; rebuys?: number; ko?: number; place?: string; eliminated?: boolean } = {}) {
  return [
    id,
    id,
    opts.nick ?? id.toUpperCase(),
    `@${id}`,
    opts.status ?? "registered",
    opts.arrived ? "TRUE" : "FALSE",
    "FALSE",
    "",
    "0",
    String(opts.rebuys ?? 0),
    "0",
    String(opts.ko ?? 0),
    opts.place ?? "",
    "",
    opts.eliminated ? "TRUE" : "FALSE",
    "",
  ];
}

function seed(rows: string[][]) {
  sheet.values = [...META.map((r) => [...r]), [...HEADERS], ...rows];
}

function roster(...ids: string[]) {
  return {
    tournament: tournament(),
    rows: ids.map((id) => ({
      player_id: id,
      username: id,
      display_name: id.toUpperCase(),
      registration_status: "registered",
      rating_points: null,
    })),
  };
}

function dataIds(): string[] {
  return sheet.values.slice(7).map((row) => row[0]);
}

function rowOf(id: string): string[] | undefined {
  return sheet.values.slice(7).find((row) => row[0] === id);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.batchWrites = [];
  sheet.values = [];
  sheet.deleteCalls = [];
  sheet.reads = 0;
  sheet.failDelete = false;
  sheet.failReadAfter = Infinity;
  mocks.getTournamentById.mockResolvedValue(tournament());
  mocks.getTournamentAttendance.mockResolvedValue(new Map());
  mocks.getTournamentEliminations.mockResolvedValue(new Map());
  mocks.getTournamentRebuyState.mockResolvedValue(new Map());
  mocks.getDerivedEliminationPlaces.mockResolvedValue(new Map());
  mocks.reconcileTournamentWaitlistCapacity.mockResolvedValue({ promotedRegistrationIds: [], promotedPlayerIds: [] });
  mocks.getTournamentResultsDraft.mockResolvedValue([]);
});

describe("operational roster: stale-row removal", () => {
  it("removes a stale ordinary-waitlist row AND a stale no-show row, keeps registered/attended rows, header/meta untouched", async () => {
    seed([
      dataRow("a", { arrived: true, rebuys: 2 }),
      dataRow("noshow", { status: "registered" }),
      dataRow("b", { arrived: true, ko: 3 }),
      dataRow("wait", { status: "waitlist" }),
      dataRow("c", { arrived: true }),
    ]);
    mocks.getTournamentSheetExportData.mockResolvedValue(roster("a", "b", "c"));

    const result = await syncOperationalRosterToSheet("t1");

    expect(result).toMatchObject({ synced: true, removed: 2, appended: 0, staleRowsPending: 0 });
    expect(dataIds()).toEqual(["a", "b", "c"]);
    expect(sheet.values.slice(0, 6)).toEqual(META);
    expect(sheet.values[6]).toEqual(HEADERS);
    // One batch, DESCENDING row numbers (wait=11, noshow=9).
    expect(sheet.deleteCalls).toEqual([[11, 9]]);
    // Remaining operational values untouched.
    expect(rowOf("a")!.slice(5, 12)).toEqual(["TRUE", "FALSE", "", "0", "2", "0", "0"]);
    expect(rowOf("b")![11]).toBe("3");
  });

  it("deletes by EXACT player_id only: same nickname, an id-prefix look-alike and an empty Player ID row are all kept", async () => {
    seed([
      dataRow("p1", { nick: "Twin" }),
      dataRow("p10", { nick: "Twin" }),
      ["", "", "operator note", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      dataRow("p100"),
    ]);
    // p10 left the roster; p1 / p100 share a prefix, p1 shares the nick.
    mocks.getTournamentSheetExportData.mockResolvedValue(roster("p1", "p100"));

    await syncOperationalRosterToSheet("t1");

    expect(sheet.deleteCalls).toEqual([[9]]);
    expect(dataIds()).toEqual(["p1", "", "p100"]);
    // The kept "Twin" row is p1's own (its exact id), never matched by nick.
    expect(rowOf("p1")).toBeDefined();
    expect(sheet.values.slice(7).find((row) => row[2] === "operator note")).toBeDefined();
  });

  it("every duplicate row of a stale player is removed; a duplicate row of an operational player is never removed", async () => {
    seed([dataRow("a"), dataRow("x"), dataRow("a", { rebuys: 5 }), dataRow("x"), dataRow("b")]);
    mocks.getTournamentSheetExportData.mockResolvedValue(roster("a", "b"));

    await syncOperationalRosterToSheet("t1");

    expect(sheet.deleteCalls).toEqual([[11, 9]]);
    expect(dataIds()).toEqual(["a", "a", "b"]);
  });

  it("many deletions in one pass are index-shift safe (descending), and a promoted player is appended after them at the fresh end", async () => {
    seed([
      dataRow("s1"),
      dataRow("a", { rebuys: 1 }),
      dataRow("s2"),
      dataRow("s3"),
      dataRow("b", { rebuys: 2 }),
      dataRow("s4"),
    ]);
    mocks.getTournamentSheetExportData.mockResolvedValue(roster("a", "b", "promoted"));

    const result = await syncOperationalRosterToSheet("t1");

    expect(sheet.deleteCalls).toEqual([[13, 11, 10, 8]]);
    expect(result).toMatchObject({ removed: 4, appended: 1 });
    expect(dataIds()).toEqual(["a", "b", "promoted"]);
    expect(rowOf("a")![9]).toBe("1");
    expect(rowOf("b")![9]).toBe("2");
    // Appended right after the 2 remaining rows (row 10), never over them.
    expect(mocks.batchWrites.find((w) => w.range.startsWith("Tab!A"))?.range).toBe("Tab!A10:P10");
    expect(rowOf("promoted")!.slice(0, 6)).toEqual(["promoted", "promoted", "PROMOTED", "@promoted", "registered", "FALSE"]);
  });

  it("after deletion, row-number-based identity updates use a FRESH re-read (the shifted row is rewritten at its new number)", async () => {
    seed([dataRow("stale"), dataRow("a", { rebuys: 4 })]);
    // a's identity changed (display name) -- must be written at row 8 after
    // stale (row 8) is deleted, not at its pre-deletion row 9.
    mocks.getTournamentSheetExportData.mockResolvedValue({
      tournament: tournament(),
      rows: [{ player_id: "a", username: "a", display_name: "A-renamed", registration_status: "registered", rating_points: null }],
    });

    await syncOperationalRosterToSheet("t1");

    expect(mocks.batchWrites).toContainEqual({ range: "Tab!B8:E8", values: [["a", "A-renamed", "@a", "registered"]] });
    expect(sheet.values.length).toBe(8);
    expect(rowOf("a")).toEqual([...dataRow("a", { rebuys: 4 }).slice(0, 2), "A-renamed", ...dataRow("a", { rebuys: 4 }).slice(3)]);
  });

  it("reconciler pass: derived Место/Время выбытия writes after a deletion target the post-deletion row numbers", async () => {
    seed([dataRow("stale"), dataRow("a", { arrived: true, eliminated: true }), dataRow("b", { arrived: true })]);
    mocks.getTournamentSheetExportData.mockResolvedValue(roster("a", "b"));
    mocks.getTournamentResultsDraft.mockResolvedValue([
      { player_id: "a", display_name: "A", username: "a", status: "registered" },
      { player_id: "b", display_name: "B", username: "b", status: "registered" },
    ]);
    mocks.getTournamentAttendance.mockResolvedValue(
      new Map([
        ["a", { arrived: true, arrived_at: null }],
        ["b", { arrived: true, arrived_at: null }],
      ])
    );
    mocks.getTournamentEliminations.mockResolvedValue(
      new Map([["a", { eliminated: true, eliminated_at: "2026-10-12T18:00:00.000Z" }]])
    );

    await reconcileTournamentFromSheet("t1");

    expect(sheet.deleteCalls).toEqual([[8]]);
    // a moved from row 9 to row 8; its derived place (2 of 2) lands there.
    expect(rowOf("a")![12]).toBe("2");
    expect(rowOf("b")![12]).toBe("");
    expect(mocks.batchWrites.some((w) => w.range === "Tab!M9")).toBe(false);
  });

  it("a failed deletion is fail-open: nothing deleted, no row-number corruption, pending reported; syncOperationalRosterToSheet throws for the caller's warning", async () => {
    seed([dataRow("stale"), dataRow("a", { rebuys: 1 })]);
    mocks.getTournamentSheetExportData.mockResolvedValue({
      tournament: tournament(),
      rows: [
        { player_id: "a", username: "a", display_name: "A2", registration_status: "registered", rating_points: null },
        { player_id: "new", username: "new", display_name: "NEW", registration_status: "registered", rating_points: null },
      ],
    });
    sheet.failDelete = true;

    const result = await syncTournamentRosterToSheet(tournament() as never, new Map(), 0, undefined).catch(() => null);
    // (called with an empty snapshot: nothing stale is visible -> no delete)
    expect(result).toMatchObject({ removed: 0, staleRowsPending: 0 });

    mocks.batchWrites = [];
    sheet.values = [...META.map((r) => [...r]), [...HEADERS], dataRow("stale"), dataRow("a", { rebuys: 1 })];
    await expect(syncOperationalRosterToSheet("t1")).rejects.toThrow("stale rows could not be removed");
    expect(dataIds()).toEqual(["stale", "a", "new"]);
    // Identity write used the UNMODIFIED snapshot's row number for a (9).
    expect(mocks.batchWrites).toContainEqual({ range: "Tab!B9:E9", values: [["a", "A2", "@a", "registered"]] });
    expect(rowOf("a")![9]).toBe("1");
  });

  it("rows deleted but the follow-up read fails: no further row-number-based write this pass", async () => {
    seed([dataRow("stale"), dataRow("a")]);
    mocks.getTournamentSheetExportData.mockResolvedValue({
      tournament: tournament(),
      rows: [{ player_id: "a", username: "a", display_name: "A2", registration_status: "registered", rating_points: null }],
    });
    // read #1 = initial, #2 = fresh pre-delete, #3 = post-delete -> fails
    sheet.failReadAfter = 2;

    const result = await syncOperationalRosterToSheet("t1");

    expect(result).toMatchObject({ removed: 1, identityUpdated: 0, appended: 0 });
    expect(mocks.batchWrites).toEqual([]);
    expect(dataIds()).toEqual(["a"]);
  });

  it("syncOperationalRosterToSheet is a no-op for a tournament that isn't GS-operated", async () => {
    for (const t of [tournament({ kind: "paid" }), tournament({ status: "completed" }), tournament({ google_sheet_tab_name: null })]) {
      mocks.getTournamentById.mockResolvedValue(t);
      await expect(syncOperationalRosterToSheet("t1")).resolves.toMatchObject({ synced: false });
    }
    expect(sheet.reads).toBe(0);
  });

  it("syncOperationalRosterToSheet throws when the sheet can't be read (caller turns it into a warning)", async () => {
    sheet.failReadAfter = 0;
    mocks.getTournamentSheetExportData.mockResolvedValue(roster("a"));
    await expect(syncOperationalRosterToSheet("t1")).rejects.toThrow("Google Sheet roster sync failed");
  });

  it("a clean operational sheet triggers no extra reads and no deletion", async () => {
    seed([dataRow("a"), dataRow("b")]);
    mocks.getTournamentSheetExportData.mockResolvedValue(roster("a", "b"));

    await syncOperationalRosterToSheet("t1");

    expect(sheet.reads).toBe(1);
    expect(sheet.deleteCalls).toEqual([]);
  });
});
