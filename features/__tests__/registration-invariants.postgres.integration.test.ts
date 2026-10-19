import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import postgres, { type Sql } from "postgres";

// Registration invariants against a REAL PostgreSQL database (real row
// locks, real repositories, real entry points):
//   RULE 1 -- once tournament_attendance.arrived_at IS NOT NULL the player
//             can never self-cancel (cancelPlayerRegistration);
//   RULE 2 -- once the tournament_late_registration snapshot exists no new
//             registration/waitlist/reactivation/admin add is possible.
// Includes deterministic interleaving tests: a separate connection holds
// the tournament-row lock while the operation under test is started, which
// proves the operation really waits on that SAME lock and re-reads the
// committed state after acquiring it. LOCAL TEST DATA ONLY.
//
//   REGISTRATION_INVARIANTS_POSTGRES_TEST_URL=postgres://user@127.0.0.1:5432/reraise_reginv_test \
//     npx vitest run features/__tests__/registration-invariants.postgres.integration.test.ts
const TEST_DATABASE_URL =
  process.env.REGISTRATION_INVARIANTS_POSTGRES_TEST_URL ?? process.env.NO_SHOW_POSTGRES_TEST_URL;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;

function assertSafeTestDatabaseUrl(value: string): void {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.includes("test")) {
    throw new Error("Registration invariant integration tests require a localhost test database");
  }
}

const mocks = vi.hoisted(() => ({
  send: vi.fn(async () => true),
  assertServerActorRole: vi.fn(async () => ({ id: "staff", role: "operator" })),
}));

vi.mock("@/lib/telegram-bot-notify", () => ({
  sendTournamentPromotionTelegramNotification: mocks.send,
  sendTeamsTelegramNotification: vi.fn(),
}));
vi.mock("@/lib/admin-auth", () => ({
  assertServerActorRole: mocks.assertServerActorRole,
  resolveCurrentServerActor: vi.fn(async () => null),
}));
vi.mock("@/features/achievements", () => ({ syncPlayersAchievementsIfEnabled: vi.fn() }));
vi.mock("@/features/club-activity", () => ({ publishTournamentWinnerEvent: vi.fn() }));

const T1 = "97000000-0000-4000-8000-0000000000c1";
const PLAYER_PREFIX = "97000000-0000-4000-8000-0000000";
const WALK_IN_PREFIX = "RegInv Walk-in";
const ARRIVED_MESSAGE = "После отметки «Пришёл» отменить регистрацию нельзя";
const LATE_REG_MESSAGE = "Поздняя регистрация завершена — запись на турнир закрыта";

function pid(n: number): string {
  return `${PLAYER_PREFIX}${String(n).padStart(5, "0")}`;
}

const PENDING = Symbol("pending");

async function stillPending(promise: Promise<unknown>, ms = 300): Promise<boolean> {
  const winner = await Promise.race([
    promise.then(
      () => "settled",
      () => "settled"
    ),
    new Promise((resolve) => setTimeout(() => resolve(PENDING), ms)),
  ]);
  return winner === PENDING;
}

