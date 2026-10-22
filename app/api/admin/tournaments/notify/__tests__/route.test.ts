// POST /api/admin/tournaments/notify -- broadcast idempotency (unit level).
// Recipient lookup mocked, Telegram fetch stubbed (NO real Telegram call),
// the broadcast ledger replaced by an in-memory fake with the same
// claim-once semantics as the unique index. The same scenarios against a
// REAL Postgres (including the true concurrent claim race) live in
// features/__tests__/notify-broadcast-idempotency.postgres.integration.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type {
  TournamentNotificationBroadcastClaim,
  TournamentNotificationBroadcastCounts,
  TournamentNotificationBroadcastRow,
} from "@/lib/repositories";

const TOKEN = "123456:SECRET-BOT-TOKEN";
const MESSAGE = "Секретный текст рассылки 42";
const B1 = "11111111-1111-4111-8111-111111111111";
const B2 = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  rows: new Map<string, TournamentNotificationBroadcastRow>(),
  recipients: [] as Array<{ player_id: string; telegram_id: number | null; display_name: string }>,
  claim: vi.fn(),
  findByBroadcastId: vi.fn(),
  markCompleted: vi.fn(),
  markFailed: vi.fn(),
}));

vi.mock("@/features/tournaments", () => ({
  getTournamentById: vi.fn(async (id: string) => ({ id, title: "Friday Cup", kind: "free" })),
  getTournamentNotificationRecipientsByAudience: vi.fn(async () => mocks.recipients),
}));

vi.mock("@/lib/repositories", () => ({
  tournamentNotificationBroadcastRepository: {
    claim: mocks.claim,
    findByBroadcastId: mocks.findByBroadcastId,
    markCompleted: mocks.markCompleted,
    markFailed: mocks.markFailed,
  },
}));

const { POST } = await import("@/app/api/admin/tournaments/notify/route");
const broadcast = await import("@/features/tournament-notification-broadcast");

function installFakeRepository() {
  mocks.rows.clear();
  mocks.findByBroadcastId.mockReset().mockImplementation(async (id: string) => mocks.rows.get(id) ?? null);
  // Check-and-set in one synchronous step: the in-memory equivalent of
  // INSERT ... ON CONFLICT DO NOTHING on a unique index.
  mocks.claim.mockReset().mockImplementation(async (data: TournamentNotificationBroadcastClaim) => {
    const existing = mocks.rows.get(data.broadcast_id);
    if (existing) return { claimed: false, existing };
    const row: TournamentNotificationBroadcastRow = {
      id: `row-${mocks.rows.size + 1}`,
      broadcast_id: data.broadcast_id,
      payload_fingerprint: data.payload_fingerprint,
      tournament_id: data.tournament_id,
      audience: data.audience,
      test_mode: data.test_mode,
      status: "processing",
      total_recipients: data.total_recipients,
      success_count: 0,
      failed_count: 0,
      skipped_count: data.skipped_count,
      errors: [],
      created_at: new Date().toISOString(),
      completed_at: null,
    };
    mocks.rows.set(data.broadcast_id, row);
    return { claimed: true, row };
  });
  const finish = (status: "completed" | "failed") => async (id: string, c: TournamentNotificationBroadcastCounts) => {
    const row = mocks.rows.get(id);
    if (!row || row.status !== "processing") return false;
    Object.assign(row, {
      status,
      success_count: c.success_count,
      failed_count: c.failed_count,
      skipped_count: c.skipped_count,
      errors: [...c.errors],
      completed_at: new Date().toISOString(),
    });
    return true;
  };
  mocks.markCompleted.mockReset().mockImplementation(finish("completed"));
  mocks.markFailed.mockReset().mockImplementation(finish("failed"));
}

const telegramFetch = vi.fn();
const sendMessageCalls = () => telegramFetch.mock.calls.filter(([url]) => String(url).includes("/sendMessage"));

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/admin/tournaments/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const base = { tournamentId: "t-1", message: MESSAGE, audience: "registered" };

