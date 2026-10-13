import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/types/domain";

// Exercises the REAL decision path: lib/follows-auth.ts -> lib/admin-auth.ts
// (real Telegram initData HMAC verification + 1h auth_date window) ->
// lib/canonical-player.ts, with only the data boundary (playerRepository) and
// the request boundary (next/headers) faked. Nothing about resolveFollowViewer
// itself is mocked, so D7 (stale initData -> valid signed cookie) is proven by
// behavior, not asserted by construction.

const BOT_TOKEN = "123456:follows-auth-test-token";

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findByTelegramId: vi.fn(),
  requestHeaders: new Headers(),
  cookieJar: new Map<string, string>(),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: { findById: mocks.findById, findByTelegramId: mocks.findByTelegramId },
}));

vi.mock("next/headers", () => ({
  headers: async () => mocks.requestHeaders,
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.cookieJar.get(name);
      return value === undefined ? undefined : { value };
    },
  }),
}));

const { resolveFollowViewer, requireFollowViewer, FollowUnauthorizedError } = await import("@/lib/follows-auth");
const { COOKIE_NAME, signSession } = await import("@/lib/telegram-web-session");

function player(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    telegram_id: null,
    username: null,
    display_name: id,
    role: "player",
    is_blocked: false,
    merged_into_player_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Player;
}

function signInitData(telegramId: number, authDate: number, token = BOT_TOKEN): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "AAH-test",
    user: JSON.stringify({ id: telegramId, first_name: "Test" }),
  });
  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(checkString).digest("hex"));
  return params.toString();
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const freshInitData = (telegramId: number) => signInitData(telegramId, nowSeconds() - 60);
const staleInitData = (telegramId: number) => signInitData(telegramId, nowSeconds() - 2 * 60 * 60);

function sendInitData(value: string) {
  mocks.requestHeaders.set("x-telegram-init-data", value);
}

function sendCookie(playerId: string) {
  mocks.cookieJar.set(COOKIE_NAME, signSession(playerId));
}

beforeEach(() => {
  process.env.SESSION_SECRET = "follows-auth-test-secret";
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  mocks.requestHeaders = new Headers();
  mocks.cookieJar = new Map();
  mocks.findById.mockReset();
  mocks.findByTelegramId.mockReset();

  mocks.findById.mockImplementation(async (id: string) => player(id));
  mocks.findByTelegramId.mockImplementation(async (telegramId: number) =>
    player(`tg-${telegramId}`, { telegram_id: telegramId })
  );
});