describePostgres("Registration invariants: arrival-cancel + Late Registration close (PostgreSQL)", () => {
  let client: Sql;
  let capacity: typeof import("@/features/tournament-waitlist-capacity");
  let tournaments: typeof import("@/features/tournaments");

  async function resetRows() {
    await client`DELETE FROM tournaments WHERE id = ${T1}::uuid`;
    await client`DELETE FROM players WHERE id::text LIKE ${PLAYER_PREFIX + "%"}`;
    await client`DELETE FROM players WHERE display_name LIKE ${WALK_IN_PREFIX + "%"}`;
  }

  async function createTournament(opts: { maxPlayers?: number } = {}) {
    await client`
      INSERT INTO tournaments (id, title, start_at, max_players, status, kind, is_final)
      VALUES (${T1}::uuid, 'Invariant Cup', ${new Date(Date.now() - 3600_000)},
              ${opts.maxPlayers ?? 40}, 'open', 'free', false)
    `;
  }

  async function createPlayers(from: number, to: number) {
    for (let n = from; n <= to; n++) {
      await client`INSERT INTO players (id, display_name) VALUES (${pid(n)}::uuid, ${"Player " + n})`;
    }
  }

  async function register(n: number, status: string) {
    const [row] = await client`
      INSERT INTO registrations (player_id, tournament_id, status, created_at)
      VALUES (${pid(n)}::uuid, ${T1}::uuid, ${status},
              ${new Date(Date.parse("2026-01-01T00:00:00Z") + n * 1000)})
      RETURNING id
    `;
    return row.id as string;
  }

  async function regRowsOf(n: number) {
    return client`
      SELECT id, status, created_at, no_show_at FROM registrations
      WHERE tournament_id = ${T1}::uuid AND player_id = ${pid(n)}::uuid ORDER BY created_at
    `;
  }

  async function attendanceOf(n: number) {
    const [row] = await client`
      SELECT arrived, arrived_at FROM tournament_attendance
      WHERE tournament_id = ${T1}::uuid AND player_id = ${pid(n)}::uuid
    `;
    return row as { arrived: boolean; arrived_at: Date | null } | undefined;
  }

  async function closeLateRegistrationDirect(sql: Sql = client) {
    await sql`
      INSERT INTO tournament_late_registration (
        tournament_id, arrived_players_count, initial_stacks_count, total_entries_count,
        rebuys_count, addons_count, tournament_type, rating_formula_version, rating_places
      ) VALUES (${T1}::uuid, 1, 1, 1, 0, 0, 'classic', 'v2', '[]'::jsonb)
    `;
  }

  async function walkInPlayers() {
    return client`SELECT id FROM players WHERE display_name LIKE ${WALK_IN_PREFIX + "%"}`;
  }

  async function seatLoad(): Promise<number> {
    const [row] = await client`
      SELECT count(*)::int AS n FROM registrations r
      WHERE r.tournament_id = ${T1}::uuid AND r.status IN ('registered','attended')
        AND NOT EXISTS (SELECT 1 FROM tournament_player_eliminations e
                        WHERE e.tournament_id = r.tournament_id AND e.player_id = r.player_id AND e.eliminated)
    `;
    return row.n as number;
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
    await resetRows();
  });

  afterEach(async () => {
    await resetRows();
  });

  afterAll(async () => {
    if (!client) return;
    await client.end();
  });

  // -------------------------------------------------------------------------
  // RULE 1 -- arrival closes self-cancellation (spec tests 1-5)
  // -------------------------------------------------------------------------

  it("1. registered + never arrived -> self-cancel works", async () => {
    await createTournament();
    await createPlayers(1, 1);
    await register(1, "registered");

    await tournaments.cancelPlayerRegistration(pid(1), T1);

    expect((await regRowsOf(1))[0].status).toBe("cancelled");
  });

  it("2 + 5. arrived_at != null -> self-cancel rejected, registration row byte-for-byte unchanged", async () => {
    await createTournament();
    await createPlayers(1, 1);
    await register(1, "registered");
    await tournaments.setTournamentPlayerAttendance(T1, pid(1), true);
    const before = await regRowsOf(1);

    await expect(tournaments.cancelPlayerRegistration(pid(1), T1)).rejects.toThrow(ARRIVED_MESSAGE);

    expect(await regRowsOf(1)).toEqual(before);
    expect(before[0].status).toBe("registered");
  });

  it("3. arrived, then busted out -> self-cancel still rejected", async () => {
    await createTournament();
    await createPlayers(1, 1);
    await register(1, "registered");
    await tournaments.setTournamentPlayerAttendance(T1, pid(1), true);
    await client`INSERT INTO tournament_player_eliminations (tournament_id, player_id, eliminated, eliminated_at)
                 VALUES (${T1}::uuid, ${pid(1)}::uuid, true, now())`;
    const before = await regRowsOf(1);

    await expect(tournaments.cancelPlayerRegistration(pid(1), T1)).rejects.toThrow(ARRIVED_MESSAGE);

    expect(await regRowsOf(1)).toEqual(before);
  });

  it("4. arrived later toggled to false (arrived_at kept) -> self-cancel still rejected", async () => {
    await createTournament();
    await createPlayers(1, 1);
    await register(1, "registered");
    await tournaments.setTournamentPlayerAttendance(T1, pid(1), true);
    await tournaments.setTournamentPlayerAttendance(T1, pid(1), false);
    const attendance = await attendanceOf(1);
    expect(attendance?.arrived).toBe(false);
    expect(attendance?.arrived_at).not.toBeNull();
    const before = await regRowsOf(1);

    await expect(tournaments.cancelPlayerRegistration(pid(1), T1)).rejects.toThrow(ARRIVED_MESSAGE);

    expect(await regRowsOf(1)).toEqual(before);
  });

  it("an attendance row with arrived=false and NO arrived_at (never arrived) does not block cancel", async () => {
    await createTournament();
    await createPlayers(1, 1);
    await register(1, "registered");
    await tournaments.setTournamentPlayerAttendance(T1, pid(1), false);

    await tournaments.cancelPlayerRegistration(pid(1), T1);

    expect((await regRowsOf(1))[0].status).toBe("cancelled");
  });

  it("race: an arrival write waits on the tournament-row lock (incl. the ON CONFLICT DO UPDATE path) -- it can't slip past a locked cancel decision", async () => {
    await createTournament();
    await createPlayers(1, 1);
    await register(1, "registered");
    // Existing attendance row (arrived=false, arrived_at NULL): the update
    // path that never took any FK lock on tournaments before this change.
    await tournaments.setTournamentPlayerAttendance(T1, pid(1), false);

    let arrival: Promise<unknown> | null = null;
    await client.begin(async (sql) => {
      await sql`SELECT id FROM tournaments WHERE id = ${T1}::uuid FOR UPDATE`;
      arrival = tournaments.setTournamentPlayerAttendance(T1, pid(1), true);
      expect(await stillPending(arrival)).toBe(true);
      expect((await attendanceOf(1))?.arrived_at ?? null).toBeNull();
    });
    await arrival;

    expect((await attendanceOf(1))?.arrived_at).not.toBeNull();
    await expect(tournaments.cancelPlayerRegistration(pid(1), T1)).rejects.toThrow(ARRIVED_MESSAGE);
    expect((await regRowsOf(1))[0].status).toBe("registered");
  });

  it("race: a cancel waiting on the lock re-reads arrived_at after acquiring it -- an arrival committed first wins and the cancel is refused", async () => {
    await createTournament();
    await createPlayers(1, 1);
    await register(1, "registered");
    const before = await regRowsOf(1);

    let cancel: Promise<unknown> | null = null;
    await client.begin(async (sql) => {
      await sql`SELECT id FROM tournaments WHERE id = ${T1}::uuid FOR UPDATE`;
      cancel = tournaments.cancelPlayerRegistration(pid(1), T1);
      cancel.catch(() => undefined);
      expect(await stillPending(cancel)).toBe(true);
      // Arrival commits while the cancel is still waiting for the lock.
      await sql`INSERT INTO tournament_attendance (tournament_id, player_id, arrived, arrived_at)
                VALUES (${T1}::uuid, ${pid(1)}::uuid, true, now())`;
    });

    await expect(cancel!).rejects.toThrow(ARRIVED_MESSAGE);
    expect(await regRowsOf(1)).toEqual(before);
  });

  it("concurrent arrivals and cancellations for many players: every refused cancel left an arrived player registered, every arrived-before-cancel player stays registered", async () => {
    await createTournament({ maxPlayers: 40 });
    await createPlayers(1, 20);
    for (let n = 1; n <= 20; n++) await register(n, "registered");
    // Players 1-10 arrive FIRST (committed), then everyone races arrival
    // writes for 11-20 against cancels for all 20.
    for (let n = 1; n <= 10; n++) await tournaments.setTournamentPlayerAttendance(T1, pid(n), true);

    const ops: Promise<unknown>[] = [];
    const cancelOutcome = new Map<number, "ok" | "refused">();
    for (let n = 1; n <= 20; n++) {
      if (n > 10) ops.push(tournaments.setTournamentPlayerAttendance(T1, pid(n), true));
      ops.push(
        tournaments.cancelPlayerRegistration(pid(n), T1).then(
          () => cancelOutcome.set(n, "ok"),
          (error: Error) => {
            expect(error.message).toBe(ARRIVED_MESSAGE);
            cancelOutcome.set(n, "refused");
          }
        )
      );
    }
    await Promise.all(ops);

    for (let n = 1; n <= 10; n++) {
      expect(cancelOutcome.get(n)).toBe("refused");
      expect((await regRowsOf(n))[0].status).toBe("registered");
    }
    for (let n = 11; n <= 20; n++) {
      const status = (await regRowsOf(n))[0].status;
      // Serialized by the lock: either the arrival won (cancel refused,
      // still registered) or the cancel won (a legitimate pre-arrival
      // cancellation). Never "refused but cancelled" or "ok but registered".
      expect(status).toBe(cancelOutcome.get(n) === "refused" ? "registered" : "cancelled");
    }
  });

  // -------------------------------------------------------------------------
  // RULE 2 -- Late Registration close freezes the field (spec tests 6-12)
  // -------------------------------------------------------------------------

  it("6. Late Reg open -> ordinary registration works as before (registered, then waitlist when full)", async () => {
    await createTournament({ maxPlayers: 1 });
    await createPlayers(1, 2);

    expect((await tournaments.registerPlayerForTournament(pid(1), T1)).status).toBe("registered");
    expect((await tournaments.registerPlayerForTournament(pid(2), T1)).status).toBe("waitlist");
  });

  it("7. Late Reg closed + new player -> rejected; neither a registered nor a waitlist row appears", async () => {
    await createTournament();
    await createPlayers(1, 1);
    await closeLateRegistrationDirect();

    await expect(tournaments.registerPlayerForTournament(pid(1), T1)).rejects.toThrow(LATE_REG_MESSAGE);
    await expect(capacity.admitPlayerToTournament(T1, pid(1))).rejects.toThrow(LATE_REG_MESSAGE);

    expect(await regRowsOf(1)).toHaveLength(0);
  });

  it("8. Late Reg closed + cancelled row -> not reactivated", async () => {
    await createTournament();
    await createPlayers(1, 1);
    await register(1, "cancelled");
    await closeLateRegistrationDirect();
    const before = await regRowsOf(1);

    await expect(tournaments.registerPlayerForTournament(pid(1), T1)).rejects.toThrow(LATE_REG_MESSAGE);

    expect(await regRowsOf(1)).toEqual(before);
    expect(before[0].status).toBe("cancelled");
  });

  it("9. Late Reg closed + admin add existing player -> rejected (also a cancelled one)", async () => {
    await createTournament();
    await createPlayers(1, 2);
    await register(2, "cancelled");
    await closeLateRegistrationDirect();

    await expect(tournaments.addExistingPlayerToTournament(T1, pid(1))).rejects.toThrow(LATE_REG_MESSAGE);
    await expect(tournaments.addExistingPlayerToTournament(T1, pid(2))).rejects.toThrow(LATE_REG_MESSAGE);

    expect(await regRowsOf(1)).toHaveLength(0);
    expect((await regRowsOf(2))[0].status).toBe("cancelled");
  });

  it("10. Late Reg closed + admin add new nickname -> rejected AND no orphan player is created", async () => {
    await createTournament();
    await closeLateRegistrationDirect();

    await expect(
      tournaments.addAdminTournamentParticipant(T1, `${WALK_IN_PREFIX} 10`)
    ).rejects.toThrow(LATE_REG_MESSAGE);

    expect(await walkInPlayers()).toHaveLength(0);
    const [count] = await client`SELECT count(*)::int AS n FROM registrations WHERE tournament_id = ${T1}::uuid`;
    expect(count.n).toBe(0);
  });

  it("10b. Late Reg open -> admin add new nickname still creates player + registered row", async () => {
    await createTournament();

    await tournaments.addAdminTournamentParticipant(T1, `${WALK_IN_PREFIX} 10b`);

    const created = await walkInPlayers();
    expect(created).toHaveLength(1);
    const [row] = await client`SELECT status FROM registrations WHERE tournament_id = ${T1}::uuid AND player_id = ${created[0].id}::uuid`;
    expect(row.status).toBe("registered");
  });

  it("race: Late Registration closing while a walk-in add and a self-registration wait on the lock -> both refused, no orphan player, no row", async () => {
    await createTournament();
    await createPlayers(1, 1);

    let walkIn: Promise<unknown> | null = null;
    let selfRegister: Promise<unknown> | null = null;
    await client.begin(async (sql) => {
      await sql`SELECT id FROM tournaments WHERE id = ${T1}::uuid FOR UPDATE`;
      walkIn = tournaments.addAdminTournamentParticipant(T1, `${WALK_IN_PREFIX} race`);
      selfRegister = tournaments.registerPlayerForTournament(pid(1), T1);
      walkIn.catch(() => undefined);
      selfRegister.catch(() => undefined);
      expect(await stillPending(walkIn)).toBe(true);
      expect(await stillPending(selfRegister)).toBe(true);
      // Close Late Registration the way features/late-registration.ts
      // does: under the tournament-row lock, then commit.
      await closeLateRegistrationDirect(sql as unknown as Sql);
    });

    await expect(walkIn!).rejects.toThrow(LATE_REG_MESSAGE);
    await expect(selfRegister!).rejects.toThrow(LATE_REG_MESSAGE);
    expect(await walkInPlayers()).toHaveLength(0);
    expect(await regRowsOf(1)).toHaveLength(0);
  });

  it("11. existing registered/attended/waitlist rows are untouched; a not-yet-arrived player may still cancel after close", async () => {
    await createTournament({ maxPlayers: 3 });
    await createPlayers(1, 5);
    await register(1, "registered");
    await register(2, "attended");
    await register(3, "registered");
    await register(4, "waitlist");
    await closeLateRegistrationDirect();
    const before = await client`SELECT id, player_id, status, created_at, no_show_at FROM registrations
                                WHERE tournament_id = ${T1}::uuid ORDER BY created_at`;

    // Re-registering existing rows returns them unchanged (no throw).
    expect((await tournaments.registerPlayerForTournament(pid(1), T1)).status).toBe("registered");
    expect((await tournaments.registerPlayerForTournament(pid(4), T1)).status).toBe("waitlist");
    // A rejected newcomer changes nothing for anyone else.
    await expect(tournaments.registerPlayerForTournament(pid(5), T1)).rejects.toThrow(LATE_REG_MESSAGE);

    const after = await client`SELECT id, player_id, status, created_at, no_show_at FROM registrations
                               WHERE tournament_id = ${T1}::uuid ORDER BY created_at`;
    expect(after).toEqual(before);

    // Pre-arrival cancellation is still allowed after close.
    await tournaments.cancelPlayerRegistration(pid(3), T1);
    expect((await regRowsOf(3))[0].status).toBe("cancelled");
    // ...and the freed seat does NOT go to the waitlist after close.
    expect((await regRowsOf(4))[0].status).toBe("waitlist");
  });

  it("12. existing waitlist still never auto-promotes and still can't be staff-admitted after close (unchanged behavior)", async () => {
    await createTournament({ maxPlayers: 2 });
    await createPlayers(1, 3);
    await register(1, "registered");
    await register(2, "registered");
    const waitlistReg = await register(3, "waitlist");
    await closeLateRegistrationDirect();
    await client`INSERT INTO tournament_player_eliminations (tournament_id, player_id, eliminated, eliminated_at)
                 VALUES (${T1}::uuid, ${pid(1)}::uuid, true, now())`;

    const reconciliation = await capacity.reconcileTournamentWaitlistCapacity(T1);
    expect(reconciliation.promotedPlayerIds).toEqual([]);
    await expect(capacity.admitWaitlistedRegistrationWithinCapacity(T1, waitlistReg)).rejects.toThrow(
      "Поздняя регистрация закрыта — допуск из листа ожидания невозможен"
    );

    expect((await regRowsOf(3))[0].status).toBe("waitlist");
    expect(await seatLoad()).toBe(1);
  });
});
