import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOT_TOKEN,
  TARGET_ID,
  VIEWER_ID,
  freshInitData,
  player,
  routeContext,
  staleInitData,
} from "@/lib/__tests__/helpers/follows-fixtures";

// GET /api/players/[id]/follow-summary -- public counts, OPTIONAL auth,
// per-field degradation. Real route -> follows-auth -> admin-auth -> feature;
// only next/headers and @/lib/repositories are faked.

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findByTelegramId: vi.fn(),
  exists: vi.fn(),
  countFollowers: vi.fn(),
  countFollowing: vi.fn(),
  requestHeaders: new Headers(),
  cookieJar: new Map<string, string>(),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: { findById: mocks.findById, findByTelegramId: mocks.findByTelegramId },
  followRepository: {
    exists: mocks.exists,
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

const { GET } = await import("@/app/api/players/[id]/follow-summary/route");
const { COOKIE_NAME, signSession } = await import("@/lib/telegram-web-session");

function get(id: string) {
  return GET(new Request(`http://localhost/api/players/${id}/follow-summary`), routeContext(id));
}

function signInAsViewerWithCookie() {
  mocks.cookieJar.set(COOKIE_NAME, signSession(VIEWER_ID));
}

beforeEach(() => {
  process.env.SESSION_SECRET = "follow-summary-route-test-secret";
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  vi.spyOn(console, "error").mockImplementation(() => {});

  mocks.requestHeaders = new Headers();
  mocks.cookieJar = new Map();
  for (const fn of [mocks.findById, mocks.findByTelegramId, mocks.exists, mocks.countFollowers, mocks.countFollowing]) {
    fn.mockReset();
  }

  mocks.findById.mockImplementation(async (id: string) => player(id));
  mocks.findByTelegramId.mockImplementation(async (telegramId: number) =>
    player(VIEWER_ID, { telegram_id: telegramId })
  );
  mocks.exists.mockResolvedValue(false);
  mocks.countFollowers.mockResolvedValue(12);
  mocks.countFollowing.mockResolvedValue(3);
});

describe("GET /api/players/[id]/follow-summary", () => {
  it("anonymous: 200, public counts, isFollowing false, no exists() lookup", async () => {
    const response = await get(TARGET_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ followers: 12, following: 3, isFollowing: false });
    expect(mocks.exists).not.toHaveBeenCalled();
  });

  it("own profile: isFollowing false, no exists() lookup", async () => {
    signInAsViewerWithCookie();

    const response = await get(VIEWER_ID);

    expect(await response.json()).toEqual({ followers: 12, following: 3, isFollowing: false });
    expect(mocks.exists).not.toHaveBeenCalled();
  });

  it("authenticated (cookie) on another player: exact directed-edge check", async () => {
    signInAsViewerWithCookie();
    mocks.exists.mockResolvedValue(true);

    const response = await get(TARGET_ID);

    expect(await response.json()).toEqual({ followers: 12, following: 3, isFollowing: true });
    expect(mocks.exists).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
  });

  it("authenticated via Telegram initData header", async () => {
    mocks.requestHeaders.set("x-telegram-init-data", freshInitData(777));
    mocks.exists.mockResolvedValue(true);

    expect((await (await get(TARGET_ID)).json()).isFollowing).toBe(true);
    expect(mocks.exists).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
  });

  it("D7: stale initData + valid cookie is still recognised as the viewer", async () => {
    mocks.requestHeaders.set("x-telegram-init-data", staleInitData(777));
    signInAsViewerWithCookie();
    mocks.exists.mockResolvedValue(true);

    expect((await (await get(TARGET_ID)).json()).isFollowing).toBe(true);
  });

  it("stale initData without a cookie is treated as anonymous (isFollowing false), not as an error", async () => {
    mocks.requestHeaders.set("x-telegram-init-data", staleInitData(777));

    const response = await get(TARGET_ID);

    expect(response.status).toBe(200);
    expect((await response.json()).isFollowing).toBe(false);
  });

  it("a blocked viewer is treated as anonymous (isFollowing false)", async () => {
    signInAsViewerWithCookie();
    mocks.findById.mockImplementation(async (id: string) =>
      id === VIEWER_ID ? player(VIEWER_ID, { is_blocked: true }) : player(id)
    );
    mocks.exists.mockResolvedValue(true);

    const response = await get(TARGET_ID);

    expect((await response.json()).isFollowing).toBe(false);
    expect(mocks.exists).not.toHaveBeenCalled();
  });

  it("a counts failure nulls only that count (still 200)", async () => {
    mocks.countFollowers.mockRejectedValue(new Error("boom"));

    const response = await get(TARGET_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ followers: null, following: 3, isFollowing: false });
  });

  it("an exists failure gives isFollowing null, counts intact (still 200)", async () => {
    signInAsViewerWithCookie();
    mocks.exists.mockRejectedValue(new Error("boom"));

    const response = await get(TARGET_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ followers: 12, following: 3, isFollowing: null });
  });

  it("viewer resolution failing gives isFollowing null while the public counts still load", async () => {
    mocks.cookieJar.set(COOKIE_NAME, signSession(VIEWER_ID));
    mocks.findById.mockRejectedValue(new Error("Failed to fetch player by id: connection terminated"));

    const response = await get(TARGET_ID);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ followers: 12, following: 3, isFollowing: null });
  });

  it("500 with the fixed summary message only when every attempted operation failed; no raw DB text", async () => {
    signInAsViewerWithCookie();
    mocks.countFollowers.mockRejectedValue(new Error("relation follows does not exist"));
    mocks.countFollowing.mockRejectedValue(new Error("relation follows does not exist"));
    mocks.exists.mockRejectedValue(new Error("relation follows does not exist"));

    const response = await get(TARGET_ID);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Не удалось загрузить данные подписок. Попробуйте ещё раз." });
  });

  it("400 Некорректный идентификатор игрока for a malformed id, with no repository access", async () => {
    const response = await get("not-a-uuid");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Некорректный идентификатор игрока" });
    expect(mocks.countFollowers).not.toHaveBeenCalled();
    expect(mocks.countFollowing).not.toHaveBeenCalled();
    expect(mocks.exists).not.toHaveBeenCalled();
  });

  it("an unknown but well-formed player id returns zero counts (not 404)", async () => {
    mocks.countFollowers.mockResolvedValue(0);
    mocks.countFollowing.mockResolvedValue(0);

    const response = await get("99999999-9999-4999-8999-999999999999");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ followers: 0, following: 0, isFollowing: false });
  });
});
