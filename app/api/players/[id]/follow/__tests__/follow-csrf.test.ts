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

// CSRF gate on POST/DELETE /api/players/[id]/follow. The production session
// cookie is SameSite=None, so a foreign site can make a victim's browser send
// it; these tests prove such a request never reaches the domain layer, while
// the supported Telegram / same-origin flows keep working. Real route -> real
// lib/follows-auth.ts -> real lib/admin-auth.ts; only next/headers and the
// repositories are faked.

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findByTelegramId: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  exists: vi.fn(),
  countFollowers: vi.fn(),
  countFollowing: vi.fn(),
  listFollowers: vi.fn(),
  listFollowing: vi.fn(),
  listFollowingIds: vi.fn(),
  requestHeaders: new Headers(),
  cookieJar: new Map<string, string>(),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: { findById: mocks.findById, findByTelegramId: mocks.findByTelegramId },
  followRepository: {
    create: mocks.create,
    delete: mocks.delete,
    exists: mocks.exists,
    countFollowers: mocks.countFollowers,
    countFollowing: mocks.countFollowing,
    listFollowers: mocks.listFollowers,
    listFollowing: mocks.listFollowing,
    listFollowingIds: mocks.listFollowingIds,
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
const { GET: getSummary } = await import("@/app/api/players/[id]/follow-summary/route");
const { GET: getFollowers } = await import("@/app/api/players/[id]/followers/route");
const { GET: getFollowing } = await import("@/app/api/players/[id]/following/route");
const { GET: getFollowingIds } = await import("@/app/api/players/[id]/following/ids/route");
const { COOKIE_NAME, signSession } = await import("@/lib/telegram-web-session");

const URL_BASE = "https://re-raise.ru/api/players";
const SAME_ORIGIN = { origin: "https://re-raise.ru" };
const EVIL_ORIGIN = { origin: "https://evil.example" };

function call(
  handler: typeof POST | typeof DELETE,
  method: "POST" | "DELETE",
  headers: Record<string, string> = {},
  init: { query?: string; body?: unknown } = {}
) {
  // The initData / cookie come from the faked next/headers; the Request only
  // carries what the browser attaches for Origin classification.
  return handler(
    new Request(`${URL_BASE}/${TARGET_ID}/follow${init.query ?? ""}`, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    routeContext(TARGET_ID)
  );
}

const post = (headers?: Record<string, string>, init?: { query?: string; body?: unknown }) =>
  call(POST, "POST", headers, init);
const del = (headers?: Record<string, string>, init?: { query?: string; body?: unknown }) =>
  call(DELETE, "DELETE", headers, init);

function signInWithCookie(id = VIEWER_ID) {
  mocks.cookieJar.set(COOKIE_NAME, signSession(id));
}

beforeEach(() => {
  process.env.SESSION_SECRET = "follow-csrf-test-secret";
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  mocks.requestHeaders = new Headers();
  mocks.cookieJar = new Map();
  for (const fn of [
    mocks.findById,
    mocks.findByTelegramId,
    mocks.create,
    mocks.delete,
    mocks.exists,
    mocks.countFollowers,
    mocks.countFollowing,
    mocks.listFollowers,
    mocks.listFollowing,
    mocks.listFollowingIds,
  ]) {
    fn.mockReset();
  }

  mocks.findById.mockImplementation(async (id: string) => player(id));
  mocks.findByTelegramId.mockImplementation(async (telegramId: number) =>
    player(VIEWER_ID, { telegram_id: telegramId })
  );
  mocks.create.mockResolvedValue(undefined);
  mocks.delete.mockResolvedValue(undefined);
  mocks.exists.mockResolvedValue(false);
  mocks.countFollowers.mockResolvedValue(5);
  mocks.countFollowing.mockResolvedValue(2);
  mocks.listFollowers.mockResolvedValue([]);
  mocks.listFollowing.mockResolvedValue([]);
  mocks.listFollowingIds.mockResolvedValue([TARGET_ID]);
});

describe("same-origin cookie requests (a normal browser)", () => {
  it("1. POST succeeds", async () => {
    signInWithCookie();

    const response = await post(SAME_ORIGIN);

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
  });

  it("2. DELETE succeeds", async () => {
    signInWithCookie();

    const response = await del(SAME_ORIGIN);

    expect(response.status).toBe(200);
    expect(mocks.delete).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
  });

  it("Sec-Fetch-Site: same-origin without an Origin header is accepted too", async () => {
    signInWithCookie();

    expect((await post({ "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});

describe("cross-origin cookie requests (the CSRF attack)", () => {
  it("3. POST is 403 with the fixed text and the repository is never touched", async () => {
    signInWithCookie();

    const response = await post(EVIL_ORIGIN);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Недопустимый источник запроса" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.countFollowers).not.toHaveBeenCalled();
    // Refused before authentication: not even the viewer was looked up.
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it("4. DELETE is 403 and the repository is never touched", async () => {
    signInWithCookie();

    const response = await del(EVIL_ORIGIN);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Недопустимый источник запроса" });
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it("5. body / query player ids cannot bypass a foreign Origin", async () => {
    signInWithCookie();
    const smuggled = {
      query: `?followerId=${VICTIM_ID}&viewerId=${VICTIM_ID}&origin=https://re-raise.ru`,
      body: { followerId: VICTIM_ID, viewerId: VICTIM_ID, origin: "https://re-raise.ru" },
    };

    const headers = {
      ...EVIL_ORIGIN,
      "content-type": "application/json",
      "x-player-id": VICTIM_ID,
      "x-viewer-id": VICTIM_ID,
      "x-follower-id": VICTIM_ID,
    };

    expect((await post(headers, smuggled)).status).toBe(403);
    expect((await del(headers, smuggled)).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("6. malformed / opaque Origin values are rejected safely (never a 500)", async () => {
    signInWithCookie();

    for (const origin of ["null", "", "not a url", "https://re-raise.ru/evil", "https://re-raise.ru.evil.example"]) {
      const response = await post({ origin });
      expect(response.status, origin).toBe(403);
      expect(await response.json()).toEqual({ error: "Недопустимый источник запроса" });
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("a browser-reported cross-site request is refused even without an Origin header", async () => {
    signInWithCookie();

    expect((await post({ "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await del({ "sec-fetch-site": "same-site" })).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("does not leak request internals in the response", async () => {
    signInWithCookie();

    const response = await post({ origin: "https://evil.example", host: "re-raise.ru" });
    const text = await response.text();

    expect(text).not.toMatch(/evil\.example|re-raise\.ru|cookie|session/i);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("no same-origin evidence (non-browser client / very old WebView)", () => {
  it("9. valid Telegram initData with NO Origin still works", async () => {
    mocks.requestHeaders.set("x-telegram-init-data", freshInitData(777));

    const response = await post();

    expect(response.status).toBe(200);
    expect(mocks.findByTelegramId).toHaveBeenCalledWith(777);
    expect(mocks.create).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);

    expect((await del()).status).toBe(200);
    expect(mocks.delete).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
  });

  it("a cookie-only request with NO Origin evidence fails closed (401), by design", async () => {
    signInWithCookie();

    const response = await post();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Необходимо войти в систему" });
    expect(mocks.create).not.toHaveBeenCalled();
    // The cookie player was never resolved.
    expect(mocks.findById).not.toHaveBeenCalled();

    expect((await del()).status).toBe(401);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("stale initData + valid cookie + NO Origin does not fall back to the cookie", async () => {
    mocks.requestHeaders.set("x-telegram-init-data", staleInitData(777));
    signInWithCookie();

    const response = await post();

    expect(response.status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("11. stale initData alone never authenticates, with or without an Origin", async () => {
    mocks.requestHeaders.set("x-telegram-init-data", staleInitData(777));

    expect((await post()).status).toBe(401);
    expect((await post(SAME_ORIGIN)).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("Telegram flows with a same-origin Origin", () => {
  it("valid initData + same-origin: the initData player is the actor (not the cookie's)", async () => {
    // Cookie says VICTIM, initData says Telegram user 777 -> VIEWER.
    mocks.requestHeaders.set("x-telegram-init-data", freshInitData(777));
    signInWithCookie(VICTIM_ID);

    const response = await post(SAME_ORIGIN);

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
    expect(mocks.create).not.toHaveBeenCalledWith(VICTIM_ID, expect.anything());
  });

  it("D7 is preserved for same-origin requests: stale initData + valid cookie -> cookie viewer", async () => {
    mocks.requestHeaders.set("x-telegram-init-data", staleInitData(777));
    signInWithCookie();

    const response = await post(SAME_ORIGIN);

    expect(response.status).toBe(200);
    expect(mocks.findByTelegramId).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
  });

  it("10. a forged initData is never an identity: bad hash + victim cookie + foreign Origin changes nothing", async () => {
    mocks.requestHeaders.set("x-telegram-init-data", "user=%7B%22id%22%3A777%7D&auth_date=1&hash=deadbeef");
    signInWithCookie(VICTIM_ID);

    const response = await post(EVIL_ORIGIN);

    expect(response.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("read routes are unaffected (GET stays public and Origin-agnostic)", () => {
  const getRequest = (headers: Record<string, string> = EVIL_ORIGIN) =>
    new Request(`${URL_BASE}/${TARGET_ID}/x`, { method: "GET", headers });

  it("7. follow-summary answers a cross-origin / anonymous GET with the public counts", async () => {
    const response = await getSummary(getRequest(), routeContext(TARGET_ID));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ followers: 5, following: 2, isFollowing: false });
  });

  it("8. followers / following / following-ids answer a cross-origin GET unchanged", async () => {
    expect((await getFollowers(getRequest(), routeContext(TARGET_ID))).status).toBe(200);
    expect((await getFollowing(getRequest(), routeContext(TARGET_ID))).status).toBe(200);

    const ids = await getFollowingIds(getRequest(), routeContext(TARGET_ID));
    expect(ids.status).toBe(200);
    expect(await ids.json()).toEqual({ ids: [TARGET_ID] });
  });
});
