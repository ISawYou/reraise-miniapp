import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/follows-client.ts -- the browser-side transport. The profile page test
// (app/players/[id]/__tests__/follow-ui.test.tsx) covers behavior; this pins
// the request/response contract of the helper itself.

const mocks = vi.hoisted(() => ({
  fetchAdminJson: vi.fn(),
  fetchJsonWithRetry: vi.fn(),
  getAdminHeaders: vi.fn(),
}));

// The Telegram-context policy (initData inside a Mini App, no header and no
// wait outside it) lives in lib/client-request.ts's getAdminHeaders and is
// tested there (client-request.test.ts); follows-client must simply use it.
vi.mock("@/lib/client-request", () => ({
  fetchAdminJson: mocks.fetchAdminJson,
  fetchJsonWithRetry: mocks.fetchJsonWithRetry,
  getAdminHeaders: mocks.getAdminHeaders,
}));
// Guard against a second, duplicated Telegram-context policy creeping back in.
vi.mock("@/lib/telegram", () => ({
  getTelegramInitData: () => {
    throw new Error("follows-client must not read Telegram state itself");
  },
  isTelegramMiniAppContext: () => {
    throw new Error("follows-client must not read Telegram state itself");
  },
}));

const { fetchFollowSummary, followPlayerRequest, unfollowPlayerRequest, fetchFollowers, fetchFollowing, fetchFollowingIds } =
  await import("@/lib/follows-client");

const ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  mocks.fetchAdminJson.mockReset();
  mocks.fetchJsonWithRetry.mockReset();
  mocks.getAdminHeaders.mockReset().mockResolvedValue({ "X-Telegram-Init-Data": "init-data" });
});

describe("fetchFollowSummary", () => {
  it("GETs follow-summary through the authenticated client (initData header added there) and returns the summary", async () => {
    mocks.fetchAdminJson.mockResolvedValue({ followers: 12, following: null, isFollowing: true });

    await expect(fetchFollowSummary(ID)).resolves.toEqual({ followers: 12, following: null, isFollowing: true });

    expect(mocks.fetchAdminJson).toHaveBeenCalledWith(`/api/players/${ID}/follow-summary`, { cache: "no-store" });
  });

  it("keeps a valid zero and never turns null into 0 / false", async () => {
    mocks.fetchAdminJson.mockResolvedValue({ followers: 0, following: null, isFollowing: null });

    await expect(fetchFollowSummary(ID)).resolves.toEqual({ followers: 0, following: null, isFollowing: null });
  });

  it("treats junk values as null rather than inventing numbers", async () => {
    mocks.fetchAdminJson.mockResolvedValue({ followers: "12", following: -1, isFollowing: "yes" });

    await expect(fetchFollowSummary(ID)).resolves.toEqual({ followers: null, following: null, isFollowing: null });
  });

  it.each([[null], [undefined], ["text"], [{}], [{ pending_invitations: [] }]])("throws for an unusable body %j", async (body) => {
    mocks.fetchAdminJson.mockResolvedValue(body);

    await expect(fetchFollowSummary(ID)).rejects.toThrow();
  });

  it("propagates transport failures (callers treat them as 'no follow data')", async () => {
    mocks.fetchAdminJson.mockRejectedValue(new Error("Сеть нестабильна. Попробуйте еще раз."));

    await expect(fetchFollowSummary(ID)).rejects.toThrow("Сеть нестабильна");
  });

  it("encodes the id into the path", async () => {
    mocks.fetchAdminJson.mockResolvedValue({ followers: 1, following: 1, isFollowing: false });

    await fetchFollowSummary("a/b?c");

    expect(mocks.fetchAdminJson.mock.calls[0][0]).toBe("/api/players/a%2Fb%3Fc/follow-summary");
  });
});

