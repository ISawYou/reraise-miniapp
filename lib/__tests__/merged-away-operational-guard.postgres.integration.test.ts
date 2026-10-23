import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import postgres, { type ReservedSql, type Sql } from "postgres";

// Merged-away (tombstone) players vs operational admin flows, against a REAL
// PostgreSQL database: the canonical-only player directory (through the real
// route handlers), the in-transaction admission guard, and the two real
// interleavings of ACCOUNT MERGE (lib/player-merge.ts executeAdminMerge, the
// real Merge Engine v2) vs ADMIN "ADD EXISTING PLAYER TO TOURNAMENT".
//
// Deterministic interleaving technique: a separately reserved connection
// holds a row lock that the operation under test needs AFTER it has taken
// its player-row lock, and pg_stat_activity is polled until the expected
// statement is genuinely blocked on a lock -- no sleeps-as-synchronization.
//
//   MERGED_AWAY_GUARD_POSTGRES_TEST_URL=postgres://user@127.0.0.1:5432/<name>_test \
//     npx vitest run --no-file-parallelism lib/__tests__/merged-away-operational-guard.postgres.integration.test.ts
//
// Scenario numbers in test names refer to the task spec (§7).
const TEST_DATABASE_URL =
  process.env.MERGED_AWAY_GUARD_POSTGRES_TEST_URL ?? process.env.PLAYER_MERGE_POSTGRES_TEST_URL;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;

function assertSafeTestDatabaseUrl(value: string): void {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.includes("test")) {
    throw new Error("Merged-away guard integration tests require a localhost test database");
  }
}

vi.mock("@/lib/admin-auth", () => ({
  assertServerActorRole: vi.fn(async () => ({ id: "staff", role: "operator" })),
  resolveCurrentServerActor: vi.fn(async () => null),
}));
vi.mock("@/lib/telegram-bot-notify", () => ({
  sendTournamentPromotionTelegramNotification: vi.fn(async () => true),
  sendTeamsTelegramNotification: vi.fn(),
}));
vi.mock("@/features/achievements", () => ({
  syncPlayersAchievementsIfEnabled: vi.fn(),
  syncPlayerAchievements: vi.fn(),
}));
vi.mock("@/features/club-activity", () => ({ publishTournamentWinnerEvent: vi.fn() }));

const PREFIX = "96100000-0000-4000-8000-0000000";
function id(n: number): string {
  return `${PREFIX}${String(n).padStart(5, "0")}`;
}

// Production shape (read-only diagnostic): savinska33 merged into p_73a.
// p_73a carries the Telegram identity, savinska33 an email-only account.
const P_73A = id(1);
const SAVINSKA33 = id(2);
const ALPHA = id(3);
const BRAVO = id(4);
const CHARLIE = id(5);
const WAITER = id(6);
const T_OLD = id(101);
const T1 = id(102);
const TG_P73A = 961000001;

const MERGED_MESSAGE = "Этот аккаунт уже объединён с другим. Выберите основной аккаунт.";