let infoSpy: MockInstance<typeof console.info>;
let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  installFakeRepository();
  mocks.recipients = [
    { player_id: "p1", telegram_id: 1001, display_name: "One" },
    { player_id: "p2", telegram_id: 1002, display_name: "Two" },
    { player_id: "p3", telegram_id: 1003, display_name: "Three" },
  ];
  telegramFetch.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", telegramFetch);
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("[12] real send without a valid broadcastId fails closed", () => {
  it.each([
    ["missing", {}],
    ["not a uuid", { broadcastId: "abc" }],
    ["number", { broadcastId: 42 }],
    ["empty", { broadcastId: "  " }],
  ])("mass send, broadcastId %s -> 400, nothing sent, nothing claimed", async (_label, extra) => {
    const res = await post({ ...base, ...extra });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("broadcast_id_required");
    expect(sendMessageCalls()).toHaveLength(0);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("Test Send without broadcastId -> 400, nothing sent", async () => {
    const res = await post({ ...base, testMode: true, testTelegramId: "1001" });

    expect(res.status).toBe(400);
    expect(sendMessageCalls()).toHaveLength(0);
  });
});

describe("[11] dry run creates no durable broadcast row", () => {
  it.each([
    ["without broadcastId", {}],
    ["even with a broadcastId", { broadcastId: B1 }],
  ])("%s", async (_label, extra) => {
    const res = await post({ ...base, dryRun: true, ...extra });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ dryRun: true, totalRecipients: 3 });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.findByBroadcastId).not.toHaveBeenCalled();
    expect(mocks.rows.size).toBe(0);
    expect(sendMessageCalls()).toHaveLength(0);
  });
});