describe("followPlayerRequest / unfollowPlayerRequest", () => {
  it("POST: sends the Telegram initData header, never retries, names no follower, returns the canonical result", async () => {
    mocks.fetchJsonWithRetry.mockResolvedValue({ following: true, followers: 13, following_count: 4 });

    const result = await followPlayerRequest(ID);

    expect(result).toEqual({ following: true, followers: 13, following_count: 4 });
    const [url, init, retries] = mocks.fetchJsonWithRetry.mock.calls[0];
    expect(url).toBe(`/api/players/${ID}/follow`);
    expect(init).toEqual({ method: "POST", cache: "no-store", headers: { "X-Telegram-Init-Data": "init-data" } });
    expect(init.body).toBeUndefined();
    expect(retries).toBe(0);
  });

  it("DELETE: same transport, DELETE method", async () => {
    mocks.fetchJsonWithRetry.mockResolvedValue({ following: false, followers: 12, following_count: 4 });

    const result = await unfollowPlayerRequest(ID);

    expect(result).toEqual({ following: false, followers: 12, following_count: 4 });
    const [, init, retries] = mocks.fetchJsonWithRetry.mock.calls[0];
    expect(init.method).toBe("DELETE");
    expect(retries).toBe(0);
  });

  it("uses the shared header policy: whatever getAdminHeaders returns is sent as-is (nothing outside Telegram)", async () => {
    mocks.getAdminHeaders.mockResolvedValue({});
    mocks.fetchJsonWithRetry.mockResolvedValue({ following: true, followers: 1, following_count: 0 });

    await followPlayerRequest(ID);

    expect(mocks.getAdminHeaders).toHaveBeenCalledTimes(1);
    expect(mocks.fetchJsonWithRetry.mock.calls[0][1].headers).toEqual({});
  });

  it.each([[null], [{}], [{ following: true }], [{ following: true, followers: "5", following_count: 1 }], [{ following: "true", followers: 1, following_count: 1 }], [{ following: true, followers: -1, following_count: 1 }]])(
    "rejects an unusable success body %j instead of applying it",
    async (body) => {
      mocks.fetchJsonWithRetry.mockResolvedValue(body);

      await expect(followPlayerRequest(ID)).rejects.toThrow("Не удалось выполнить запрос");
    }
  );

  it("propagates the API's safe error message", async () => {
    mocks.fetchJsonWithRetry.mockRejectedValue(new Error("Игрок не найден"));

    await expect(followPlayerRequest(ID)).rejects.toThrow("Игрок не найден");
  });
});