describe("resolveFollowViewer", () => {
  it("valid initData -> the Telegram player", async () => {
    sendInitData(freshInitData(777));

    const viewer = await resolveFollowViewer();

    expect(viewer?.id).toBe("tg-777");
    expect(mocks.findByTelegramId).toHaveBeenCalledWith(777);
  });

  it("valid cookie without any header -> the cookie player", async () => {
    sendCookie("cookie-player");

    const viewer = await resolveFollowViewer();

    expect(viewer?.id).toBe("cookie-player");
    expect(mocks.findByTelegramId).not.toHaveBeenCalled();
  });

  it("D7: stale initData + valid cookie -> the cookie player", async () => {
    sendInitData(staleInitData(777));
    sendCookie("cookie-player");

    const viewer = await resolveFollowViewer();

    expect(viewer?.id).toBe("cookie-player");
    // The stale header itself authenticated nobody.
    expect(mocks.findByTelegramId).not.toHaveBeenCalled();
  });

  it("D7: initData with a forged signature + valid cookie -> the cookie player, never the forged identity", async () => {
    sendInitData(signInitData(777, nowSeconds() - 10, "999:attacker-token"));
    sendCookie("cookie-player");

    const viewer = await resolveFollowViewer();

    expect(viewer?.id).toBe("cookie-player");
    expect(mocks.findByTelegramId).not.toHaveBeenCalled();
  });

  it("D7: stale initData + no cookie -> null (stale initData never authenticates by itself)", async () => {
    sendInitData(staleInitData(777));

    expect(await resolveFollowViewer()).toBeNull();
    expect(mocks.findByTelegramId).not.toHaveBeenCalled();
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it("D7: stale initData + a cookie with a bad signature -> null", async () => {
    sendInitData(staleInitData(777));
    mocks.cookieJar.set(COOKIE_NAME, `cookie-player.${"0".repeat(64)}`);

    expect(await resolveFollowViewer()).toBeNull();
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it("a cookie signed with another secret is rejected", async () => {
    process.env.SESSION_SECRET = "some-other-secret";
    const foreignCookie = signSession("cookie-player");
    process.env.SESSION_SECRET = "follows-auth-test-secret";
    mocks.cookieJar.set(COOKIE_NAME, foreignCookie);

    expect(await resolveFollowViewer()).toBeNull();
  });

  it("valid initData wins over a cookie for a different player (identities are never mixed)", async () => {
    sendInitData(freshInitData(777));
    sendCookie("other-cookie-player");

    const viewer = await resolveFollowViewer();

    expect(viewer?.id).toBe("tg-777");
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it("a valid initData whose player is BLOCKED is null and does NOT fall through to the cookie", async () => {
    sendInitData(freshInitData(777));
    sendCookie("cookie-player");
    mocks.findByTelegramId.mockResolvedValue(player("tg-777", { telegram_id: 777, is_blocked: true }));

    expect(await resolveFollowViewer()).toBeNull();
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it("a blocked cookie player is null", async () => {
    sendCookie("blocked-player");
    mocks.findById.mockResolvedValue(player("blocked-player", { is_blocked: true }));

    expect(await resolveFollowViewer()).toBeNull();
  });

  it("a blocked cookie player reached via the stale-initData fallback is null", async () => {
    sendInitData(staleInitData(777));
    sendCookie("blocked-player");
    mocks.findById.mockResolvedValue(player("blocked-player", { is_blocked: true }));

    expect(await resolveFollowViewer()).toBeNull();
  });

  it("a merged-away cookie player resolves to the canonical target", async () => {
    sendCookie("source");
    mocks.findById.mockImplementation(async (id: string) =>
      id === "source" ? player("source", { merged_into_player_id: "target" }) : player("target")
    );

    expect((await resolveFollowViewer())?.id).toBe("target");
  });

  it("a merged-away Telegram player resolves to the canonical target", async () => {
    sendInitData(freshInitData(777));
    mocks.findByTelegramId.mockResolvedValue(
      player("source", { telegram_id: 777, merged_into_player_id: "target" })
    );
    mocks.findById.mockImplementation(async (id: string) => player(id));

    expect((await resolveFollowViewer())?.id).toBe("target");
  });

  it("a merged-away player reached via the stale-initData fallback also resolves canonically", async () => {
    sendInitData(staleInitData(777));
    sendCookie("source");
    mocks.findById.mockImplementation(async (id: string) =>
      id === "source" ? player("source", { merged_into_player_id: "target" }) : player("target")
    );

    expect((await resolveFollowViewer())?.id).toBe("target");
  });

  it("anonymous (no header, no cookie) -> null", async () => {
    expect(await resolveFollowViewer()).toBeNull();
    expect(mocks.findById).not.toHaveBeenCalled();
    expect(mocks.findByTelegramId).not.toHaveBeenCalled();
  });

  it("a player id sent in other headers is never trusted", async () => {
    mocks.requestHeaders.set("x-player-id", "victim");
    mocks.requestHeaders.set("x-viewer-id", "victim");

    expect(await resolveFollowViewer()).toBeNull();
  });
});

describe("requireFollowViewer", () => {
  it("returns the viewer when authenticated", async () => {
    sendCookie("cookie-player");

    expect((await requireFollowViewer()).id).toBe("cookie-player");
  });

  it("throws FollowUnauthorizedError (Необходимо войти в систему) when anonymous", async () => {
    await expect(requireFollowViewer()).rejects.toBeInstanceOf(FollowUnauthorizedError);
    await expect(requireFollowViewer()).rejects.toThrow("Необходимо войти в систему");
  });

  it("throws FollowUnauthorizedError for a blocked viewer", async () => {
    sendCookie("blocked-player");
    mocks.findById.mockResolvedValue(player("blocked-player", { is_blocked: true }));

    await expect(requireFollowViewer()).rejects.toBeInstanceOf(FollowUnauthorizedError);
  });
});
