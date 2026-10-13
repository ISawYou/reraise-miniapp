import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOT_TOKEN,
  TARGET_ID,
  VICTIM_ID,
  VIEWER_ID,
  freshInitData,
  player,
  routeContext,
  staleInitData,
} from "@/lib/__tests__/helpers/follows-fixtures";

// POST/DELETE /api/players/[id]/follow through the REAL stack: route ->
// lib/follows-auth.ts -> lib/admin-auth.ts (real initData HMAC + cookie
// verification) -> features/follows.ts -> error mapper. Only next/headers
// (the request) and @/lib/repositories (the data) are faked, so the tests
// prove the exact header/cookie contract the Batch C client will use through
// fetchAdminJson (X-Telegram-Init-Data header, with the session cookie as
// the independent fallback).

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findByTelegramId: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  countFollowers: vi.fn(),
  countFollowing: vi.fn(),
  requestHeaders: new Headers(),
  cookieJar: new Map<string, string>(),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: { findById: mocks.findById, findByTelegramId: mocks.findByTelegramId },
  followRepository: {
    create: mocks.create,
    delete: mocks.delete,
    countFollowers: mocks.countFollowers,
    countFollowing: mocks.countFollowing,
  },
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

const { POST, DELETE } = await import("@/app/api/players/[id]/follow/route");
const { COOKIE_NAME, signSession } = await import("@/lib/telegram-web-session");

function signInAsViewerWithCookie(id = VIEWER_ID) {
  mocks.cookieJar.set(COOKIE_NAME, signSession(id));
}

// A browser always sends Origin on a same-origin POST/DELETE, so the helpers do
// too. The CSRF gate itself (foreign / missing Origin) is covered separately in
// follow-csrf.test.ts.
function withSameOrigin(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  if (!headers.has("origin")) headers.set("origin", "http://localhost");
  return { ...init, headers };
}

function post(id: string, init: RequestInit = {}) {
  return POST(
    new Request(`http://localhost/api/players/${id}/follow`, { method: "POST", ...withSameOrigin(init) }),
    routeContext(id)
  );
}

function del(id: string, init: RequestInit = {}) {
  return DELETE(
    new Request(`http://localhost/api/players/${id}/follow`, { method: "DELETE", ...withSameOrigin(init) }),
    routeContext(id)
  );
}

beforeEach(() => {
  process.env.SESSION_SECRET = "follow-route-test-secret";
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  vi.spyOn(console, "error").mockImplementation(() => {});

  mocks.requestHeaders = new Headers();
  mocks.cookieJar = new Map();
  for (const fn of [mocks.findById, mocks.findByTelegramId, mocks.create, mocks.delete, mocks.countFollowers, mocks.countFollowing]) {
    fn.mockReset();
  }

  mocks.findById.mockImplementation(async (id: string) => player(id));
  mocks.findByTelegramId.mockImplementation(async (telegramId: number) =>
    player(VIEWER_ID, { telegram_id: telegramId })
  );
  mocks.create.mockResolvedValue(undefined);
  mocks.delete.mockResolvedValue(undefined);
  mocks.countFollowers.mockResolvedValue(12);
  mocks.countFollowing.mockResolvedValue(3);
});

