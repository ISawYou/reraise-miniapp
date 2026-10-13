import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres, { type Sql } from "postgres";

// No-show QUARANTINE + operational Google Sheet roster + completion safety,
// against a REAL PostgreSQL database (real row locks, real repositories,
// real complete-free route) and a STATEFUL fake Google Sheet (an in-memory
// tab that really applies value writes by A1 range and really deletes rows
// in the order it is given -- so a wrong deletion order or a stale row
// number would corrupt it and fail the assertions). LOCAL TEST DATA ONLY:
// no real Google Sheet, Telegram or Poker Clock is ever touched.
//
//   NO_SHOW_POSTGRES_TEST_URL=postgres://user@127.0.0.1:5432/reraise_noshow_test \
//     npx vitest run features/__tests__/no-show-quarantine.postgres.integration.test.ts
const TEST_DATABASE_URL = process.env.NO_SHOW_POSTGRES_TEST_URL;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;

function assertSafeTestDatabaseUrl(value: string): void {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.includes("test")) {
    throw new Error("No-show integration tests require a localhost test database");
  }
}

type Cell = string | number | boolean | null;

const sheet = vi.hoisted(() => ({
  values: [] as string[][],
  deleteCalls: [] as number[][],
  failDelete: false,
  failRead: false,
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

function applyRangeWrite(range: string, rows: Cell[][]) {
  const match = /^(.*)!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(range);
  if (!match) throw new Error(`fake sheet: bad range ${range}`);
  const startCol = columnIndex(match[2]);
  const startRow = Number(match[3]);
  rows.forEach((cells, r) => {
    const index = startRow - 1 + r;
    while (sheet.values.length <= index) sheet.values.push([]);
    const target = sheet.values[index];
    cells.forEach((value, c) => {
      while (target.length <= startCol + c) target.push("");
      target[startCol + c] = cellText(value);
    });
  });
}

const mocks = vi.hoisted(() => ({
  send: vi.fn(async () => true),
  assertServerActorRole: vi.fn(async () => ({ id: "staff", role: "operator" })),
  finishPokerClockTournament: vi.fn(async () => ({ status: "not_linked" })),
}));

vi.mock("@/lib/telegram-bot-notify", () => ({
  sendTournamentPromotionTelegramNotification: mocks.send,
  sendTeamsTelegramNotification: vi.fn(),
}));
vi.mock("@/lib/google-sheets", () => ({
  readSpreadsheetTabValues: vi.fn(async () => {
    if (sheet.failRead) throw new Error("fake sheet read failure");
    return sheet.values.map((row) => [...row]);
  }),
  batchUpdateSpreadsheetValues: vi.fn(async (updates: { range: string; values: Cell[][] }[]) => {
    for (const update of updates) applyRangeWrite(update.range, update.values);
  }),
  deleteSpreadsheetTabRows: vi.fn(async (_tab: string, rowNumbers: number[], minRowNumber: number) => {
    if (sheet.failDelete) throw new Error("fake sheet delete failure");
    sheet.deleteCalls.push([...rowNumbers]);
    // Applied strictly in the given order, exactly like Sheets applies the
    // requests of one batchUpdate sequentially.
    for (const rowNumber of rowNumbers) {
      if (rowNumber < minRowNumber) throw new Error("fake sheet: protected row");
      sheet.values.splice(rowNumber - 1, 1);
    }
    return rowNumbers;
  }),
  applyNewRosterRowsFormatting: vi.fn(async () => undefined),
  ensureReadmeTab: vi.fn(async () => undefined),
  ensureSpreadsheetTab: vi.fn(async () => ({ created: false, sheetId: 1 })),
  appendReportRow: vi.fn(async () => undefined),
  applyTournamentSheetFormatting: vi.fn(async () => undefined),
  buildSpreadsheetTabUrl: vi.fn(() => "https://example.invalid/sheet"),
  replaceSpreadsheetTabValues: vi.fn(async (tab: string, values: Cell[][]) => {
    if (tab === "README") return;
    sheet.values = values.map((row) => row.map(cellText));
  }),
}));
vi.mock("@/lib/admin-auth", () => ({
  assertServerActorRole: mocks.assertServerActorRole,
  resolveCurrentServerActor: vi.fn(async () => null),
}));
vi.mock("@/lib/poker-clock-client", () => ({
  finishPokerClockTournament: mocks.finishPokerClockTournament,
}));
vi.mock("@/features/achievements", () => ({ syncPlayersAchievementsIfEnabled: vi.fn() }));
vi.mock("@/features/club-activity", () => ({ publishTournamentWinnerEvent: vi.fn() }));

const T1 = "96000000-0000-4000-8000-0000000000b1";
const T2 = "96000000-0000-4000-8000-0000000000b2";
const T3 = "96000000-0000-4000-8000-0000000000b3";
const PLAYER_PREFIX = "96000000-0000-4000-8000-0000000";
const TAB = "QA tab";

function pid(n: number): string {
  return `${PLAYER_PREFIX}${String(n).padStart(5, "0")}`;
}

describePostgres("No-show quarantine, operational sheet roster, completion safety (PostgreSQL)", () => {
  let client: Sql;
  let capacity: typeof import("@/features/tournament-waitlist-capacity");
  let tournaments: typeof import("@/features/tournaments");
  let sheetSync: typeof import("@/features/tournament-sheet-sync");
  let noShow: typeof import("@/features/tournament-no-show");
  let rosterActions: typeof import("@/features/tournament-roster-actions");
  let noShowAdmin: typeof import("@/features/no-show-admin-actions");
  let layout: typeof import("@/lib/tournament-sheet-parsing");
  let rating: typeof import("@/features/rating-v2");
  let completeFree: typeof import("@/app/api/admin/tournaments/[id]/complete-free/route");

  async function resetRows() {
    await client`DELETE FROM tournaments WHERE id IN (${T1}::uuid, ${T2}::uuid, ${T3}::uuid)`;
    await client`DELETE FROM players WHERE id::text LIKE ${PLAYER_PREFIX + "%"}`;
  }

  async function createTournament(
    id: string,
    opts: { maxPlayers?: number; startAt?: Date; tab?: string | null; isFinal?: boolean } = {}
  ) {
    await client`
      INSERT INTO tournaments (id, title, start_at, max_players, status, kind, google_sheet_tab_name, is_final)
      VALUES (${id}::uuid, 'Quarantine Cup', ${opts.startAt ?? new Date(Date.now() - 3600_000)},
              ${opts.maxPlayers ?? 40}, 'open', 'free', ${opts.tab === undefined ? TAB : opts.tab},
              ${opts.isFinal ?? false})
    `;
  }

  async function createPlayers(from: number, to: number, opts: { restricted?: boolean } = {}) {
    for (let n = from; n <= to; n++) {
      await client`
        INSERT INTO players (id, display_name, online_registration_restricted_at)
        VALUES (${pid(n)}::uuid, ${"Player " + n}, ${opts.restricted ? new Date() : null})
      `;
    }
  }

  // created_at strictly increasing with n so FIFO is deterministic.
  async function register(tournamentId: string, n: number, status: string) {
    const [row] = await client`
      INSERT INTO registrations (player_id, tournament_id, status, created_at)
      VALUES (${pid(n)}::uuid, ${tournamentId}::uuid, ${status},
              ${new Date(Date.parse("2026-01-01T00:00:00Z") + n * 1000)})
      RETURNING id
    `;
    return row.id as string;
  }

  async function regOf(tournamentId: string, n: number) {
    const [row] = await client`
      SELECT id, status, no_show_at FROM registrations
      WHERE tournament_id = ${tournamentId}::uuid AND player_id = ${pid(n)}::uuid
    `;
    return row as { id: string; status: string; no_show_at: Date | null } | undefined;
  }

  async function seatLoad(tournamentId: string): Promise<number> {
    const [row] = await client`
      SELECT count(*)::int AS n FROM registrations r
      WHERE r.tournament_id = ${tournamentId}::uuid AND r.status IN ('registered','attended')
        AND NOT EXISTS (SELECT 1 FROM tournament_player_eliminations e
                        WHERE e.tournament_id = r.tournament_id AND e.player_id = r.player_id AND e.eliminated)
    `;
    return row.n as number;
  }

  async function restricted(n: number): Promise<boolean> {
    const [row] = await client`SELECT online_registration_restricted_at FROM players WHERE id = ${pid(n)}::uuid`;
    return row.online_registration_restricted_at != null;
  }

  async function eliminateDirect(tournamentId: string, n: number) {
    await client`INSERT INTO tournament_player_eliminations (tournament_id, player_id, eliminated, eliminated_at)
                 VALUES (${tournamentId}::uuid, ${pid(n)}::uuid, true, now())`;
  }

  async function allNoShowHistory() {
    return client`SELECT id, no_show_at FROM registrations
                  WHERE player_id::text LIKE ${PLAYER_PREFIX + "%"} AND no_show_at IS NOT NULL ORDER BY id`;
  }

  function headers(): string[] {
    return layout.getFreeSheetColumnLayout("classic").headers;
  }

  type SheetPlayer = {
    n: number;
    status?: string;
    arrived?: boolean;
    rebuys?: number;
    knockouts?: number;
    place?: number | null;
  };

  // A real-shaped classic tab: 6 meta rows, header at row 7, data from 8.
  function seedSheet(players: SheetPlayer[]) {
    const h = headers();
    const meta: string[][] = [["Tournament ID", T1], [], [], [], [], []];
    sheet.values = [
      ...meta,
      [...h],
      ...players.map((p) => {
        const cells = h.map(() => "");
        cells[0] = pid(p.n);
        cells[2] = `Player ${p.n}`;
        cells[4] = p.status ?? "registered";
        cells[5] = p.arrived ? "TRUE" : "FALSE";
        cells[6] = "FALSE";
        cells[8] = "0";
        cells[9] = String(p.rebuys ?? 0);
        cells[10] = "0";
        cells[11] = String(p.knockouts ?? 0);
        cells[12] = p.place == null ? "" : String(p.place);
        cells[14] = "FALSE";
        return cells;
      }),
    ];
  }

  function sheetPlayerIds(): string[] {
    return sheet.values.slice(7).map((row) => row[0]).filter((id) => !!id);
  }

  function sheetRowOf(n: number): string[] | undefined {
    return sheet.values.slice(7).find((row) => row[0] === pid(n));
  }

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(TEST_DATABASE_URL!);
    process.env.DATABASE_PROVIDER = "postgres";
    process.env.DATABASE_URL = TEST_DATABASE_URL!;
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "integration-test-dummy";
    client = postgres(TEST_DATABASE_URL!, { max: 5 });
    capacity = await import("@/features/tournament-waitlist-capacity");
    tournaments = await import("@/features/tournaments");
    sheetSync = await import("@/features/tournament-sheet-sync");
    noShow = await import("@/features/tournament-no-show");
    rosterActions = await import("@/features/tournament-roster-actions");
    noShowAdmin = await import("@/features/no-show-admin-actions");
    layout = await import("@/lib/tournament-sheet-parsing");
    rating = await import("@/features/rating-v2");
    completeFree = await import("@/app/api/admin/tournaments/[id]/complete-free/route");
    await resetRows();
  });

  beforeEach(() => {
    mocks.send.mockReset();
    mocks.send.mockResolvedValue(true);
    sheet.values = [];
    sheet.deleteCalls = [];
    sheet.failDelete = false;
    sheet.failRead = false;
  });

  afterEach(async () => {
    await resetRows();
  });

  afterAll(async () => {
    if (!client) return;
    await client.end();
  });

  // -------------------------------------------------------------------------
  // Waitlist eligibility (spec TESTS -- WAITLIST 1-4, 7)
  // -------------------------------------------------------------------------

  it("ordinary waitlist (no_show_at NULL) auto-promotes; a quarantined no-show never does -- even after its global restriction is lifted; the player behind it still promotes; FIFO kept; capacity never exceeded", async () => {
    await createTournament(T1, { maxPlayers: 3, tab: null });
    await createPlayers(1, 6);
    for (let n = 1; n <= 3; n++) await register(T1, n, "registered");
    const quarantined = await register(T1, 4, "waitlist");
    await register(T1, 5, "waitlist");
    await register(T1, 6, "waitlist");
    // Player 4 is OLDEST in the queue but carries THIS tournament's no-show
    // mark -- and NO global restriction at all (as if staff already lifted it).
    await client`UPDATE registrations SET no_show_at = now() WHERE id = ${quarantined}::uuid`;
    expect(await restricted(4)).toBe(false);

    await eliminateDirect(T1, 1);
    const first = await capacity.reconcileTournamentWaitlistCapacity(T1);
    expect(first.promotedPlayerIds).toEqual([pid(5)]);
    expect((await regOf(T1, 4))?.status).toBe("waitlist");

    await eliminateDirect(T1, 2);
    const second = await capacity.reconcileTournamentWaitlistCapacity(T1);
    expect(second.promotedPlayerIds).toEqual([pid(6)]);
    expect((await regOf(T1, 4))?.status).toBe("waitlist");
    expect((await regOf(T1, 4))?.no_show_at).not.toBeNull();

    // A free seat with only the quarantined row waiting: still nobody.
    await eliminateDirect(T1, 3);
    const third = await capacity.reconcileTournamentWaitlistCapacity(T1);
    expect(third.promotedPlayerIds).toEqual([]);
    expect((await regOf(T1, 4))?.status).toBe("waitlist");
    expect(await seatLoad(T1)).toBeLessThanOrEqual(3);
  });

  it("a newcomer is not blocked by a quarantined no-show row ahead of them (it is not an eligible waiter)", async () => {
    await createTournament(T1, { maxPlayers: 2, tab: null });
    await createPlayers(1, 3);
    await register(T1, 1, "registered");
    const quarantined = await register(T1, 2, "waitlist");
    await client`UPDATE registrations SET no_show_at = now() WHERE id = ${quarantined}::uuid`;

    const result = await capacity.admitPlayerToTournament(T1, pid(3));

    expect(result.status).toBe("registered");
    expect((await regOf(T1, 2))?.status).toBe("waitlist");
    expect(await seatLoad(T1)).toBe(2);
  });

  it("cancel + re-register cannot bypass quarantine: a cancelled no-show row reactivates as waitlist with its history kept, even unrestricted with free seats", async () => {
    await createTournament(T1, { maxPlayers: 5, tab: null });
    await createPlayers(1, 2);
    await register(T1, 1, "registered");
    const reg = await register(T1, 2, "registered");
    await capacity.markRegistrationNoShowWithinCapacity(T1, reg);
    await noShow.clearPlayerOnlineRegistrationRestriction(pid(2));
    await client`UPDATE registrations SET status = 'cancelled' WHERE id = ${reg}::uuid`;

    const again = await capacity.admitPlayerToTournament(T1, pid(2));

    expect(again.status).toBe("waitlist");
    const row = await regOf(T1, 2);
    expect(row?.status).toBe("waitlist");
    expect(row?.no_show_at).not.toBeNull();
    expect((await capacity.reconcileTournamentWaitlistCapacity(T1)).promotedPlayerIds).toEqual([]);
  });

  it("concurrent no-shows + reconciles + admissions with quarantined rows never exceed max_players and never auto-promote a no-show", async () => {
    await createTournament(T1, { maxPlayers: 20, tab: null });
    await createPlayers(1, 30);
    for (let n = 1; n <= 20; n++) await register(T1, n, "registered");
    for (let n = 21; n <= 30; n++) await register(T1, n, "waitlist");
    const regs = await client`SELECT id FROM registrations WHERE tournament_id = ${T1}::uuid AND status = 'registered' ORDER BY created_at`;

    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < 5; i++) ops.push(capacity.markRegistrationNoShowWithinCapacity(T1, regs[i].id));
    for (let i = 0; i < 8; i++) ops.push(capacity.reconcileTournamentWaitlistCapacity(T1));
    for (let i = 0; i < 4; i++) ops.push(noShow.clearPlayerOnlineRegistrationRestriction(pid(i + 1)));
    await Promise.allSettled(ops);
    await capacity.reconcileTournamentWaitlistCapacity(T1);

    expect(await seatLoad(T1)).toBe(20);
    for (let i = 0; i < 5; i++) {
      const [row] = await client`SELECT status, no_show_at FROM registrations WHERE id = ${regs[i].id}::uuid`;
      expect(row.status).toBe("waitlist");
      expect(row.no_show_at).not.toBeNull();
    }
  });

  // -------------------------------------------------------------------------
  // Manual QA Scenario A: 30/30 + 5 waitlist, "Не пришёл" via the real action
  // -------------------------------------------------------------------------

  it("Scenario A: no-show moves to 'Не пришли' (not the waitlist), next eligible promotes, the sheet drops the no-show row (+ a stale legacy waitlist row) and appends the promoted player, remaining operational values untouched; the no-show can't auto-promote back", async () => {
    await createTournament(T1, { maxPlayers: 30 });
    await createPlayers(1, 35);
    const regs = new Map<number, string>();
    for (let n = 1; n <= 30; n++) regs.set(n, await register(T1, n, "registered"));
    for (let n = 31; n <= 35; n++) regs.set(n, await register(T1, n, "waitlist"));
    // Live sheet: the 30 registered rows (operational values on #2 and
    // #29) PLUS a stale legacy waitlist row (#33) from the old export.
    seedSheet([
      ...Array.from({ length: 30 }, (_, i) => ({
        n: i + 1,
        arrived: i + 1 !== 5,
        rebuys: i + 1 === 2 ? 3 : i + 1 === 29 ? 2 : 0,
        knockouts: i + 1 === 29 ? 4 : 0,
      })),
      { n: 33, status: "waitlist" },
    ]);
    const headerBefore = [...sheet.values[6]];
    const metaBefore = sheet.values.slice(0, 6).map((row) => [...row]);
    await client`INSERT INTO tournament_attendance (tournament_id, player_id, arrived, arrived_at)
                 SELECT ${T1}::uuid, player_id, true, now() FROM registrations
                 WHERE tournament_id = ${T1}::uuid AND status = 'registered' AND player_id <> ${pid(5)}::uuid`;

    const result = await rosterActions.markTournamentPlayerNoShow(T1, regs.get(5)!);

    expect(result).toEqual({ ok: true, promotedCount: 1 });
    expect((await regOf(T1, 5))?.status).toBe("waitlist");
    expect((await regOf(T1, 5))?.no_show_at).not.toBeNull();
    expect((await regOf(T1, 31))?.status).toBe("registered");
    expect(await seatLoad(T1)).toBe(30);

    // Admin sections: 5 is under "Не пришли", NOT in the normal waitlist.
    const participants = await tournaments.getAdminTournamentParticipants(T1);
    const noShows = participants.filter((p) => p.status === "waitlist" && p.no_show_at != null);
    const waitlist = participants.filter((p) => p.status === "waitlist" && p.no_show_at == null);
    expect(noShows.map((p) => p.player_id)).toEqual([pid(5)]);
    expect(waitlist.map((p) => p.player_id)).toEqual([pid(32), pid(33), pid(34), pid(35)]);
    expect(noShows[0]).toMatchObject({ no_show_count: 1, online_registration_restricted: true });

    // Public roster: the no-show is not shown as a waiting player; the
    // ordinary waitlist is.
    const publicRoster = await tournaments.getTournamentParticipants(T1);
    expect(publicRoster.some((p) => p.player_id === pid(5))).toBe(false);
    expect(publicRoster.filter((p) => p.status === "waitlist").map((p) => p.player_id)).toEqual([
      pid(32),
      pid(33),
      pid(34),
      pid(35),
    ]);

    // Operational export: registered/attended only.
    const exportData = await tournaments.getTournamentSheetExportData(T1);
    expect(exportData.rows).toHaveLength(30);
    expect(exportData.rows.every((row) => row.registration_status === "registered")).toBe(true);

    // Sheet: header/meta intact; #5 and the stale #33 removed by exact id,
    // in one DESCENDING delete; #31 appended as registered.
    expect(sheet.values[6]).toEqual(headerBefore);
    expect(sheet.values.slice(0, 6)).toEqual(metaBefore);
    expect(sheet.deleteCalls).toEqual([[38, 12]]);
    const ids = sheetPlayerIds();
    expect(ids).not.toContain(pid(5));
    expect(ids).not.toContain(pid(33));
    expect(ids).toContain(pid(31));
    expect(new Set(ids)).toEqual(new Set(exportData.rows.map((row) => row.player_id)));
    expect(sheetRowOf(31)?.[4]).toBe("registered");
    // Remaining players' operational cells were not clobbered by the shift.
    expect(sheetRowOf(2)?.slice(5, 12)).toEqual(["TRUE", "FALSE", "", "0", "3", "0", "0"]);
    expect(sheetRowOf(29)?.slice(9, 12)).toEqual(["2", "0", "4"]);
    expect(sheetRowOf(6)?.[5]).toBe("TRUE");

    // The poller pass afterwards is a stable no-op for the roster.
    sheet.deleteCalls = [];
    await sheetSync.reconcileTournamentFromSheet(T1);
    expect(sheet.deleteCalls).toEqual([]);
    expect(new Set(sheetPlayerIds())).toEqual(new Set(exportData.rows.map((row) => row.player_id)));

    // A freed seat goes to the next ELIGIBLE player (#32), never back to #5
    // even though #5's created_at is older.
    await eliminateDirect(T1, 1);
    const reconciliation = await capacity.reconcileTournamentWaitlistCapacity(T1);
    expect(reconciliation.promotedPlayerIds).toEqual([pid(32)]);
    expect((await regOf(T1, 5))?.status).toBe("waitlist");
  });

  it("'Не пришёл' keeps the DB no-show when the immediate sheet cleanup fails, returns a warning, and the next reconciler pass self-heals", async () => {
    await createTournament(T1, { maxPlayers: 3 });
    await createPlayers(1, 3);
    await register(T1, 1, "registered");
    const reg = await register(T1, 2, "registered");
    await register(T1, 3, "registered");
    seedSheet([{ n: 1, arrived: true }, { n: 2 }, { n: 3, arrived: true, rebuys: 2 }]);
    sheet.failDelete = true;

    const result = await rosterActions.markTournamentPlayerNoShow(T1, reg);

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ warning: expect.stringContaining("Google Таблицу обновить не удалось") });
    expect((await regOf(T1, 2))?.status).toBe("waitlist");
    expect((await regOf(T1, 2))?.no_show_at).not.toBeNull();
    expect(sheetPlayerIds()).toContain(pid(2));

    sheet.failDelete = false;
    await sheetSync.reconcileTournamentFromSheet(T1);
    expect(sheetPlayerIds()).toEqual([pid(1), pid(3)]);
    expect(sheetRowOf(3)?.[9]).toBe("2");
  });

  // -------------------------------------------------------------------------
  // Manual QA Scenario B: global "Неявки игроков" + "Разрешить обычную запись"
  // -------------------------------------------------------------------------

  it("Scenario B: the global list derives count/last date/restriction in one query; unblocking clears ONLY the restriction -- history, results and current quarantine untouched; a future tournament takes a normal seat", async () => {
    await createTournament(T1, { maxPlayers: 2, tab: null });
    await createTournament(T2, { maxPlayers: 10, tab: null });
    await createTournament(T3, { maxPlayers: 10, tab: null, startAt: new Date(Date.now() + 86_400_000) });
    await createPlayers(1, 4);
    const older = await register(T2, 1, "waitlist");
    await client`UPDATE registrations SET no_show_at = '2026-01-05T19:00:00Z' WHERE id = ${older}::uuid`;
    const reg = await register(T1, 1, "registered");
    await register(T1, 2, "registered");
    await register(T1, 3, "waitlist");
    await capacity.markRegistrationNoShowWithinCapacity(T1, reg);
    expect((await regOf(T1, 3))?.status).toBe("registered");

    const before = await noShowAdmin.getAdminNoShowPlayers();
    const mine = before.filter((p) => p.player_id.startsWith(PLAYER_PREFIX));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      player_id: pid(1),
      nickname: "Player 1",
      no_show_count: 2,
      online_registration_restricted: true,
    });
    expect(mine[0].last_no_show_at).not.toBeNull();
    expect(new Date(mine[0].last_no_show_at!).getTime()).toBeGreaterThan(Date.parse("2026-01-05T19:00:00Z"));
    // No unnecessary PII on the wire.
    expect(Object.keys(mine[0]).sort()).toEqual([
      "custom_avatar_url",
      "last_no_show_at",
      "no_show_count",
      "nickname",
      "online_registration_restricted",
      "player_id",
      "telegram_avatar_url",
    ].sort());

    const historyBefore = await allNoShowHistory();
    const resultsBefore = await client`SELECT count(*)::int AS n FROM results WHERE player_id = ${pid(1)}::uuid`;

    const unblock = await noShowAdmin.allowPlayerOrdinaryRegistration(pid(1));

    expect(unblock).toEqual({ ok: true, cleared: true });
    expect(await restricted(1)).toBe(false);
    expect(await allNoShowHistory()).toEqual(historyBefore);
    const resultsAfter = await client`SELECT count(*)::int AS n FROM results WHERE player_id = ${pid(1)}::uuid`;
    expect(resultsAfter[0].n).toBe(resultsBefore[0].n);
    const after = (await noShowAdmin.getAdminNoShowPlayers()).find((p) => p.player_id === pid(1));
    expect(after).toMatchObject({ no_show_count: 2, online_registration_restricted: false });

    // Current-tournament no-show stays quarantined after the global unblock.
    await eliminateDirect(T1, 2);
    expect((await capacity.reconcileTournamentWaitlistCapacity(T1)).promotedPlayerIds).toEqual([]);
    expect((await regOf(T1, 1))?.status).toBe("waitlist");
    expect((await regOf(T1, 1))?.no_show_at).not.toBeNull();

    // Future registration takes a normal seat again.
    const future = await tournaments.registerPlayerForTournament(pid(1), T3);
    expect(future.status).toBe("registered");
    expect(future).not.toHaveProperty("online_registration_restricted");
  });

  it("'Удалить' on a no-show row keeps its no_show_at history (cancels instead of deleting); a plain row is still deleted", async () => {
    await createTournament(T1, { maxPlayers: 5, tab: null });
    await createPlayers(1, 2);
    const noShowReg = await register(T1, 1, "registered");
    const plain = await register(T1, 2, "waitlist");
    await capacity.markRegistrationNoShowWithinCapacity(T1, noShowReg);

    await tournaments.removeAdminTournamentParticipant(noShowReg);
    await tournaments.removeAdminTournamentParticipant(plain);

    const row = await regOf(T1, 1);
    expect(row?.status).toBe("cancelled");
    expect(row?.no_show_at).not.toBeNull();
    expect(await regOf(T1, 2)).toBeUndefined();
    const summary = (await noShow.listNoShowPlayerSummaries()).find((p) => p.player_id === pid(1));
    expect(summary?.no_show_count).toBe(1);
    const admin = await tournaments.getAdminTournamentParticipants(T1);
    expect(admin).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Manual QA Scenario C: the same no-show arrives -> "Допустить в игру"
  // -------------------------------------------------------------------------

  it("Scenario C: admitting the no-show (seat free, Late Reg open) -> registered, arrived, THIS no_show_at cleared, restriction cleared, back in the sheet with Пришел TRUE, capacity respected", async () => {
    await createTournament(T1, { maxPlayers: 3 });
    await createPlayers(1, 4);
    await register(T1, 1, "registered");
    await register(T1, 2, "registered");
    const reg = await register(T1, 3, "registered");
    seedSheet([{ n: 1, arrived: true }, { n: 2, arrived: true, rebuys: 1 }, { n: 3 }]);

    await rosterActions.markTournamentPlayerNoShow(T1, reg);
    expect(sheetPlayerIds()).toEqual([pid(1), pid(2)]);
    expect(await restricted(3)).toBe(true);

    const admitted = await rosterActions.admitTournamentPlayerFromWaitlist(T1, reg);

    expect(admitted).toEqual({ ok: true, promotedCount: 0 });
    const row = await regOf(T1, 3);
    expect(row?.status).toBe("registered");
    expect(row?.no_show_at).toBeNull();
    expect(await restricted(3)).toBe(false);
    const [att] = await client`SELECT arrived FROM tournament_attendance WHERE tournament_id = ${T1}::uuid AND player_id = ${pid(3)}::uuid`;
    expect(att.arrived).toBe(true);
    expect(sheetPlayerIds()).toEqual([pid(1), pid(2), pid(3)]);
    expect(sheetRowOf(3)?.[4]).toBe("registered");
    expect(sheetRowOf(3)?.[5]).toBe("TRUE");
    expect(sheetRowOf(2)?.[9]).toBe("1");
    expect(await seatLoad(T1)).toBe(3);

    // Full table: a second no-show's admission is refused, nothing changes.
    await register(T1, 4, "waitlist");
    const fourth = await regOf(T1, 4);
    await client`UPDATE registrations SET no_show_at = now() WHERE id = ${fourth!.id}::uuid`;
    const refused = await rosterActions.admitTournamentPlayerFromWaitlist(T1, fourth!.id);
    expect(refused).toEqual({ ok: false, error: capacity.ADMISSION_NO_SEAT_MESSAGE });
    expect((await regOf(T1, 4))?.no_show_at).not.toBeNull();
    expect(await seatLoad(T1)).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Manual QA Scenario D: completion with a stale sheet (CRITICAL)
  // -------------------------------------------------------------------------

  async function setupCompletionScenario() {
    await createTournament(T1, { maxPlayers: 5 });
    await createPlayers(1, 7);
    for (let n = 1; n <= 5; n++) await register(T1, n, "registered");
    await register(T1, 6, "waitlist");
    await register(T1, 7, "waitlist");
    // #5 no-show -> quarantined; #6 auto-promoted; #7 stays ordinary waitlist.
    await capacity.markRegistrationNoShowWithinCapacity(T1, (await regOf(T1, 5))!.id);
    expect((await regOf(T1, 6))?.status).toBe("registered");
    expect((await regOf(T1, 7))?.status).toBe("waitlist");

    // Stale sheet (as if the cleanup failed transiently): it still has the
    // no-show (#5) and ordinary-waitlist (#7) rows with BLANK places.
    seedSheet([
      { n: 1, arrived: true, place: 1, knockouts: 3, rebuys: 2 },
      { n: 2, arrived: true, place: 2, knockouts: 1, rebuys: 1 },
      { n: 3, arrived: true, place: 3, rebuys: 1 },
      { n: 4, arrived: true, place: 4, rebuys: 1 },
      { n: 5, status: "waitlist", place: null },
      { n: 6, arrived: true, place: 5, rebuys: 1 },
      { n: 7, status: "waitlist", place: null, knockouts: 9 },
    ]);
  }

  function submittedRow(n: number, place: number) {
    return {
      player_id: pid(n),
      display_name: `Player ${n}`,
      arrived: true,
      rebuys: 1,
      addons: 0,
      knockouts: 0,
      place,
    };
  }

  async function postComplete(rows: unknown[]) {
    const response = await completeFree.POST(
      new Request(`http://localhost/api/admin/tournaments/${T1}/complete-free`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      }),
      { params: Promise.resolve({ id: T1 }) }
    );
    return { status: response.status, body: await response.json() };
  }

  it("Scenario D: completion succeeds using ONLY the canonical registered/attended roster -- stale waitlist/no-show rows (sheet AND submitted) never need places, never create results, never affect rating or field size", async () => {
    await setupCompletionScenario();

    // The stale client also submits the no-show/waitlist rows with place 0
    // (Number("")), exactly like the production screenshot.
    const response = await postComplete([
      submittedRow(1, 1),
      submittedRow(2, 2),
      submittedRow(3, 3),
      submittedRow(4, 4),
      submittedRow(5, 0),
      submittedRow(6, 5),
      submittedRow(7, 0),
    ]);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, completedCount: 5 });

    const [t] = await client`SELECT status FROM tournaments WHERE id = ${T1}::uuid`;
    expect(t.status).toBe("completed");
    const results = await client`
      SELECT player_id, place, knockouts, reentries, rating_points, arrived
      FROM results WHERE tournament_id = ${T1}::uuid ORDER BY place`;
    expect(results.map((r) => r.player_id)).toEqual([pid(1), pid(2), pid(3), pid(4), pid(6)]);
    expect(results.map((r) => r.place)).toEqual([1, 2, 3, 4, 5]);
    // Sheet KO/places for canonical players are used.
    expect(results[0].knockouts).toBe(3);

    // Rating equals a control calculation over the 5 canonical players only
    // (stale #5/#7 neither enter the formula nor grow the field).
    const tournament = await tournaments.getTournamentById(T1);
    const control = rating.calculateRatingPointsForTournament(
      results.map((r) => ({
        player_id: r.player_id as string,
        place: r.place as number,
        knockouts: r.knockouts as number,
        boss_knockouts: 0,
        mystery_bounty_points: 0,
        arrived: true,
        entries: r.reentries as number,
        addons: 0,
      })),
      tournament.tournament_type,
      tournament.rating_formula_version,
      { ratingGuarantee: tournament.rating_guarantee, placementPointsMultiplier: tournament.placement_points_multiplier },
      true
    );
    const controlMap = new Map(control.results.map((r) => [r.player_id, r.rating_points]));
    for (const r of results) {
      expect(Number(r.rating_points)).toBe(controlMap.get(r.player_id as string));
    }

    // Registrations: canonical ones attended; no-show/waitlist untouched.
    for (const n of [1, 2, 3, 4, 6]) expect((await regOf(T1, n))?.status).toBe("attended");
    // The operational export keeps attended players (and only them), and
    // the completion-time sheet rewrite no longer carries the stale rows.
    const exportAfter = await tournaments.getTournamentSheetExportData(T1);
    expect(exportAfter.rows.map((row) => [row.player_id, row.registration_status])).toEqual(
      [1, 2, 3, 4, 6].map((n) => [pid(n), "attended"])
    );
    expect(sheetPlayerIds()).toEqual([1, 2, 3, 4, 6].map(pid));
    expect((await regOf(T1, 5))?.status).toBe("waitlist");
    expect((await regOf(T1, 5))?.no_show_at).not.toBeNull();
    expect((await regOf(T1, 7))?.status).toBe("waitlist");

    // Completed tournament immutability unchanged: a second completion is
    // rejected and the frozen results stay.
    const again = await postComplete([submittedRow(1, 1)]);
    expect(again.status).toBe(409);
    const [count] = await client`SELECT count(*)::int AS n FROM results WHERE tournament_id = ${T1}::uuid`;
    expect(count.n).toBe(5);
  });

  it("Scenario D (fail closed): a canonical registered participant missing from the completion data blocks completion with a clear message -- nothing saved, no place invented", async () => {
    await setupCompletionScenario();

    const response = await postComplete([
      submittedRow(1, 1),
      submittedRow(2, 2),
      submittedRow(3, 3),
      submittedRow(4, 4),
      // #6 (promoted after the page loaded) is missing.
      submittedRow(5, 0),
      submittedRow(7, 0),
    ]);

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Данные участников изменились. Обновите таблицу и повторите завершение.");
    const [t] = await client`SELECT status FROM tournaments WHERE id = ${T1}::uuid`;
    expect(t.status).toBe("open");
    const [count] = await client`SELECT count(*)::int AS n FROM results WHERE tournament_id = ${T1}::uuid`;
    expect(count.n).toBe(0);
  });
});
