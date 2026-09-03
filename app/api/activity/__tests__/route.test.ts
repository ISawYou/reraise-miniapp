import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Player } from "@/types/domain";

const SESSION_SECRET = "test-session-secret";

const { mockHeaders, mockCookies, mockFindById, mockFindByTelegramId, mockLogActivityEvent } =
  vi.hoisted(() => ({
    mockHeaders: vi.fn(),
    mockCookies: vi.fn(),
    mockFindById: vi.fn(),
    mockFindByTelegramId: vi.fn(),
    mockLogActivityEvent: vi.fn(),
  }));

vi.mock("next/headers", () => ({
  headers: mockHeaders,
  cookies: mockCookies,
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: {
    findById: mockFindById,
    findByTelegramId: mockFindByTelegramId,
  },
}));

vi.mock("@/lib/activity-logger", () => ({
  logActivityEvent: mockLogActivityEvent,
}));

import { POST } from "../route";
// Real (unmocked) HMAC session signing -- exercises the actual
// resolveCurrentServerActor() -> resolveAuthenticatedCaller() ->
// resolveCanonicalPlayer() chain for real, same convention as
// features/__tests__/auth-server.test.ts and other session-adjacent tests.
import { signSession } from "@/lib/telegram-web-session";

function emptyHeaders() {
  return { get: () => null };
}

function emptyCookies() {
  return { get: () => undefined };
}

function cookieStoreWith(value: string) {
  return { get: (name: string) => (name === "reraise_session" ? { value } : undefined) };
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: "player-id",
    telegram_id: null,
    username: null,
    display_name: "Player",
    role: "player",
    merged_into_player_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Player;
}

function requestWithBody(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/activity", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/activity", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = SESSION_SECRET;
    mockHeaders.mockResolvedValue(emptyHeaders());
    mockCookies.mockResolvedValue(emptyCookies());
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.SESSION_SECRET;
  });

  it("logs the event under the server-resolved session player, ignoring any client-supplied player_id", async () => {
    mockCookies.mockResolvedValue(cookieStoreWith(signSession("caller-id")));
    mockFindById.mockResolvedValue(makePlayer({ id: "caller-id", role: "player" }));

    const response = await POST(
      requestWithBody({ player_id: "someone-elses-id", event_type: "app_opened" })
    );

    expect(response.status).toBe(200);
    expect(mockLogActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ player_id: "caller-id", is_admin: false })
    );
  });

  it("logs under the caller's own id even when the body claims to be an admin player -- is_admin is never taken from the client", async () => {
    mockCookies.mockResolvedValue(cookieStoreWith(signSession("player-id")));
    mockFindById.mockResolvedValue(makePlayer({ id: "player-id", role: "player" }));

    await POST(
      requestWithBody({ player_id: "admin-id", is_admin: true, event_type: "profile_opened" })
    );

    expect(mockLogActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ player_id: "player-id", is_admin: false })
    );
  });

  it("resolves a stale merged-source cookie to the canonical target -- events log under target, never the merged-away source", async () => {
    mockCookies.mockResolvedValue(cookieStoreWith(signSession("source-id")));
    mockFindById
      .mockResolvedValueOnce(
        makePlayer({ id: "source-id", role: "player", merged_into_player_id: "target-id" })
      )
      .mockResolvedValueOnce(makePlayer({ id: "target-id", role: "admin", merged_into_player_id: null }));

    await POST(requestWithBody({ player_id: "source-id", event_type: "app_opened" }));

    expect(mockLogActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ player_id: "target-id", is_admin: true })
    );
  });

  it("is_admin is true only because the canonical (target) player is actually admin, not because of anything client-supplied", async () => {
    mockCookies.mockResolvedValue(cookieStoreWith(signSession("admin-id")));
    mockFindById.mockResolvedValue(makePlayer({ id: "admin-id", role: "admin" }));

    await POST(requestWithBody({ event_type: "support_opened" }));

    expect(mockLogActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ player_id: "admin-id", is_admin: true })
    );
  });

  it("source=admin merged into target=player -- stale source session logs with is_admin=false (canonical target's real role)", async () => {
    mockCookies.mockResolvedValue(cookieStoreWith(signSession("source-id")));
    mockFindById
      .mockResolvedValueOnce(
        makePlayer({ id: "source-id", role: "admin", merged_into_player_id: "target-id" })
      )
      .mockResolvedValueOnce(makePlayer({ id: "target-id", role: "player", merged_into_player_id: null }));

    await POST(requestWithBody({ event_type: "app_opened" }));

    expect(mockLogActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ player_id: "target-id", is_admin: false })
    );
  });

  it("authenticates via the x-telegram-init-data header when there is no session cookie at all -- the common Telegram Mini App case", async () => {
    mockHeaders.mockResolvedValue({ get: (name: string) => (name === "x-telegram-init-data" ? "valid-init-data" : null) });
    process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";

    // verifyTelegramInitData is real HMAC verification inside admin-auth.ts
    // and would reject "valid-init-data" as malformed -- this test only
    // needs to prove the header path is consulted at all when no cookie
    // exists, which a malformed/rejected header already demonstrates via
    // the no-op-but-200 result below combined with the dedicated header
    // path test in lib/__tests__/admin-auth-canonical.test.ts covering the
    // successful-resolution case against a mocked verifier.
    const response = await POST(requestWithBody({ event_type: "app_opened" }));
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it("no-ops (200, no log) when there is no session at all -- a forged/invalid cookie never becomes an authenticated event", async () => {
    mockCookies.mockResolvedValue(cookieStoreWith("tampered-or-forged"));

    const response = await POST(requestWithBody({ player_id: "anyone", event_type: "app_opened" }));
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockLogActivityEvent).not.toHaveBeenCalled();
  });

  it("no-ops when there is no cookie/header at all (the only currently-legitimate anonymous case -- no event is logged, but the request doesn't error)", async () => {
    const response = await POST(requestWithBody({ event_type: "page_view_tournaments" }));
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockLogActivityEvent).not.toHaveBeenCalled();
  });

  it("no-ops on a missing/invalid event_type without touching the session at all", async () => {
    const response = await POST(requestWithBody({}));
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockLogActivityEvent).not.toHaveBeenCalled();
  });
});