describe("POST /api/players/[id]/follow", () => {
  it("200 with the exact success shape and fresh TARGET counts (cookie auth)", async () => {
    signInAsViewerWithCookie();

    const response = await post(TARGET_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ following: true, followers: 12, following_count: 3 });
    expect(mocks.create).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
    expect(mocks.countFollowers).toHaveBeenCalledWith(TARGET_ID);
    expect(mocks.countFollowing).toHaveBeenCalledWith(TARGET_ID);
  });

  it("200 with Telegram initData header auth (what fetchAdminJson sends)", async () => {
    mocks.requestHeaders.set("x-telegram-init-data", freshInitData(777));

    const response = await post(TARGET_ID);

    expect(response.status).toBe(200);
    expect(mocks.findByTelegramId).toHaveBeenCalledWith(777);
    expect(mocks.create).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
  });

  it("D7: stale initData header + valid cookie still works (200, cookie viewer)", async () => {
    mocks.requestHeaders.set("x-telegram-init-data", staleInitData(777));
    signInAsViewerWithCookie();

    const response = await post(TARGET_ID);

    expect(response.status).toBe(200);
    expect(mocks.findByTelegramId).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
  });

  it("401 Необходимо войти в систему for an anonymous caller; nothing is written", async () => {
    const response = await post(TARGET_ID);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Необходимо войти в систему" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("401 for stale initData with no cookie (stale initData never authenticates)", async () => {
    mocks.requestHeaders.set("x-telegram-init-data", staleInitData(777));

    const response = await post(TARGET_ID);

    expect(response.status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("401 for a BLOCKED viewer", async () => {
    signInAsViewerWithCookie();
    mocks.findById.mockImplementation(async (id: string) =>
      id === VIEWER_ID ? player(VIEWER_ID, { is_blocked: true }) : player(id)
    );

    const response = await post(TARGET_ID);

    expect(response.status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("400 Некорректный идентификатор игрока for a malformed id, with no database access and no raw DB text", async () => {
    signInAsViewerWithCookie();
    mocks.findById.mockClear();

    for (const bad of ["not-a-uuid", "123", "%27%3B--", "22222222-2222-4222-8222-22222222222"]) {
      const response = await post(bad);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: "Некорректный идентификатор игрока" });
      expect(JSON.stringify(body)).not.toMatch(/invalid input syntax/i);
    }
    expect(mocks.create).not.toHaveBeenCalled();
    // Only the viewer lookup from authentication ever hit the player repository.
    expect(mocks.findById.mock.calls.every(([id]) => id === VIEWER_ID)).toBe(true);
  });

  it("400 Нельзя подписаться на самого себя; nothing is written", async () => {
    signInAsViewerWithCookie();

    const response = await post(VIEWER_ID);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Нельзя подписаться на самого себя" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("404 Игрок не найден when the target does not exist", async () => {
    signInAsViewerWithCookie();
    mocks.findById.mockImplementation(async (id: string) => (id === VIEWER_ID ? player(VIEWER_ID) : null));

    const response = await post(TARGET_ID);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Игрок не найден" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("409 only for a merged-away TARGET", async () => {
    signInAsViewerWithCookie();
    mocks.findById.mockImplementation(async (id: string) =>
      id === TARGET_ID ? player(TARGET_ID, { merged_into_player_id: VICTIM_ID }) : player(id)
    );

    const response = await post(TARGET_ID);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Аккаунт был объединён. Обновите страницу." });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("a BLOCKED target is followable (200)", async () => {
    signInAsViewerWithCookie();
    mocks.findById.mockImplementation(async (id: string) =>
      id === TARGET_ID ? player(TARGET_ID, { is_blocked: true }) : player(id)
    );

    const response = await post(TARGET_ID);

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
  });

  it("repeat follow is still 200 (never 409), twice in a row", async () => {
    signInAsViewerWithCookie();

    const first = await post(TARGET_ID);
    const second = await post(TARGET_ID);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ following: true });
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("body, query and extra headers cannot override the follower identity", async () => {
    signInAsViewerWithCookie();

    const response = await POST(
      new Request(`http://localhost/api/players/${TARGET_ID}/follow?followerId=${VICTIM_ID}&viewerId=${VICTIM_ID}&playerId=${VICTIM_ID}`, {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
          "x-player-id": VICTIM_ID,
          "x-viewer-id": VICTIM_ID,
          "x-follower-id": VICTIM_ID,
        },
        body: JSON.stringify({ followerId: VICTIM_ID, follower_player_id: VICTIM_ID, viewerId: VICTIM_ID, playerId: VICTIM_ID }),
      }),
      routeContext(TARGET_ID)
    );

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
    expect(mocks.create).not.toHaveBeenCalledWith(VICTIM_ID, expect.anything());
  });

  it("an anonymous caller cannot follow by naming a follower in the body", async () => {
    const response = await post(TARGET_ID, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ followerId: VICTIM_ID }),
    });

    expect(response.status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("500 with the fixed follow message when the DB throws; raw DB text never reaches the client", async () => {
    signInAsViewerWithCookie();
    mocks.create.mockRejectedValue(new Error('insert or update on table "follows" violates foreign key constraint'));

    const response = await post(TARGET_ID);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Не удалось подписаться. Попробуйте ещё раз." });
    expect(console.error).toHaveBeenCalled();
  });

  it("an unexpected failure while resolving the viewer is a fixed 500, not the raw error", async () => {
    mocks.cookieJar.set(COOKIE_NAME, signSession(VIEWER_ID));
    mocks.findById.mockRejectedValue(new Error("Failed to fetch player by id: connection terminated"));

    const response = await post(TARGET_ID);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Не удалось подписаться. Попробуйте ещё раз." });
    expect(JSON.stringify(body)).not.toMatch(/connection terminated/);
  });
});

describe("DELETE /api/players/[id]/follow", () => {
  it("200 with the exact success shape and fresh TARGET counts", async () => {
    signInAsViewerWithCookie();
    mocks.countFollowers.mockResolvedValue(11);

    const response = await del(TARGET_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ following: false, followers: 11, following_count: 3 });
    expect(mocks.delete).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
  });

  it("200 with Telegram initData header auth", async () => {
    mocks.requestHeaders.set("x-telegram-init-data", freshInitData(777));

    const response = await del(TARGET_ID);

    expect(response.status).toBe(200);
    expect(mocks.delete).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
  });

  it("a missing relationship is still 200, repeatedly", async () => {
    signInAsViewerWithCookie();

    expect((await del(TARGET_ID)).status).toBe(200);
    expect((await del(TARGET_ID)).status).toBe(200);
  });

  it("does not require the target to exist (200 even if the player is unknown)", async () => {
    signInAsViewerWithCookie();
    mocks.findById.mockImplementation(async (id: string) => (id === VIEWER_ID ? player(VIEWER_ID) : null));

    const response = await del(TARGET_ID);

    expect(response.status).toBe(200);
    expect(mocks.delete).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
  });

  it("401 for anonymous and for blocked viewers; nothing is deleted", async () => {
    expect((await del(TARGET_ID)).status).toBe(401);

    signInAsViewerWithCookie();
    mocks.findById.mockImplementation(async (id: string) =>
      id === VIEWER_ID ? player(VIEWER_ID, { is_blocked: true }) : player(id)
    );
    expect((await del(TARGET_ID)).status).toBe(401);

    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("400 Некорректный идентификатор игрока for a malformed id", async () => {
    signInAsViewerWithCookie();

    const response = await del("not-a-uuid");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Некорректный идентификатор игрока" });
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("body, query and extra headers cannot override the follower identity", async () => {
    signInAsViewerWithCookie();

    const response = await DELETE(
      new Request(`http://localhost/api/players/${TARGET_ID}/follow?followerId=${VICTIM_ID}`, {
        method: "DELETE",
        headers: { origin: "http://localhost", "content-type": "application/json", "x-player-id": VICTIM_ID },
        body: JSON.stringify({ followerId: VICTIM_ID, viewerId: VICTIM_ID }),
      }),
      routeContext(TARGET_ID)
    );

    expect(response.status).toBe(200);
    expect(mocks.delete).toHaveBeenCalledTimes(1);
    expect(mocks.delete).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
  });

  it("500 with the fixed unfollow message when the DB throws; raw DB text never reaches the client", async () => {
    signInAsViewerWithCookie();
    mocks.delete.mockRejectedValue(new Error("deadlock detected on relation follows"));

    const response = await del(TARGET_ID);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Не удалось отписаться. Попробуйте ещё раз." });
  });
});