describe("fetchFollowers / fetchFollowing", () => {
  const row = {
    id: "44444444-4444-4444-8444-444444444444",
    display_name: "Alex",
    telegram_avatar_url: "https://example.com/tg.png",
    custom_avatar_url: null,
  };

  it("followers: GET /api/players/:id/followers with limit and offset", async () => {
    mocks.fetchJsonWithRetry.mockResolvedValue({ items: [row], total: 1 });

    await fetchFollowers(ID, 50, 0);

    expect(mocks.fetchJsonWithRetry.mock.calls[0][0]).toBe(`/api/players/${ID}/followers?limit=50&offset=0`);
  });

  it("following: GET /api/players/:id/following with limit and offset", async () => {
    mocks.fetchJsonWithRetry.mockResolvedValue({ items: [], total: 0 });

    await fetchFollowing(ID, 100, 250);

    expect(mocks.fetchJsonWithRetry.mock.calls[0][0]).toBe(`/api/players/${ID}/following?limit=100&offset=250`);
  });

  it("encodes the player id into the path", async () => {
    mocks.fetchJsonWithRetry.mockResolvedValue({ items: [], total: 0 });

    await fetchFollowers("a/b?c", 50, 0);

    expect(mocks.fetchJsonWithRetry.mock.calls[0][0]).toBe("/api/players/a%2Fb%3Fc/followers?limit=50&offset=0");
  });

  it("is a PUBLIC read: plain no-store GET, no auth headers, no Telegram state, default retry policy", async () => {
    mocks.fetchJsonWithRetry.mockResolvedValue({ items: [], total: 0 });

    await fetchFollowers(ID, 50, 0);
    await fetchFollowing(ID, 50, 0);

    for (const call of mocks.fetchJsonWithRetry.mock.calls) {
      expect(call[1]).toEqual({ cache: "no-store" });
      expect(call).toHaveLength(2); // no explicit retries override
    }
    expect(mocks.getAdminHeaders).not.toHaveBeenCalled();
  });

  it("returns the validated page; unknown fields (username, email, ...) are dropped", async () => {
    mocks.fetchJsonWithRetry.mockResolvedValue({
      items: [{ ...row, username: "secret_handle", email: "secret@example.com", telegram_id: 42 }],
      total: 7,
      extra: "x",
    });

    const page = await fetchFollowers(ID, 50, 0);

    expect(page).toEqual({ items: [row], total: 7 });
    expect(Object.keys(page.items[0]).sort()).toEqual([
      "custom_avatar_url",
      "display_name",
      "id",
      "telegram_avatar_url",
    ]);
    expect(JSON.stringify(page)).not.toContain("secret");
  });

  it("supports total 0 with an empty list", async () => {
    mocks.fetchJsonWithRetry.mockResolvedValue({ items: [], total: 0 });

    await expect(fetchFollowing(ID, 50, 0)).resolves.toEqual({ items: [], total: 0 });
  });

  it("turns missing or non-string avatars into null", async () => {
    mocks.fetchJsonWithRetry.mockResolvedValue({
      items: [{ id: row.id, display_name: "Alex", telegram_avatar_url: 5, custom_avatar_url: "" }],
      total: 1,
    });

    const page = await fetchFollowers(ID, 50, 0);

    expect(page.items[0].telegram_avatar_url).toBeNull();
    expect(page.items[0].custom_avatar_url).toBeNull();
  });

  it.each([
    [null],
    [undefined],
    ["text"],
    [{}],
    [{ items: [], total: -1 }],
    [{ items: [], total: 1.5 }],
    [{ items: [], total: "3" }],
    [{ items: "nope", total: 1 }],
    [{ items: [{ display_name: "No id" }], total: 1 }],
    [{ items: [{ id: "", display_name: "Empty id" }], total: 1 }],
    [{ items: [{ id: "x" }], total: 1 }],
    [{ items: [null], total: 1 }],
  ])("rejects an invalid response %j", async (body) => {
    mocks.fetchJsonWithRetry.mockResolvedValue(body);

    await expect(fetchFollowers(ID, 50, 0)).rejects.toThrow("Не удалось выполнить запрос");
  });

  it.each([[0, 0], [-1, 0], [50, -1], [Number.NaN, 0], [50, Number.NaN], [1.5, 0], [50, 0.5]])(
    "rejects invalid pagination (limit=%s, offset=%s) without sending a request",
    async (limit, offset) => {
      await expect(fetchFollowers(ID, limit, offset)).rejects.toThrow();
      await expect(fetchFollowing(ID, limit, offset)).rejects.toThrow();

      expect(mocks.fetchJsonWithRetry).not.toHaveBeenCalled();
    }
  );

  it("propagates transport errors with their safe message", async () => {
    mocks.fetchJsonWithRetry.mockRejectedValue(new Error("Не удалось загрузить список. Попробуйте ещё раз."));

    await expect(fetchFollowing(ID, 50, 0)).rejects.toThrow("Не удалось загрузить список");
  });
});

describe("fetchFollowingIds", () => {
  it("GETs /api/players/:id/following/ids as a public no-store read (no auth headers, default retry) and returns every id", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    mocks.fetchJsonWithRetry.mockResolvedValue({ ids });

    const result = await fetchFollowingIds(ID);

    expect(result).toEqual(ids);
    expect(result).toHaveLength(120); // not capped at a 50-row page
    const call = mocks.fetchJsonWithRetry.mock.calls[0];
    expect(call[0]).toBe(`/api/players/${ID}/following/ids`);
    expect(call[1]).toEqual({ cache: "no-store" });
    expect(call).toHaveLength(2);
    expect(mocks.getAdminHeaders).not.toHaveBeenCalled();
  });

  it("supports an empty list and encodes the id", async () => {
    mocks.fetchJsonWithRetry.mockResolvedValue({ ids: [] });

    await expect(fetchFollowingIds("a/b")).resolves.toEqual([]);
    expect(mocks.fetchJsonWithRetry.mock.calls[0][0]).toBe("/api/players/a%2Fb/following/ids");
  });

  it.each([[null], [{}], [{ ids: "x" }], [{ ids: [1] }], [{ ids: [""] }], [{ ids: ["ok", null] }]])(
    "rejects an invalid body %j",
    async (body) => {
      mocks.fetchJsonWithRetry.mockResolvedValue(body);

      await expect(fetchFollowingIds(ID)).rejects.toThrow("Не удалось выполнить запрос");
    }
  );

  it("propagates transport errors", async () => {
    mocks.fetchJsonWithRetry.mockRejectedValue(new Error("Не удалось загрузить список. Попробуйте ещё раз."));

    await expect(fetchFollowingIds(ID)).rejects.toThrow("Не удалось загрузить список");
  });
});
