import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres, { type Sql } from "postgres";

// Broadcast idempotency for POST /api/admin/tournaments/notify against a
// REAL PostgreSQL database: real route handler, real feature module, real
// Postgres repository, real unique index. Only the recipient lookup is
// mocked and the Telegram HTTP call is a stubbed global fetch -- NO real
// Telegram message is ever sent. LOCAL TEST DATA ONLY.
//
//   createdb reraise_notify_test
//   DATABASE_URL=postgres://user@127.0.0.1:5432/reraise_notify_test npm run db:migrate
//   NOTIFY_BROADCAST_POSTGRES_TEST_URL=postgres://user@127.0.0.1:5432/reraise_notify_test \
//     npx vitest run features/__tests__/notify-broadcast-idempotency.postgres.integration.test.ts
const TEST_DATABASE_URL = process.env.NOTIFY_BROADCAST_POSTGRES_TEST_URL;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;

function assertSafeTestDatabaseUrl(value: string): void {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.includes("test")) {
    throw new Error("Notify broadcast integration tests require a localhost test database");
  }
}

const T1 = "98000000-0000-4000-8000-0000000000a1";
const MESSAGE = "Integration broadcast text";
const TOKEN = "000000:INTEGRATION-FAKE-TOKEN";

const mocks = vi.hoisted(() => ({
  recipients: [] as Array<{ player_id: string; telegram_id: number | null; display_name: string }>,
}));

vi.mock("@/features/tournaments", () => ({
  getTournamentById: vi.fn(async (id: string) => ({ id, title: "Integration Cup", kind: "free" })),
  getTournamentNotificationRecipientsByAudience: vi.fn(async () => mocks.recipients),
}));