describePostgres("Merged-away players vs operational flows (PostgreSQL)", () => {
  let client: Sql;
  let merge: typeof import("@/lib/player-merge");
  let tournaments: typeof import("@/features/tournaments");
  let repositories: typeof import("@/lib/repositories");
  let nicknamesRoute: typeof import("@/app/api/admin/nicknames/players/route");
  let adminPlayersRoute: typeof import("@/app/api/admin/players/route");
  let referralRoute: typeof import("@/app/api/admin/referral/route");
  let authServer: typeof import("@/features/auth-server");
  const reserved: ReservedSql[] = [];

  async function resetRows() {
    await client`DELETE FROM tournaments WHERE id::text LIKE ${PREFIX + "%"}`;
    await client`DELETE FROM players WHERE id::text LIKE ${PREFIX + "%"}`;
    await client`DELETE FROM players WHERE telegram_id = ${TG_P73A}`;
    await client`DELETE FROM players WHERE lower(email) LIKE '%@merged-away.test'`;
  }

  async function createPlayer(playerId: string, name: string, opts: { telegramId?: number; email?: string } = {}) {
    await client`
      INSERT INTO players (id, display_name, telegram_id, email)
      VALUES (${playerId}::uuid, ${name}, ${opts.telegramId ?? null}, ${opts.email ?? null})
    `;
  }

  async function seedPair() {
    await createPlayer(P_73A, "p_73a", { telegramId: TG_P73A });
    await createPlayer(SAVINSKA33, "savinska33", { email: "savinska33@merged-away.test" });
  }

  async function createTournament(tournamentId: string, title: string, maxPlayers = 40) {
    await client`
      INSERT INTO tournaments (id, title, start_at, max_players, status, kind, is_final)
      VALUES (${tournamentId}::uuid, ${title}, ${new Date(Date.now() + 3600_000)}, ${maxPlayers}, 'open', 'free', false)
    `;
  }

  async function register(playerId: string, tournamentId: string, status: string): Promise<string> {
    const [row] = await client`
      INSERT INTO registrations (player_id, tournament_id, status, created_at)
      VALUES (${playerId}::uuid, ${tournamentId}::uuid, ${status}, ${new Date("2026-09-01T10:00:00Z")})
      RETURNING id::text AS id
    `;
    return row.id as string;
  }

  function adminMerge() {
    return merge.executeAdminMerge({
      targetPlayerId: P_73A,
      sourcePlayerId: SAVINSKA33,
      confirmation: merge.ADMIN_MERGE_CONFIRMATION,
    });
  }

  async function mergedPair() {
    await seedPair();
    const result = await adminMerge();
    expect(result.merged).toBe(true);
  }

  async function registrationsOf(playerId: string) {
    return client`
      SELECT id::text AS id, tournament_id::text AS tournament_id, status, created_at
      FROM registrations WHERE player_id = ${playerId}::uuid ORDER BY created_at
    `;
  }

  async function registrationIn(tournamentId: string, playerId: string) {
    const [row] = await client`
      SELECT id::text AS id, status FROM registrations
      WHERE tournament_id = ${tournamentId}::uuid AND player_id = ${playerId}::uuid
    `;
    return row as { id: string; status: string } | undefined;
  }

  async function assertUniqueRegistrations() {
    const dupes = await client`
      SELECT player_id, tournament_id, count(*)::int AS n FROM registrations
      WHERE tournament_id::text LIKE ${PREFIX + "%"}
      GROUP BY player_id, tournament_id HAVING count(*) > 1
    `;
    expect(dupes).toEqual([]);
  }

  // (12) The tombstone carries no tournament state at all -- in particular
  // nothing created after it became a tombstone.
  async function assertTombstoneHasNoTournamentState() {
    const [player] = await client`SELECT merged_into_player_id::text AS m, merged_at FROM players WHERE id = ${SAVINSKA33}::uuid`;
    expect(player.m).toBe(P_73A);
    expect(await registrationsOf(SAVINSKA33)).toEqual([]);
    const [{ n }] = await client`
      SELECT count(*)::int AS n FROM registrations
      WHERE player_id = ${SAVINSKA33}::uuid AND created_at >= ${player.merged_at}
    `;
    expect(n).toBe(0);
  }

  async function holdRowLock(table: "registrations" | "players", rowId: string): Promise<ReservedSql> {
    const conn = await client.reserve();
    reserved.push(conn);
    await conn`BEGIN`;
    await conn.unsafe(`SELECT id FROM ${table} WHERE id = $1::uuid FOR UPDATE`, [rowId]);
    return conn;
  }

  async function commit(conn: ReservedSql) {
    await conn`COMMIT`;
    reserved.splice(reserved.indexOf(conn), 1);
    conn.release();
  }

  // Polls until some OTHER backend in this database is blocked on a lock
  // while running a statement matching `pattern`.
  async function waitForLockWait(pattern: RegExp, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rows = await client`
        SELECT query FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()
      `;
      if (rows.some((row) => pattern.test(String(row.query)))) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`No backend blocked on a lock running ${pattern}`);
  }

  // Statement shapes (drizzle-generated).
  const ADMISSION_PLAYER_LOCK = /select "id", "merged_into_player_id" from "players" where "players"\."id" = \$1 for update/i;
  const MERGE_PLAYER_LOCK = /"telegram_id".*from "players" where "players"\."id" = \$1 for update/i;
  const MERGE_MOVES_REGISTRATIONS = /update "registrations" set "player_id"/i;
  const ADMISSION_PROMOTES_WAITER = /update "registrations" set "status"/i;

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(TEST_DATABASE_URL!);
    process.env.DATABASE_PROVIDER = "postgres";
    process.env.DATABASE_URL = TEST_DATABASE_URL!;
    process.env.SESSION_SECRET = "merged-away-guard-integration-secret";
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "integration-test-dummy";
    client = postgres(TEST_DATABASE_URL!, { max: 6, onnotice: () => undefined });
    merge = await import("@/lib/player-merge");
    tournaments = await import("@/features/tournaments");
    repositories = await import("@/lib/repositories");
    nicknamesRoute = await import("@/app/api/admin/nicknames/players/route");
    adminPlayersRoute = await import("@/app/api/admin/players/route");
    referralRoute = await import("@/app/api/admin/referral/route");
    authServer = await import("@/features/auth-server");
    await resetRows();
  });

  afterEach(async () => {
    for (const conn of reserved.splice(0)) {
      await conn`ROLLBACK`.catch(() => undefined);
      conn.release();
    }
    await resetRows();
  });

  afterAll(async () => {
    if (!client) return;
    await client.end();
  });

  // ---------------------------------------------------------------------
  // Operational player directory (repository + every route built on it)
  // ---------------------------------------------------------------------

  describe("operational player directory", () => {
    async function seedDirectory() {
      await mergedPair();
      await createPlayer(ALPHA, "Alpha");
      await createPlayer(BRAVO, "bravo");
      await createPlayer(CHARLIE, "Charlie");
    }

    const fixtureIds = () => [P_73A, SAVINSKA33, ALPHA, BRAVO, CHARLIE];
    const onlyFixture = (players: { id: string }[]) => players.map((p) => p.id).filter((pid) => fixtureIds().includes(pid));

    it("1-4. listOrderedByDisplayName: canonical p_73a in, merged-away savinska33 out, ordinary players unchanged, display_name order kept", async () => {
      await seedDirectory();

      const listed = onlyFixture(await repositories.playerRepository.listOrderedByDisplayName());

      expect(listed).toContain(P_73A); // (1)
      expect(listed).not.toContain(SAVINSKA33); // (2)
      expect(listed).toEqual(expect.arrayContaining([ALPHA, BRAVO, CHARLIE])); // (3)
      expect(listed).toHaveLength(4);
      // (4) exactly Postgres's own ORDER BY display_name over the canonical rows
      const expected = await client`
        SELECT id::text AS id FROM players
        WHERE id = ANY(${fixtureIds()}::uuid[]) AND merged_into_player_id IS NULL
        ORDER BY display_name ASC
      `;
      expect(listed).toEqual(expected.map((row) => row.id));
    });

    it("5 + 6. every route on the shared directory (tournament picker, admin players, referral) excludes savinska33 and keeps p_73a", async () => {
      await seedDirectory();

      for (const route of [nicknamesRoute, adminPlayersRoute, referralRoute]) {
        const body = (await (await route.GET()).json()) as { players: { id: string }[] };
        const listed = onlyFixture(body.players);
        expect(listed).toContain(P_73A);
        expect(listed).not.toContain(SAVINSKA33);
      }
    });

    it("16. Merge Center search still never offers the merged-away account (unchanged)", async () => {
      await seedDirectory();

      expect((await merge.searchPlayersForAdminMerge("savinska33")).map((p) => p.id)).not.toContain(SAVINSKA33);
      expect((await merge.searchPlayersForAdminMerge("p_73a")).map((p) => p.id)).toContain(P_73A);
    });
  });

  // ---------------------------------------------------------------------
  // Admin "add existing player" -- server-side guard
  // ---------------------------------------------------------------------

  describe("admin add existing player (already merged)", () => {
    it("7 + 8 + 14. merged-away id is rejected with the clear message; no registration, no partial promotion, player row untouched", async () => {
      await mergedPair();
      await createTournament(T1, "Вечерний", 40);
      await createPlayer(WAITER, "Waiter");
      // An eligible waiter with a free seat: a transaction that got past the
      // guard would promote them first -- the rejected one must not.
      await register(WAITER, T1, "waitlist");
      const [playerBefore] = await client`SELECT * FROM players WHERE id = ${SAVINSKA33}::uuid`;

      const result = await tournaments.addExistingPlayerToTournament(T1, SAVINSKA33);

      expect(result).toEqual({ ok: false, error: MERGED_MESSAGE });
      expect(await registrationIn(T1, SAVINSKA33)).toBeUndefined();
      expect(await registrationsOf(SAVINSKA33)).toEqual([]);
      expect((await registrationIn(T1, WAITER))?.status).toBe("waitlist");
      const [playerAfter] = await client`SELECT * FROM players WHERE id = ${SAVINSKA33}::uuid`;
      expect(playerAfter).toEqual(playerBefore);
    });

    it("9. the canonical account is added exactly as before; a duplicate add is still refused unchanged", async () => {
      await mergedPair();
      await createTournament(T1, "Вечерний", 40);

      expect(await tournaments.addExistingPlayerToTournament(T1, P_73A)).toEqual({ ok: true });
      expect((await registrationIn(T1, P_73A))?.status).toBe("registered");
      await expect(tournaments.addExistingPlayerToTournament(T1, P_73A)).rejects.toThrow(
        "Игрок уже зарегистрирован в этом турнире"
      );
      await assertUniqueRegistrations();
    });

    it("15. self-registration of the merged-away id is still rejected with PlayerMergedAwayError (unchanged)", async () => {
      await mergedPair();
      await createTournament(T1, "Вечерний", 40);

      await expect(tournaments.registerPlayerForTournament(SAVINSKA33, T1)).rejects.toBeInstanceOf(
        authServer.PlayerMergedAwayError
      );
      expect(await registrationsOf(SAVINSKA33)).toEqual([]);
      expect((await tournaments.registerPlayerForTournament(P_73A, T1)).status).toBe("registered");
    });
  });

  // ---------------------------------------------------------------------
  // Real concurrency: ACCOUNT MERGE vs ADD EXISTING PLAYER TO TOURNAMENT
  // ---------------------------------------------------------------------

  describe("concurrent merge vs admin add", () => {
    it("10 + 12 + 13 + 14. MERGE WINS: add waits on the player row, then sees the tombstone and rejects -- zero tombstone registration", async () => {
      await seedPair();
      await createTournament(T_OLD, "Старый", 40);
      await createTournament(T1, "Вечерний", 40);
      const oldRegistration = await register(SAVINSKA33, T_OLD, "attended");

      // Pause the merge AFTER lockPlayerPair (both player rows locked
      // FOR UPDATE): it blocks moving source's old registration.
      const blocker = await holdRowLock("registrations", oldRegistration);
      const mergePromise = adminMerge();
      await waitForLockWait(MERGE_MOVES_REGISTRATIONS);

      // The add now takes the tournament lock, then blocks on the SAME
      // player row the merge holds.
      const addPromise = tournaments.addExistingPlayerToTournament(T1, SAVINSKA33);
      await waitForLockWait(ADMISSION_PLAYER_LOCK);

      await commit(blocker);

      expect((await mergePromise).merged).toBe(true);
      expect(await addPromise).toEqual({ ok: false, error: MERGED_MESSAGE });

      expect(await registrationIn(T1, SAVINSKA33)).toBeUndefined();
      expect(await registrationIn(T1, P_73A)).toBeUndefined();
      expect(await registrationIn(T_OLD, P_73A)).toEqual({ id: oldRegistration, status: "attended" });
      await assertTombstoneHasNoTournamentState();
      await assertUniqueRegistrations();
    });

    it("11 + 12 + 13. ADD WINS: merge waits on the player row; after add commits, merge moves the new registration to p_73a", async () => {
      await seedPair();
      await createTournament(T1, "Вечерний", 40);
      await createPlayer(WAITER, "Waiter");
      const waiterRegistration = await register(WAITER, T1, "waitlist");

      // Pause the add AFTER its entrant player-row lock (+ touch): it blocks
      // promoting the eligible waiter, which comes after the guard.
      const blocker = await holdRowLock("registrations", waiterRegistration);
      const addPromise = tournaments.addExistingPlayerToTournament(T1, SAVINSKA33);
      await waitForLockWait(ADMISSION_PROMOTES_WAITER);

      // The merge starts (its SERIALIZABLE snapshot is taken by its first
      // statement, BEFORE the add commits) and blocks on source's row.
      const mergePromise = adminMerge();
      await waitForLockWait(MERGE_PLAYER_LOCK);

      await commit(blocker);

      expect(await addPromise).toEqual({ ok: true });
      expect((await mergePromise).merged).toBe(true);

      // The registration created by the add now belongs to the canonical
      // account; the tombstone has none.
      expect((await registrationIn(T1, P_73A))?.status).toBe("registered");
      expect(await registrationIn(T1, SAVINSKA33)).toBeUndefined();
      expect((await registrationIn(T1, WAITER))?.status).toBe("registered");
      await assertTombstoneHasNoTournamentState();
      await assertUniqueRegistrations();
    });

    it("control: a lock-only FOR UPDATE (no row-version touch) would leave the add's registration ON the tombstone -- why the guard also touches the row", async () => {
      // Hand-rolled 'add' on a raw connection that locks the player row but
      // does NOT update it. Documents the hazard the guard's no-op UPDATE
      // closes: the merge's SERIALIZABLE snapshot predates this commit, its
      // FOR UPDATE succeeds on a lock-only row version, and it never sees
      // the new registration. If Postgres ever stopped behaving this way the
      // touch would be unnecessary -- this test would then fail and say so.
      await seedPair();
      await createTournament(T1, "Вечерний", 40);

      const naiveAdd = await holdRowLock("players", SAVINSKA33);
      await naiveAdd`
        INSERT INTO registrations (player_id, tournament_id, status)
        VALUES (${SAVINSKA33}::uuid, ${T1}::uuid, 'registered')
      `;
      const mergePromise = adminMerge();
      await waitForLockWait(MERGE_PLAYER_LOCK);
      await commit(naiveAdd);

      expect((await mergePromise).merged).toBe(true);
      expect(await registrationIn(T1, SAVINSKA33)).toBeDefined(); // orphaned on the tombstone
      expect(await registrationIn(T1, P_73A)).toBeUndefined();
    });

    it("14. an add that fails for another reason AFTER the guard (Late Registration closed) rolls back cleanly and a later merge is unaffected", async () => {
      await seedPair();
      await createTournament(T1, "Вечерний", 40);
      await client`
        INSERT INTO tournament_late_registration (
          tournament_id, arrived_players_count, initial_stacks_count, total_entries_count,
          rebuys_count, addons_count, tournament_type, rating_formula_version, rating_places
        ) VALUES (${T1}::uuid, 1, 1, 1, 0, 0, 'classic', 'v2', '[]'::jsonb)
      `;
      const [playerBefore] = await client`SELECT * FROM players WHERE id = ${SAVINSKA33}::uuid`;

      await expect(tournaments.addExistingPlayerToTournament(T1, SAVINSKA33)).rejects.toThrow(
        "Поздняя регистрация завершена — запись на турнир закрыта"
      );

      expect(await registrationsOf(SAVINSKA33)).toEqual([]);
      const [playerAfter] = await client`SELECT * FROM players WHERE id = ${SAVINSKA33}::uuid`;
      expect(playerAfter).toEqual(playerBefore);
      expect((await adminMerge()).merged).toBe(true);
      await assertTombstoneHasNoTournamentState();
    });
  });
});
