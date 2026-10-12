import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres, { type Sql } from "postgres";

// The no-show waitlist policy against a REAL PostgreSQL database -- proves
// what the fake-db suite (no-show-waitlist-policy.test.ts) structurally
// cannot: that the real `SELECT ... FOR UPDATE` tournament-row lock keeps
// truly concurrent no-show / admission / self-registration / reconcile
// transactions from ever exceeding max_players, that the at-most-once
// notification claim holds under concurrent reconciles, and that a Google
// Sheet "Пришел = TRUE" flowing through the REAL sync -> REAL
// setTournamentPlayerAttendance -> Postgres path clears a restriction (and
// does NOT admit a waitlisted player). Gated behind a localhost *test*
// database, same convention as lib/__tests__/player-merge.integration.test.ts.
//
//   NO_SHOW_POSTGRES_TEST_URL=postgres://user@127.0.0.1:5432/reraise_noshow_test \
//     npx vitest run features/__tests__/no-show-waitlist-policy.postgres.integration.test.ts
const TEST_DATABASE_URL = process.env.NO_SHOW_POSTGRES_TEST_URL;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;

function assertSafeTestDatabaseUrl(value: string): void {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.includes("test")) {
    throw new Error("No-show integration tests require a localhost test database");
  }
}

const mocks = vi.hoisted(() => ({
  send: vi.fn(async () => true),
  readSpreadsheetTabValues: vi.fn(),
  batchUpdateSpreadsheetValues: vi.fn(async () => undefined),
  assertServerActorRole: vi.fn(async () => ({ id: "admin", role: "admin" })),
}));

vi.mock("@/lib/telegram-bot-notify", () => ({
  sendTournamentPromotionTelegramNotification: mocks.send,
  sendTeamsTelegramNotification: vi.fn(),
}));
vi.mock("@/lib/google-sheets", () => ({
  readSpreadsheetTabValues: mocks.readSpreadsheetTabValues,
  batchUpdateSpreadsheetValues: mocks.batchUpdateSpreadsheetValues,
  applyNewRosterRowsFormatting: vi.fn(async () => undefined),
}));
vi.mock("@/lib/admin-auth", () => ({
  assertServerActorRole: mocks.assertServerActorRole,
  resolveCurrentServerActor: vi.fn(async () => null),
}));
vi.mock("@/features/achievements", () => ({ syncPlayersAchievementsIfEnabled: vi.fn() }));
vi.mock("@/features/club-activity", () => ({ publishTournamentWinnerEvent: vi.fn() }));

const T1 = "93000000-0000-4000-8000-0000000000a1";
const T2 = "93000000-0000-4000-8000-0000000000a2";
const PLAYER_PREFIX = "93000000-0000-4000-8000-0000000";

function pid(n: number): string {
  return `${PLAYER_PREFIX}${String(n).padStart(5, "0")}`;
}

