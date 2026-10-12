import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFreeSheetColumnLayout } from "@/lib/tournament-sheet-parsing";
import {
  buildFreeTournamentReadmeSheetValues,
  buildLiveTournamentReadmeSheetValues,
} from "@/lib/tournament-sheet-readme";

// Google Sheets side of the no-show waitlist policy -- same mocking shape
// as tournament-sheet-sync.test.ts. (The REAL sheet -> setTournamentPlayerAttendance
// -> Postgres path, incl. restriction clearing, is proven against a real
// database in no-show-waitlist-policy.postgres.integration.test.ts.)
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
  reconcileTournamentWaitlistCapacity: vi.fn(),
  assertTournamentSeatAvailableForReturn: vi.fn(),
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
  readSpreadsheetTabValues: mocks.readSpreadsheetTabValues,
  batchUpdateSpreadsheetValues: mocks.batchUpdateSpreadsheetValues,
  applyNewRosterRowsFormatting: mocks.applyNewRosterRowsFormatting,
}));

const { reconcileTournamentFromSheet, syncAdmittedPlayerToSheet } = await import(
  "@/features/tournament-sheet-sync"
);

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

function sheetValues(dataRows: string[][]): string[][] {
  return [[], [], [], [], [], [], getFreeSheetColumnLayout("classic").headers, ...dataRows];
}

// 0=id 1=system 2=nick 3=telegram 4=status 5=arrived ... 14=eliminated
function row(id: string, status: string, arrived: "true" | "false"): string[] {
  return [id, id, id.toUpperCase(), `@${id}`, status, arrived, "false", "", "0", "0", "0", "0", "", "", "false", ""];
}

function allWrites(): Array<{ range: string; values: unknown[][] }> {
  return mocks.batchUpdateSpreadsheetValues.mock.calls.flatMap(
    (call) => call[0] as Array<{ range: string; values: unknown[][] }>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTournamentById.mockResolvedValue(tournament());
  mocks.getTournamentAttendance.mockResolvedValue(new Map());
  mocks.getTournamentEliminations.mockResolvedValue(new Map());
  mocks.getTournamentRebuyState.mockResolvedValue(new Map());
  mocks.setTournamentPlayerAttendance.mockResolvedValue({ arrived: true, arrived_at: null });
  mocks.reconcileTournamentWaitlistCapacity.mockResolvedValue({
    promotedRegistrationIds: [],
    promotedPlayerIds: [],
  });
});

describe("no new Google Sheets columns -- the layout is byte-identical", () => {
  it("classic headers are exactly the pre-existing ones; no 'Не пришёл' / 'Допустить' / restriction column", () => {
    const layout = getFreeSheetColumnLayout("classic");
    expect(layout.headers).toEqual([
      "Player ID",
      "System",
      "Ник",
      "Telegram",
      "Статус регистрации",
      "Пришел",
      "Оплатил",
      "Нал/карта",
      "Беспл. re-entry",
      "Re-buy",
      "Addon",
      "Nok",
      "Место",
      "Рейтинг",
      "Выбыл",
      "Время выбытия",
    ]);
    expect(layout).toMatchObject({ knockoutsIndex: 11, placeIndex: 12, ratingIndex: 13, eliminatedIndex: 14, eliminatedAtIndex: 15 });
    for (const type of ["classic", "boss_bounty", "mystery_bounty"] as const) {
      const headers = getFreeSheetColumnLayout(type).headers.join("|").toLowerCase();
      expect(headers).not.toContain("не пришёл");
      expect(headers).not.toContain("не пришел");
      expect(headers).not.toContain("допустить");
      expect(headers).not.toContain("огранич");
    }
  });
});

describe("registration status stays ReRaise-owned (one-directional)", () => {
  it("SAFETY: a waitlisted row with Пришел=TRUE (and an operator-typed 'registered' status) is never applied to Postgres", async () => {
    // Only p1 is registered; w1 is waitlisted in ReRaise.
    mocks.getTournamentResultsDraft.mockResolvedValue([
      { player_id: "p1", display_name: "P1", username: "p1", status: "registered" },
    ]);
    mocks.getTournamentSheetExportData.mockResolvedValue({
      tournament: tournament(),
      rows: [
        { player_id: "p1", username: "p1", display_name: "P1", registration_status: "registered", rating_points: null },
        { player_id: "w1", username: "w1", display_name: "W1", registration_status: "waitlist", rating_points: null },
      ],
    });
    mocks.readSpreadsheetTabValues.mockResolvedValue(
      sheetValues([row("p1", "registered", "false"), row("w1", "registered", "true")])
    );

    await reconcileTournamentFromSheet("t1");

    expect(mocks.setTournamentPlayerAttendance).not.toHaveBeenCalledWith("t1", "w1", expect.anything());
    expect(mocks.setTournamentPlayerElimination).not.toHaveBeenCalledWith("t1", "w1", expect.anything());
    // ReRaise overwrites the status cell with its own value instead of
    // reading the sheet's edit back.
    expect(allWrites()).toContainEqual({ range: "Sheet1!B9:E9", values: [["w1", "W1", "@w1", "waitlist"]] });
  });

  it("after a no-show, the next roster sync rewrites Статус регистрации to waitlist (identity/status cells only)", async () => {
    mocks.getTournamentResultsDraft.mockResolvedValue([]);
    mocks.getTournamentSheetExportData.mockResolvedValue({
      tournament: tournament(),
      rows: [{ player_id: "p1", username: "p1", display_name: "P1", registration_status: "waitlist", rating_points: null }],
    });
    mocks.readSpreadsheetTabValues.mockResolvedValue(sheetValues([row("p1", "registered", "false")]));

    await reconcileTournamentFromSheet("t1");

    expect(allWrites()).toEqual([{ range: "Sheet1!B8:E8", values: [["p1", "P1", "@p1", "waitlist"]] }]);
  });
});