describe("idempotent real send", () => {
  it("[6][14] first broadcastId claims, sends once per recipient, persists the counts", async () => {
    telegramFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const { chat_id } = JSON.parse(init.body as string);
      return chat_id === 1002
        ? new Response("Forbidden: bot was blocked by the user", { status: 403 })
        : new Response("{}", { status: 200 });
    });

    const res = await post({ ...base, broadcastId: B1 });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      broadcastId: B1,
      status: "completed",
      totalRecipients: 3,
      successCount: 2,
      failedCount: 1,
      skippedCount: 0,
    });
    expect(json.errors).toEqual([
      { player_id: "p2", telegram_id: 1002, display_name: "Two", error: "bot was blocked by user" },
    ]);
    expect(sendMessageCalls()).toHaveLength(3);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.rows.get(B1)).toMatchObject({ status: "completed", success_count: 2, failed_count: 1 });
    expect(mocks.rows.get(B1)?.completed_at).not.toBeNull();
  });

  it("[8] same broadcastId after completion -> no sends, the stored result is returned", async () => {
    await post({ ...base, broadcastId: B1 });
    telegramFetch.mockClear();

    const res = await post({ ...base, broadcastId: B1 });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      duplicate: "already_completed",
      status: "completed",
      broadcastId: B1,
      totalRecipients: 3,
      successCount: 3,
      failedCount: 0,
    });
    expect(sendMessageCalls()).toHaveLength(0);
  });

  it("[7][15] same broadcastId while the first is still sending -> fast 202 already_processing, loop runs once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    telegramFetch.mockImplementation(async () => {
      await gate;
      return new Response("{}", { status: 200 });
    });

    const first = post({ ...base, broadcastId: B1 });
    await vi.waitFor(() => expect(sendMessageCalls().length).toBeGreaterThan(0));

    // The first request is blocked mid-loop; the duplicate must NOT wait for it.
    const second = await post({ ...base, broadcastId: B1 });
    const secondJson = await second.json();

    expect(second.status).toBe(202);
    expect(secondJson).toMatchObject({ ok: false, duplicate: "already_processing", status: "processing" });
    expect(sendMessageCalls()).toHaveLength(1);

    release();
    const firstRes = await first;
    expect(firstRes.status).toBe(200);
    expect(sendMessageCalls()).toHaveLength(3);
  });

  it("[7] duplicate that loses the claim race (pre-check saw nothing) is still turned away", async () => {
    // Simulate: both requests passed the fast pre-check before either claimed.
    mocks.findByBroadcastId.mockResolvedValue(null);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    telegramFetch.mockImplementation(async () => {
      await gate;
      return new Response("{}", { status: 200 });
    });

    const first = post({ ...base, broadcastId: B1 });
    await vi.waitFor(() => expect(sendMessageCalls().length).toBeGreaterThan(0));
    const second = await post({ ...base, broadcastId: B1 });

    expect(second.status).toBe(202);
    expect((await second.json()).duplicate).toBe("already_processing");
    release();
    await first;
    expect(sendMessageCalls()).toHaveLength(3);
    expect(mocks.claim).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["message", { message: MESSAGE + "!" }],
    ["audience", { audience: "access" }],
    ["tournamentId", { tournamentId: "t-2" }],
  ])("[9] same broadcastId + changed %s -> 409, nothing sent", async (_label, change) => {
    await post({ ...base, broadcastId: B1 });
    telegramFetch.mockClear();

    const res = await post({ ...base, ...change, broadcastId: B1 });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("broadcast_id_conflict");
    expect(sendMessageCalls()).toHaveLength(0);
  });

  it("[9] Test Send: same broadcastId + different testTelegramId -> 409", async () => {
    await post({ ...base, testMode: true, testTelegramId: "1001", broadcastId: B1 });
    telegramFetch.mockClear();

    const res = await post({ ...base, testMode: true, testTelegramId: "1002", broadcastId: B1 });

    expect(res.status).toBe(409);
    expect(sendMessageCalls()).toHaveLength(0);
  });

  it("[9] a test-send id reused for a mass send -> 409", async () => {
    await post({ ...base, testMode: true, testTelegramId: "1001", broadcastId: B1 });
    telegramFetch.mockClear();

    const res = await post({ ...base, broadcastId: B1 });

    expect(res.status).toBe(409);
    expect(sendMessageCalls()).toHaveLength(0);
  });

  it("[10] different broadcastId + identical payload -> both are sent (no content-based dedupe)", async () => {
    const r1 = await post({ ...base, broadcastId: B1 });
    const r2 = await post({ ...base, broadcastId: B2 });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect((await r2.json()).duplicate).toBeUndefined();
    expect(sendMessageCalls()).toHaveLength(6);
  });

  it("Test Send: sends only to the test recipient, idempotent on repeat", async () => {
    const r1 = await post({ ...base, testMode: true, testTelegramId: "1002", broadcastId: B1 });
    const r2 = await post({ ...base, testMode: true, testTelegramId: "1002", broadcastId: B1 });

    expect(r1.status).toBe(200);
    expect((await r2.json()).duplicate).toBe("already_completed");
    expect(sendMessageCalls()).toHaveLength(1);
    expect(JSON.parse(sendMessageCalls()[0][1].body).chat_id).toBe(1002);
  });

  it("Test Send with a recipient outside the audience -> 404 and no row", async () => {
    const res = await post({ ...base, testMode: true, testTelegramId: "999", broadcastId: B1 });

    expect(res.status).toBe(404);
    expect(mocks.rows.size).toBe(0);
  });
});