describePostgres("No-show waitlist policy (PostgreSQL, real locks)", () => {
  let client: Sql;
  let capacity: typeof import("@/features/tournament-waitlist-capacity");
  let tournaments: typeof import("@/features/tournaments");
  let sheetSync: typeof import("@/features/tournament-sheet-sync");
  let noShow: typeof import("@/features/tournament-no-show");
  let layout: typeof import("@/lib/tournament-sheet-parsing");

  async function resetRows() {
    await client`DELETE FROM tournaments WHERE id IN (${T1}::uuid, ${T2}::uuid)`;
    await client`DELETE FROM players WHERE id::text LIKE ${PLAYER_PREFIX + "%"}`;
  }

  async function createTournament(
    id: string,
    opts: { maxPlayers?: number; startAt?: Date; tab?: string | null; isFinal?: boolean } = {}
  ) {
    await client`
      INSERT INTO tournaments (id, title, start_at, max_players, status, kind, google_sheet_tab_name, is_final)
      VALUES (${id}::uuid, 'Integration Cup', ${opts.startAt ?? new Date(Date.now() - 3600_000)},
              ${opts.maxPlayers ?? 40}, 'open', 'free', ${opts.tab ?? null}, ${opts.isFinal ?? false})
    `;
  }

  async function createPlayer(n: number, opts: { restricted?: boolean; telegramId?: number } = {}) {
    await client`
      INSERT INTO players (id, display_name, telegram_id, online_registration_restricted_at)
      VALUES (${pid(n)}::uuid, ${"Player " + n}, ${opts.telegramId ?? null},
              ${opts.restricted ? new Date() : null})
    `;
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

  async function seatLoad(tournamentId: string): Promise<number> {
    const [row] = await client`
      SELECT count(*)::int AS n FROM registrations r
      WHERE r.tournament_id = ${tournamentId}::uuid AND r.status IN ('registered','attended')
        AND NOT EXISTS (SELECT 1 FROM tournament_player_eliminations e
                        WHERE e.tournament_id = r.tournament_id AND e.player_id = r.player_id AND e.eliminated)
    `;
    return row.n as number;
  }

  async function statusOf(tournamentId: string, n: number) {
    const [row] = await client`
      SELECT status, no_show_at, waitlist_promotion_notification_claimed_at AS claimed
      FROM registrations WHERE tournament_id = ${tournamentId}::uuid AND player_id = ${pid(n)}::uuid
    `;
    return row as { status: string; no_show_at: Date | null; claimed: Date | null } | undefined;
  }

  async function restricted(n: number): Promise<boolean> {
    const [row] = await client`SELECT online_registration_restricted_at FROM players WHERE id = ${pid(n)}::uuid`;
    return row.online_registration_restricted_at != null;
  }

  async function arrived(tournamentId: string, n: number): Promise<boolean | null> {
    const [row] = await client`
      SELECT arrived FROM tournament_attendance WHERE tournament_id = ${tournamentId}::uuid AND player_id = ${pid(n)}::uuid
    `;
    return row ? (row.arrived as boolean) : null;
  }

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(TEST_DATABASE_URL!);
    process.env.DATABASE_PROVIDER = "postgres";
    process.env.DATABASE_URL = TEST_DATABASE_URL!;
    // Some transitively-imported modules build a (never-used here)
    // Supabase browser client at import time; give them inert local values.
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "integration-test-dummy";
    client = postgres(TEST_DATABASE_URL!, { max: 5 });
    capacity = await import("@/features/tournament-waitlist-capacity");
    tournaments = await import("@/features/tournaments");
    sheetSync = await import("@/features/tournament-sheet-sync");
    noShow = await import("@/features/tournament-no-show");
    layout = await import("@/lib/tournament-sheet-parsing");
    await resetRows();
  });

  beforeEach(() => {
    mocks.send.mockReset();
    mocks.send.mockResolvedValue(true);
    mocks.readSpreadsheetTabValues.mockReset();
    mocks.batchUpdateSpreadsheetValues.mockClear();
  });

  afterEach(async () => {
    await resetRows();
  });

  afterAll(async () => {
    if (!client) return;
    await client.end();
  });

  // -------------------------------------------------------------------------
  // Real concurrency
  // -------------------------------------------------------------------------

  it("two concurrent 'Допустить в игру' for the LAST seat: exactly one wins, the other gets the no-seat message", async () => {
    await createTournament(T1, { maxPlayers: 3 });
    for (let n = 1; n <= 4; n++) await createPlayer(n, { restricted: n >= 3 });
    await register(T1, 1, "registered");
    await register(T1, 2, "registered");
    const a = await register(T1, 3, "waitlist");
    const b = await register(T1, 4, "waitlist");

    const outcomes = await Promise.allSettled([
      capacity.admitWaitlistedRegistrationWithinCapacity(T1, a),
      capacity.admitWaitlistedRegistrationWithinCapacity(T1, b),
    ]);

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.message).toBe(capacity.ADMISSION_NO_SEAT_MESSAGE);
    expect(await seatLoad(T1)).toBe(3);
  });

  it("a storm of concurrent no-shows, admissions, self-registrations and reconciles never exceeds max_players", async () => {
    await createTournament(T1, { maxPlayers: 40 });
    for (let n = 1; n <= 60; n++) await createPlayer(n, { restricted: n >= 41 && n <= 44 });
    for (let n = 1; n <= 40; n++) await register(T1, n, "registered");
    const waitlist: string[] = [];
    for (let n = 41; n <= 50; n++) waitlist.push(await register(T1, n, "waitlist"));
    const regs = await client`SELECT id, player_id FROM registrations WHERE tournament_id = ${T1}::uuid AND status = 'registered' ORDER BY created_at`;

    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < 6; i++) ops.push(capacity.markRegistrationNoShowWithinCapacity(T1, regs[i].id));
    for (const id of waitlist) ops.push(capacity.admitWaitlistedRegistrationWithinCapacity(T1, id));
    for (let n = 51; n <= 60; n++) ops.push(capacity.admitPlayerToTournament(T1, pid(n)));
    for (let i = 0; i < 5; i++) ops.push(capacity.reconcileTournamentWaitlistCapacity(T1));
    await Promise.allSettled(ops);

    expect(await seatLoad(T1)).toBeLessThanOrEqual(40);
    // 6 seats were freed by no-shows; with this much demand every one is
    // refilled -- exactly full, never over.
    expect(await seatLoad(T1)).toBe(40);
    // The 6 no-show players are still waitlisted (restricted => never
    // auto-promoted back, and nobody admitted them).
    for (let i = 0; i < 6; i++) {
      const [row] = await client`SELECT status, no_show_at FROM registrations WHERE id = ${regs[i].id}::uuid`;
      expect(row.status).toBe("waitlist");
      expect(row.no_show_at).not.toBeNull();
    }
  });

  it("concurrent reconciles after one freed seat claim and send the promotion notification exactly once", async () => {
    await createTournament(T1, { maxPlayers: 2 });
    await createPlayer(1);
    await createPlayer(2);
    await createPlayer(3, { telegramId: 9_000_003 });
    await register(T1, 1, "registered");
    await register(T1, 2, "registered");
    await register(T1, 3, "waitlist");
    await client`INSERT INTO tournament_player_eliminations (tournament_id, player_id, eliminated, eliminated_at)
                 VALUES (${T1}::uuid, ${pid(1)}::uuid, true, now())`;

    await Promise.all(Array.from({ length: 6 }, () => capacity.reconcileTournamentWaitlistCapacity(T1)));

    expect((await statusOf(T1, 3))?.status).toBe("registered");
    expect((await statusOf(T1, 3))?.claimed).not.toBeNull();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ telegramId: 9_000_003, tournamentId: T1 })
    );
  });

  // -------------------------------------------------------------------------
  // Full lifecycle + history
  // -------------------------------------------------------------------------

  it("registered -> 'Не пришёл' -> late arrival 'Допустить в игру': THIS no_show_at cleared, OTHER tournament's no-show kept, restriction cleared; derived count batched", async () => {
    await createTournament(T1, { maxPlayers: 2 });
    await createTournament(T2, { maxPlayers: 10 });
    await createPlayer(1);
    await createPlayer(2);
    // Older, separate no-show on another tournament.
    const older = await register(T2, 1, "waitlist");
    await client`UPDATE registrations SET no_show_at = '2026-01-05T19:00:00Z' WHERE id = ${older}::uuid`;
    const reg = await register(T1, 1, "registered");
    await register(T1, 2, "registered");

    await capacity.markRegistrationNoShowWithinCapacity(T1, reg);
    expect((await statusOf(T1, 1))?.status).toBe("waitlist");
    expect((await statusOf(T1, 1))?.no_show_at).not.toBeNull();
    expect(await restricted(1)).toBe(true);
    expect(await seatLoad(T1)).toBe(1);

    let policy = await noShow.getAdminNoShowPolicyState(T1, [pid(1), pid(2)]);
    expect(policy.get(pid(1))).toMatchObject({ no_show_count: 2, online_registration_restricted: true });
    expect(policy.get(pid(1))?.no_show_at).not.toBeNull();
    expect(policy.get(pid(2))).toEqual({ no_show_count: 0, online_registration_restricted: false, no_show_at: null });

    await capacity.admitWaitlistedRegistrationWithinCapacity(T1, reg);

    expect((await statusOf(T1, 1))?.status).toBe("registered");
    expect((await statusOf(T1, 1))?.no_show_at).toBeNull();
    expect(await arrived(T1, 1)).toBe(true);
    expect(await restricted(1)).toBe(false);
    const [olderRow] = await client`SELECT no_show_at FROM registrations WHERE id = ${older}::uuid`;
    expect(olderRow.no_show_at).not.toBeNull();
    expect(await seatLoad(T1)).toBe(2);

    policy = await noShow.getAdminNoShowPolicyState(T1, [pid(1)]);
    expect(policy.get(pid(1))).toEqual({ no_show_count: 1, online_registration_restricted: false, no_show_at: null });
  });

  it("restricted self-registration via the real registerPlayerForTournament lands in the waitlist even at 0/40; cancellation still works", async () => {
    await createTournament(T1, { maxPlayers: 40, startAt: new Date(Date.now() + 86_400_000) });
    await createPlayer(1, { restricted: true });
    await createPlayer(2);

    const restrictedResult = await tournaments.registerPlayerForTournament(pid(1), T1);
    const normalResult = await tournaments.registerPlayerForTournament(pid(2), T1);

    expect(restrictedResult).toMatchObject({ status: "waitlist", online_registration_restricted: true });
    expect(normalResult.status).toBe("registered");
    expect(normalResult).not.toHaveProperty("online_registration_restricted");

    await tournaments.cancelPlayerRegistration(pid(1), T1);
    expect((await statusOf(T1, 1))?.status).toBe("cancelled");
  });

  // -------------------------------------------------------------------------
  // Delete vs No-show -- genuinely different code paths
  // -------------------------------------------------------------------------

  it("'Удалить' (removeAdminTournamentParticipant) never creates no_show_at or a restriction; 'Не пришёл' does", async () => {
    await createTournament(T1, { maxPlayers: 10 });
    await createPlayer(1);
    await createPlayer(2);
    const deleted = await register(T1, 1, "registered");
    const noShowReg = await register(T1, 2, "registered");

    await tournaments.removeAdminTournamentParticipant(deleted);
    await capacity.markRegistrationNoShowWithinCapacity(T1, noShowReg);

    const [deletedCount] = await client`SELECT count(*)::int AS n FROM registrations WHERE player_id = ${pid(1)}::uuid`;
    expect(deletedCount.n).toBe(0);
    expect(await restricted(1)).toBe(false);
    const [noShowCount] = await client`SELECT count(*)::int AS n FROM registrations WHERE player_id = ${pid(1)}::uuid AND no_show_at IS NOT NULL`;
    expect(noShowCount.n).toBe(0);

    expect(await restricted(2)).toBe(true);
    expect((await statusOf(T1, 2))?.no_show_at).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Arrival clears the restriction (admin path)
  // -------------------------------------------------------------------------

  it("admin attendance arrived=true clears a restriction on a registered seat; arrived=false never creates one", async () => {
    await createTournament(T1);
    await createTournament(T2);
    await createPlayer(1, { restricted: true });
    await createPlayer(2);
    const older = await register(T2, 1, "waitlist");
    await client`UPDATE registrations SET no_show_at = now() WHERE id = ${older}::uuid`;
    await register(T1, 1, "registered");
    await register(T1, 2, "registered");

    await tournaments.setTournamentPlayerAttendance(T1, pid(2), false);
    await tournaments.setTournamentPlayerAttendance(T1, pid(2), true);
    await tournaments.setTournamentPlayerAttendance(T1, pid(2), false);
    expect(await restricted(2)).toBe(false);

    await tournaments.setTournamentPlayerAttendance(T1, pid(1), false);
    expect(await restricted(1)).toBe(true);
    await tournaments.setTournamentPlayerAttendance(T1, pid(1), true);
    expect(await restricted(1)).toBe(false);
    const [olderRow] = await client`SELECT no_show_at FROM registrations WHERE id = ${older}::uuid`;
    expect(olderRow.no_show_at).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Google Sheets -- the REAL sync path into Postgres
  // -------------------------------------------------------------------------

  function sheetValues(rows: Array<{ n: number; status: string; arrived: boolean }>): string[][] {
    const headers = layout.getFreeSheetColumnLayout("classic").headers;
    const meta: string[][] = [[], [], [], [], [], []];
    return [
      ...meta,
      headers,
      ...rows.map((row) => {
        const cells = headers.map(() => "");
        cells[0] = pid(row.n);
        cells[2] = `Player ${row.n}`;
        cells[4] = row.status;
        cells[5] = row.arrived ? "TRUE" : "FALSE";
        return cells;
      }),
    ];
  }

  it("Sheet 'Пришел = TRUE' -> reconcileTournamentFromSheet -> real setTournamentPlayerAttendance clears the restriction of a REGISTERED player", async () => {
    await createTournament(T1, { tab: "IT tab" });
    await createPlayer(1, { restricted: true });
    await register(T1, 1, "registered");
    mocks.readSpreadsheetTabValues.mockResolvedValue(sheetValues([{ n: 1, status: "registered", arrived: true }]));

    const result = await sheetSync.reconcileTournamentFromSheet(T1);

    expect(result.skipped).toBe(false);
    expect(await arrived(T1, 1)).toBe(true);
    expect(await restricted(1)).toBe(false);
  });

  it("SAFETY: a WAITLISTED player's sheet 'Пришел = TRUE' alone never admits them (restricted or not, even with a free seat for the restricted one)", async () => {
    await createTournament(T1, { tab: "IT tab", maxPlayers: 2 });
    await createPlayer(1);
    await createPlayer(2, { restricted: true });
    await createPlayer(3);
    await register(T1, 1, "registered");
    await register(T1, 2, "waitlist"); // restricted, a seat IS free
    mocks.readSpreadsheetTabValues.mockResolvedValue(
      sheetValues([
        { n: 1, status: "registered", arrived: true },
        // An operator also typed "registered" into the ReRaise-owned status
        // column -- it must never be read back.
        { n: 2, status: "registered", arrived: true },
      ])
    );

    await sheetSync.reconcileTournamentFromSheet(T1);

    expect((await statusOf(T1, 2))?.status).toBe("waitlist");
    expect(await arrived(T1, 2)).toBeNull();
    expect(await restricted(2)).toBe(true);
    // ...and ReRaise rewrites the status cell back to its own value.
    const statusWrites = mocks.batchUpdateSpreadsheetValues.mock.calls
      .flatMap((call) => (call as unknown as [Array<{ range: string; values: unknown[][] }>])[0])
      .filter((update) => update.range.includes("!B") && update.values[0][3] === "waitlist");
    expect(statusWrites).toHaveLength(1);

    // An unrestricted waitlisted player with Пришел=TRUE and NO free seat
    // is not admitted either.
    await register(T1, 3, "waitlist");
    await client`UPDATE registrations SET status = 'registered' WHERE player_id = ${pid(2)}::uuid AND tournament_id = ${T1}::uuid`;
    mocks.readSpreadsheetTabValues.mockResolvedValue(
      sheetValues([
        { n: 1, status: "registered", arrived: true },
        { n: 2, status: "registered", arrived: false },
        { n: 3, status: "waitlist", arrived: true },
      ])
    );
    await sheetSync.reconcileTournamentFromSheet(T1);
    expect((await statusOf(T1, 3))?.status).toBe("waitlist");
    expect(await arrived(T1, 3)).toBeNull();
  });

  it("after 'Не пришёл' the next roster sync writes Статус регистрации = waitlist; after admission the sheet gets registered + Пришел TRUE", async () => {
    await createTournament(T1, { tab: "IT tab", maxPlayers: 2 });
    await createPlayer(1);
    await createPlayer(2);
    const reg = await register(T1, 1, "registered");
    await register(T1, 2, "registered");

    await capacity.markRegistrationNoShowWithinCapacity(T1, reg);
    mocks.readSpreadsheetTabValues.mockResolvedValue(
      sheetValues([
        { n: 1, status: "registered", arrived: false },
        { n: 2, status: "registered", arrived: true },
      ])
    );
    await sheetSync.reconcileTournamentFromSheet(T1);
    const firstWrites = mocks.batchUpdateSpreadsheetValues.mock.calls
      .flatMap((call) => (call as unknown as [Array<{ range: string; values: unknown[][] }>])[0]);
    expect(firstWrites).toContainEqual({ range: "IT tab!B8:E8", values: [["", "Player 1", "", "waitlist"]] });

    mocks.batchUpdateSpreadsheetValues.mockClear();
    await capacity.admitWaitlistedRegistrationWithinCapacity(T1, reg);
    mocks.readSpreadsheetTabValues.mockResolvedValue(
      sheetValues([
        { n: 1, status: "waitlist", arrived: false },
        { n: 2, status: "registered", arrived: true },
      ])
    );
    const sync = await sheetSync.syncAdmittedPlayerToSheet(T1, pid(1));

    expect(sync.arrivedWritten).toBe(true);
    const admissionWrites = mocks.batchUpdateSpreadsheetValues.mock.calls
      .flatMap((call) => (call as unknown as [Array<{ range: string; values: unknown[][] }>])[0]);
    expect(admissionWrites).toContainEqual({ range: "IT tab!B8:E8", values: [["", "Player 1", "", "registered"]] });
    expect(admissionWrites).toContainEqual({ range: "IT tab!F8", values: [[true]] });
  });
});