describe("syncAdmittedPlayerToSheet -- 'Допустить в игру' mirrored into the sheet", () => {
  beforeEach(() => {
    mocks.getTournamentResultsDraft.mockResolvedValue([
      { player_id: "a", display_name: "A", username: "a", status: "registered" },
    ]);
    mocks.getTournamentAttendance.mockResolvedValue(new Map([["a", { arrived: true, arrived_at: null }]]));
    mocks.getTournamentSheetExportData.mockResolvedValue({
      tournament: tournament(),
      rows: [{ player_id: "a", username: "a", display_name: "A", registration_status: "registered", rating_points: null }],
    });
  });

  it("writes Статус регистрации = registered AND Пришел = TRUE for the admitted player's row", async () => {
    mocks.readSpreadsheetTabValues.mockResolvedValue(sheetValues([row("a", "waitlist", "false")]));

    const result = await syncAdmittedPlayerToSheet("t1", "a");

    expect(result).toEqual({ arrivedWritten: true });
    expect(allWrites()).toEqual([
      { range: "Sheet1!B8:E8", values: [["a", "A", "@a", "registered"]] },
      { range: "Sheet1!F8", values: [[true]] },
    ]);
  });

  it("a missing sheet row is appended by the roster sync, then Пришел is set on the appended row", async () => {
    mocks.readSpreadsheetTabValues
      .mockResolvedValueOnce(sheetValues([]))
      .mockResolvedValueOnce(sheetValues([row("a", "registered", "false")]));

    const result = await syncAdmittedPlayerToSheet("t1", "a");

    expect(result).toEqual({ arrivedWritten: true });
    expect(allWrites().at(-1)).toEqual({ range: "Sheet1!F8", values: [[true]] });
  });

  it("writes nothing when Postgres does not say the player is an arrived seat-holder (derived, never trusted input)", async () => {
    mocks.getTournamentAttendance.mockResolvedValue(new Map());
    mocks.readSpreadsheetTabValues.mockResolvedValue(sheetValues([row("a", "waitlist", "false")]));

    await expect(syncAdmittedPlayerToSheet("t1", "a")).resolves.toEqual({ arrivedWritten: false });
    expect(mocks.batchUpdateSpreadsheetValues).not.toHaveBeenCalled();
  });

  it("no linked sheet / completed tournament => no sheet access at all", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ google_sheet_tab_name: null }));
    await expect(syncAdmittedPlayerToSheet("t1", "a")).resolves.toEqual({ arrivedWritten: false });
    mocks.getTournamentById.mockResolvedValue(tournament({ status: "completed" }));
    await expect(syncAdmittedPlayerToSheet("t1", "a")).resolves.toEqual({ arrivedWritten: false });
    expect(mocks.readSpreadsheetTabValues).not.toHaveBeenCalled();
  });
});

describe("Google Sheets README -- operational ownership copy", () => {
  const required = [
    "Состав турнира и лист ожидания управляются в ReRaise.",
    "Кнопки «Не пришёл» и «Допустить в игру» находятся в приложении.",
    "Google Таблица используется для ведения уже допущенных игроков.",
    "Если игрок находится в листе ожидания и пришёл в клуб, сначала нажмите «Допустить в игру» в ReRaise. Не переводите его вручную через таблицу.",
  ];

  it.each([
    ["free/rating export", buildFreeTournamentReadmeSheetValues],
    ["paid/cash live export", buildLiveTournamentReadmeSheetValues],
  ])("%s README includes the concise instructions (and keeps its existing lines)", (_name, build) => {
    const lines = build().map((cells) => cells.join(" "));
    for (const text of required) expect(lines).toContain(text);
    expect(lines.length).toBeLessThan(30);
  });

  it("the free README keeps every pre-existing line, in order, at the top", () => {
    expect(buildFreeTournamentReadmeSheetValues().slice(0, 12)).toEqual([
      ["README - Google Sheets для турнирного администратора"],
      [],
      ["Что делает этот файл"],
      ["В этой таблице администратор на площадке заполняет игровые данные и итоговые места участников турнира."],
      [],
      ["Какие листы в таблице"],
      ["README - инструкция"],
      ["Листы турниров - рабочие таблицы по каждому турниру"],
      [],
      ["Важно"],
      ["Не удаляйте строки и не меняйте Player ID"],
      ["Повторная выгрузка того же турнира обновляет тот же лист, а не создает новый."],
    ]);
  });
});