function bid(n: number): string {
  return `98000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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

describePostgres("Notify broadcast idempotency (PostgreSQL)", () => {
  let client: Sql;
  let route: typeof import("@/app/api/admin/tournaments/notify/route");
  let repo: typeof import("@/lib/repositories/tournament-notification-broadcast");
  let feature: typeof import("@/features/tournament-notification-broadcast");
  const telegramFetch = vi.fn();
  const sends = () => telegramFetch.mock.calls.filter(([url]) => String(url).includes("/sendMessage"));

  function post(body: Record<string, unknown>) {
    return route.POST(
      new Request("http://localhost/api/admin/tournaments/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  }

  const base = { tournamentId: T1, message: MESSAGE, audience: "registered" };

  async function rows() {
    return client`
      SELECT broadcast_id::text, status, total_recipients, success_count, failed_count, skipped_count,
             errors, test_mode, audience, payload_fingerprint, completed_at
      FROM tournament_notification_broadcasts WHERE tournament_id = ${T1}::uuid ORDER BY created_at
    `;
  }

  function claimData(broadcastId: string) {
    return {
      broadcast_id: broadcastId,
      payload_fingerprint: "f".repeat(64),
      tournament_id: T1,
      audience: "registered" as const,
      test_mode: false,
      total_recipients: 3,
      skipped_count: 0,
    };
  }

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(TEST_DATABASE_URL!);
    process.env.DATABASE_PROVIDER = "postgres";
    process.env.DATABASE_URL = TEST_DATABASE_URL!;
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "integration-test-dummy";
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    client = postgres(TEST_DATABASE_URL!, { max: 5, onnotice: () => {} });
    route = await import("@/app/api/admin/tournaments/notify/route");
    repo = await import("@/lib/repositories/tournament-notification-broadcast");
    feature = await import("@/features/tournament-notification-broadcast");
    await client`DELETE FROM tournaments WHERE id = ${T1}::uuid`;
    await client`
      INSERT INTO tournaments (id, title, start_at, max_players, status, kind, is_final)
      VALUES (${T1}::uuid, 'Integration Cup', now(), 40, 'open', 'free', false)
    `;
  });

  beforeEach(() => {
    mocks.recipients = [
      { player_id: "p1", telegram_id: 501, display_name: "One" },
      { player_id: "p2", telegram_id: 502, display_name: "Two" },
      { player_id: "p3", telegram_id: 503, display_name: "Three" },
    ];
    telegramFetch.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", telegramFetch);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await client`DELETE FROM tournament_notification_broadcasts WHERE tournament_id = ${T1}::uuid`;
  });

  afterAll(async () => {
    if (!client) return;
    await client`DELETE FROM tournaments WHERE id = ${T1}::uuid`;
    await client.end();
  });

  // ---------------------------------------------------------------------
  // [13] the claim mechanism itself, raced at the SQL level
  // ---------------------------------------------------------------------

  it("[13] two concurrent transactions: the second INSERT blocks on the unique index, then claims nothing", async () => {
    const id = bid(1);
    let releaseTx1!: () => void;
    const tx1Hold = new Promise<void>((r) => (releaseTx1 = r));
    let tx1Inserted!: () => void;
    const tx1HasInserted = new Promise<void>((r) => (tx1Inserted = r));

    const tx1 = client.begin(async (sql) => {
      const r = await sql`
        INSERT INTO tournament_notification_broadcasts (broadcast_id, payload_fingerprint, tournament_id, audience)
        VALUES (${id}::uuid, 'a', ${T1}::uuid, 'registered')
        ON CONFLICT (broadcast_id) DO NOTHING RETURNING id`;
      tx1Inserted();
      await tx1Hold;
      return r.length;
    });
    await tx1HasInserted;

    const tx2 = client.begin(async (sql) => {
      const r = await sql`
        INSERT INTO tournament_notification_broadcasts (broadcast_id, payload_fingerprint, tournament_id, audience)
        VALUES (${id}::uuid, 'b', ${T1}::uuid, 'registered')
        ON CONFLICT (broadcast_id) DO NOTHING RETURNING id`;
      return r.length;
    });

    // tx2 really waits on tx1's uncommitted unique-index entry...
    expect(await stillPending(tx2)).toBe(true);
    releaseTx1();

    // ...and once tx1 commits, tx2's insert is a no-op: exactly one claimant.
    expect(await tx1).toBe(1);
    expect(await tx2).toBe(0);
    const stored = await client`SELECT payload_fingerprint FROM tournament_notification_broadcasts WHERE broadcast_id = ${id}::uuid`;
    expect(stored.map((r) => r.payload_fingerprint)).toEqual(["a"]);
  });

  it("[13] if the first claimant's transaction rolls back, the waiting one claims instead (no lost claim)", async () => {
    const id = bid(2);
    let releaseTx1!: () => void;
    const tx1Hold = new Promise<void>((r) => (releaseTx1 = r));
    let tx1Inserted!: () => void;
    const tx1HasInserted = new Promise<void>((r) => (tx1Inserted = r));

    const tx1 = client
      .begin(async (sql) => {
        await sql`
          INSERT INTO tournament_notification_broadcasts (broadcast_id, payload_fingerprint, tournament_id, audience)
          VALUES (${id}::uuid, 'a', ${T1}::uuid, 'registered')
          ON CONFLICT (broadcast_id) DO NOTHING`;
        tx1Inserted();
        await tx1Hold;
        throw new Error("rollback");
      })
      .catch((e: Error) => e.message);
    await tx1HasInserted;

    const tx2 = client`
      INSERT INTO tournament_notification_broadcasts (broadcast_id, payload_fingerprint, tournament_id, audience)
      VALUES (${id}::uuid, 'b', ${T1}::uuid, 'registered')
      ON CONFLICT (broadcast_id) DO NOTHING RETURNING id`.then((r) => r.length);

    expect(await stillPending(tx2)).toBe(true);
    releaseTx1();
    expect(await tx1).toBe("rollback");
    expect(await tx2).toBe(1);
  });

  it("[13] 25 concurrent repository.claim() calls for one broadcastId -> exactly ONE claimed", async () => {
    const id = bid(3);
    const results = await Promise.all(
      Array.from({ length: 25 }, () => repo.tournamentNotificationBroadcastRepository.claim(claimData(id)))
    );

    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    const losers = results.filter((r) => !r.claimed);
    expect(losers).toHaveLength(24);
    for (const l of losers) {
      expect(!l.claimed && l.existing.broadcast_id).toBe(id);
    }
    const [{ n }] = await client`SELECT count(*)::int AS n FROM tournament_notification_broadcasts WHERE broadcast_id = ${id}::uuid`;
    expect(n).toBe(1);
  });

  // ---------------------------------------------------------------------
  // route-level scenarios on real Postgres
  // ---------------------------------------------------------------------

  it("[6][14] first broadcastId claims, sends to each recipient once, persists completed counts", async () => {
    telegramFetch.mockImplementation(async (_u: string, init: RequestInit) =>
      JSON.parse(init.body as string).chat_id === 503
        ? new Response("Bad Request: chat not found", { status: 400 })
        : new Response("{}", { status: 200 })
    );

    const res = await post({ ...base, broadcastId: bid(10) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ status: "completed", successCount: 2, failedCount: 1, totalRecipients: 3 });
    expect(sends()).toHaveLength(3);
    const [row] = await rows();
    expect(row).toMatchObject({
      broadcast_id: bid(10),
      status: "completed",
      total_recipients: 3,
      success_count: 2,
      failed_count: 1,
      skipped_count: 0,
      test_mode: false,
      audience: "registered",
    });
    expect(row.errors).toEqual([{ player_id: "p3", telegram_id: 503, display_name: "Three", error: "chat not found" }]);
    expect(row.completed_at).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain(MESSAGE);
    expect(JSON.stringify(row)).not.toContain("INTEGRATION-FAKE-TOKEN");
  });

  it("[7][15] 10 concurrent requests with one broadcastId: the send loop runs exactly once; duplicates return fast", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    telegramFetch.mockImplementation(async () => {
      await gate;
      return new Response("{}", { status: 200 });
    });

    // All fired at once, so several pass the read-only pre-check together
    // and the unique-index claim is what actually arbitrates.
    const requests = Array.from({ length: 10 }, () => post({ ...base, broadcastId: bid(11) }));

    await vi.waitFor(() => expect(sends().length).toBe(1));
    // Exactly one request is stuck in the send loop; the other 9 must have
    // answered WITHOUT waiting for it.
    const settled = await Promise.all(requests.map((p) => stillPending(p, 500)));
    expect(settled.filter((pending) => pending)).toHaveLength(1);

    const pendingIndex = settled.indexOf(true);
    const duplicates = await Promise.all(requests.filter((_, i) => i !== pendingIndex));
    for (const d of duplicates) {
      expect(d.status).toBe(202);
      expect(await d.json()).toMatchObject({ duplicate: "already_processing", status: "processing" });
    }
    expect(sends()).toHaveLength(1);
    const [midRow] = await rows();
    expect(midRow.status).toBe("processing");

    release();
    const winner = await requests[pendingIndex];
    expect(winner.status).toBe(200);
    expect(sends()).toHaveLength(3);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: "completed", success_count: 3 });
  });

  it("[8] same broadcastId after completion -> no sends, stored result returned", async () => {
    await post({ ...base, broadcastId: bid(12) });
    telegramFetch.mockClear();

    const res = await post({ ...base, broadcastId: bid(12) });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      duplicate: "already_completed",
      status: "completed",
      successCount: 3,
      failedCount: 0,
      totalRecipients: 3,
    });
    expect(sends()).toHaveLength(0);
  });

  it("[9] same broadcastId + changed payload -> 409, nothing sent, row unchanged", async () => {
    await post({ ...base, broadcastId: bid(13) });
    const before = await rows();
    telegramFetch.mockClear();

    const res = await post({ ...base, message: MESSAGE + " v2", broadcastId: bid(13) });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("broadcast_id_conflict");
    expect(sends()).toHaveLength(0);
    expect(await rows()).toEqual(before);
  });

  it("[9] mismatch is enforced at the claim too (pre-check bypassed)", async () => {
    await repo.tournamentNotificationBroadcastRepository.claim(claimData(bid(14)));

    const outcome = await feature.runTournamentBroadcast({
      broadcastId: bid(14),
      payload: { tournamentId: T1, audience: "registered", message: MESSAGE, testMode: false, testTelegramId: null },
      recipients: mocks.recipients,
      skippedCount: 0,
      send: async () => {
        throw new Error("must not send");
      },
    });

    expect(outcome.kind).toBe("fingerprint_mismatch");
  });

  it("[10] different broadcastId + identical payload -> both sent, two rows", async () => {
    const r1 = await post({ ...base, broadcastId: bid(15) });
    const r2 = await post({ ...base, broadcastId: bid(16) });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(sends()).toHaveLength(6);
    const all = await rows();
    expect(all.map((r) => r.status)).toEqual(["completed", "completed"]);
    expect(all[0].payload_fingerprint).toBe(all[1].payload_fingerprint);
  });

  it("[11] dry run creates no durable row (with or without a broadcastId)", async () => {
    await post({ ...base, dryRun: true });
    await post({ ...base, dryRun: true, broadcastId: bid(17) });

    expect(await rows()).toHaveLength(0);
    expect(sends()).toHaveLength(0);
  });

  it("[12] real send with missing/invalid broadcastId -> 400, no row", async () => {
    expect((await post({ ...base })).status).toBe(400);
    expect((await post({ ...base, broadcastId: "not-a-uuid" })).status).toBe(400);
    expect((await post({ ...base, testMode: true, testTelegramId: "501" })).status).toBe(400);

    expect(await rows()).toHaveLength(0);
    expect(sends()).toHaveLength(0);
  });

  it("[15] unexpected failure mid-loop -> row 'failed' with partial counts, repeat never re-sends", async () => {
    let n = 0;
    await expect(
      feature.runTournamentBroadcast({
        broadcastId: bid(18),
        payload: { tournamentId: T1, audience: "registered", message: MESSAGE, testMode: false, testTelegramId: null },
        recipients: mocks.recipients,
        skippedCount: 0,
        send: async () => {
          n += 1;
          if (n === 3) throw new Error("boom");
          return { ok: true };
        },
      })
    ).rejects.toThrow("boom");

    const [row] = await rows();
    expect(row).toMatchObject({ status: "failed", success_count: 2, failed_count: 0 });
    expect(row.completed_at).not.toBeNull();

    const res = await post({ ...base, broadcastId: bid(18) });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("broadcast_failed");
    expect(sends()).toHaveLength(0);
  });

  it("[15] a row left 'processing' (crashed process) is never re-sent", async () => {
    const fingerprint = feature.computeBroadcastFingerprint({
      tournamentId: T1,
      audience: "registered",
      message: MESSAGE,
      testMode: false,
      testTelegramId: null,
    });
    await repo.tournamentNotificationBroadcastRepository.claim({ ...claimData(bid(19)), payload_fingerprint: fingerprint });

    const res = await post({ ...base, broadcastId: bid(19) });

    expect(res.status).toBe(202);
    expect((await res.json()).duplicate).toBe("already_processing");
    expect(sends()).toHaveLength(0);
  });

  it("finished rows are never rewritten (markCompleted only transitions 'processing')", async () => {
    await post({ ...base, broadcastId: bid(20) });

    const changed = await repo.tournamentNotificationBroadcastRepository.markFailed(bid(20), {
      success_count: 0,
      failed_count: 99,
      skipped_count: 0,
      errors: [],
    });

    expect(changed).toBe(false);
    expect((await rows())[0]).toMatchObject({ status: "completed", success_count: 3, failed_count: 0 });
  });

  it("Test Send: idempotent and scoped to the test recipient", async () => {
    const body = { ...base, testMode: true, testTelegramId: "502", broadcastId: bid(21) };
    const r1 = await post(body);
    const r2 = await post(body);

    expect(r1.status).toBe(200);
    expect((await r2.json()).duplicate).toBe("already_completed");
    expect(sends()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ test_mode: true, total_recipients: 1, success_count: 1 });
  });
});