describe("[15] failure semantics: a non-completed batch is never re-sent", () => {
  it("unexpected failure mid-loop -> row 'failed' with partial counts; a repeat sends nothing (409)", async () => {
    let n = 0;
    await expect(
      broadcast.runTournamentBroadcast({
        broadcastId: B1,
        payload: { tournamentId: "t-1", audience: "registered", message: MESSAGE, testMode: false, testTelegramId: null },
        recipients: mocks.recipients,
        skippedCount: 0,
        send: async () => {
          n += 1;
          if (n === 2) throw new Error("process blew up");
          return { ok: true };
        },
      })
    ).rejects.toThrow("process blew up");

    expect(mocks.rows.get(B1)).toMatchObject({ status: "failed", success_count: 1, failed_count: 0 });

    const res = await post({ ...base, broadcastId: B1 });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("broadcast_failed");
    expect(sendMessageCalls()).toHaveLength(0);
  });

  it("crashed mid-loop (row left 'processing' forever) -> repeat gets already_processing, sends nothing", async () => {
    const fingerprint = broadcast.computeBroadcastFingerprint({
      tournamentId: "t-1",
      audience: "registered",
      message: MESSAGE,
      testMode: false,
      testTelegramId: null,
    });
    await mocks.claim({
      broadcast_id: B1,
      payload_fingerprint: fingerprint,
      tournament_id: "t-1",
      audience: "registered",
      test_mode: false,
      total_recipients: 3,
      skipped_count: 0,
    });

    const res = await post({ ...base, broadcastId: B1 });

    expect(res.status).toBe(202);
    expect((await res.json()).duplicate).toBe("already_processing");
    expect(sendMessageCalls()).toHaveLength(0);
  });

  it("completion bookkeeping failure after a finished loop -> truthful live result, row stays processing", async () => {
    mocks.markCompleted.mockRejectedValueOnce(new Error("db down"));

    const res = await post({ ...base, broadcastId: B1 });
    expect(res.status).toBe(200);
    expect((await res.json()).successCount).toBe(3);
    expect(mocks.rows.get(B1)?.status).toBe("processing");

    telegramFetch.mockClear();
    const again = await post({ ...base, broadcastId: B1 });
    expect(again.status).toBe(202);
    expect(sendMessageCalls()).toHaveLength(0);
  });
});

describe("observability", () => {
  it("logs start/duplicate/complete categorically, never the message, token or Telegram ids", async () => {
    await post({ ...base, broadcastId: B1 });
    await post({ ...base, broadcastId: B1 });

    const logged = [...infoSpy.mock.calls, ...errorSpy.mock.calls];
    const labels = logged.map((args) => args[0]);
    expect(labels).toContain("[notify-broadcast] start");
    expect(labels).toContain("[notify-broadcast] duplicate");
    expect(labels).toContain("[notify-broadcast] complete");

    const start = infoSpy.mock.calls.find((a) => a[0] === "[notify-broadcast] start")![1];
    expect(start).toEqual({ broadcastId: B1, tournamentId: "t-1", audience: "registered", testMode: false, recipientCount: 3 });
    const dup = infoSpy.mock.calls.find((a) => a[0] === "[notify-broadcast] duplicate")![1];
    expect(dup).toEqual({ broadcastId: B1, state: "completed" });
    const complete = infoSpy.mock.calls.find((a) => a[0] === "[notify-broadcast] complete")![1] as Record<string, unknown>;
    expect(complete).toMatchObject({ broadcastId: B1, successCount: 3, failedCount: 0 });
    expect(typeof complete.durationMs).toBe("number");

    const serialized = JSON.stringify(logged);
    expect(serialized).not.toContain(MESSAGE);
    expect(serialized).not.toContain("SECRET-BOT-TOKEN");
    expect(serialized).not.toContain("1001");
    expect(serialized).not.toContain("1002");
  });
});

describe("computeBroadcastFingerprint", () => {
  const p = { tournamentId: "t-1", audience: "registered" as const, message: "hi", testMode: false, testTelegramId: null };

  it("is deterministic, hex sha256, and does not contain the message", () => {
    const a = broadcast.computeBroadcastFingerprint(p);
    expect(a).toBe(broadcast.computeBroadcastFingerprint({ ...p }));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with every identity field", () => {
    const a = broadcast.computeBroadcastFingerprint(p);
    expect(broadcast.computeBroadcastFingerprint({ ...p, tournamentId: "t-2" })).not.toBe(a);
    expect(broadcast.computeBroadcastFingerprint({ ...p, audience: "access" })).not.toBe(a);
    expect(broadcast.computeBroadcastFingerprint({ ...p, message: "hi " })).not.toBe(a);
    expect(broadcast.computeBroadcastFingerprint({ ...p, testMode: true, testTelegramId: 1 })).not.toBe(a);
    expect(broadcast.computeBroadcastFingerprint({ ...p, testMode: true, testTelegramId: 1 })).not.toBe(
      broadcast.computeBroadcastFingerprint({ ...p, testMode: true, testTelegramId: 2 })
    );
  });
});
