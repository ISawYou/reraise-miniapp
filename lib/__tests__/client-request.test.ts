import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/client-request.ts -- the shared authenticated-request helper used by
// teams, dealer, admin, home and profile callers. The Telegram-context
// decision is tested here with @/lib/telegram mocked; the decision's own
// reliability (isTelegramMiniAppContext) is tested in
// telegram-context.test.ts.

const mocks = vi.hoisted(() => ({
  getTelegramInitData: vi.fn(),
  isTelegramMiniAppContext: vi.fn(),
}));

vi.mock("@/lib/telegram", () => ({
  getTelegramInitData: mocks.getTelegramInitData,
  isTelegramMiniAppContext: mocks.isTelegramMiniAppContext,
}));

const { getAdminHeaders, fetchAdminJson, fetchJsonWithRetry } = await import("@/lib/client-request");

const fetchMock = vi.fn();

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

beforeEach(() => {
  mocks.getTelegramInitData.mockReset().mockResolvedValue("init-data");
  mocks.isTelegramMiniAppContext.mockReset().mockReturnValue(true);
  fetchMock.mockReset().mockResolvedValue(jsonResponse({ ok: 1 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("getAdminHeaders", () => {
  it("normal browser: returns immediately and never calls getTelegramInitData (even if it would hang forever)", async () => {
    mocks.isTelegramMiniAppContext.mockReturnValue(false);
    mocks.getTelegramInitData.mockReturnValue(new Promise(() => {}));

    await expect(getAdminHeaders()).resolves.toEqual({});

    expect(mocks.getTelegramInitData).not.toHaveBeenCalled();
  });

  it("normal browser: no X-Telegram-Init-Data header (not even an empty one)", async () => {
    mocks.isTelegramMiniAppContext.mockReturnValue(false);

    const headers = await getAdminHeaders();

    expect(Object.keys(headers)).toEqual([]);
    expect("X-Telegram-Init-Data" in headers).toBe(false);
  });

  it("Telegram Mini App: asks for initData", async () => {
    await getAdminHeaders();

    expect(mocks.getTelegramInitData).toHaveBeenCalledTimes(1);
  });

  it("Telegram Mini App with valid initData: sends X-Telegram-Init-Data", async () => {
    mocks.getTelegramInitData.mockResolvedValue("signed-init-data");

    await expect(getAdminHeaders()).resolves.toEqual({ "X-Telegram-Init-Data": "signed-init-data" });
  });

  it("Telegram Mini App with unavailable initData: existing fallback (no header; cookie auth on the server)", async () => {
    mocks.getTelegramInitData.mockResolvedValue("");

    await expect(getAdminHeaders()).resolves.toEqual({});
    expect(mocks.getTelegramInitData).toHaveBeenCalledTimes(1);
  });
});

describe("fetchAdminJson", () => {
  it("Telegram: sends the initData header, preserves custom headers/method/body, parses JSON", async () => {
    const result = await fetchAdminJson<{ ok: number }>("/api/teams/me", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(result).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/teams/me");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(init.headers).toEqual({
      "X-Telegram-Init-Data": "init-data",
      "Content-Type": "application/json",
    });
  });

  it("a caller-supplied header wins over the computed one (unchanged precedence)", async () => {
    await fetchAdminJson("/api/x", { headers: { "X-Telegram-Init-Data": "caller-value" } });

    expect(fetchMock.mock.calls[0][1].headers["X-Telegram-Init-Data"]).toBe("caller-value");
  });

  it("normal browser: the request carries no Telegram header and starts without any initData wait", async () => {
    mocks.isTelegramMiniAppContext.mockReturnValue(false);
    mocks.getTelegramInitData.mockReturnValue(new Promise(() => {}));

    const result = await fetchAdminJson<{ ok: number }>("/api/dealer/me", { headers: { Accept: "application/json" } });

    expect(result).toEqual({ ok: 1 });
    expect(mocks.getTelegramInitData).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Accept: "application/json" });
  });

  it("retry policy is unchanged: one retry by default after a failure", async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(jsonResponse({ ok: 2 }));

    const promise = fetchAdminJson<{ ok: number }>("/api/x");
    await vi.advanceTimersByTimeAsync(400);

    await expect(promise).resolves.toEqual({ ok: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retry policy is unchanged: a 4xx is still retried once by default and its API message surfaces", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse({ error: "Игрок не найден" }, false));

    const promise = fetchAdminJson("/api/x");
    const assertion = expect(promise).rejects.toThrow("Игрок не найден");
    await vi.advanceTimersByTimeAsync(400);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchAdminJson { retries: 0 } (side-effecting sends, e.g. Telegram broadcasts)", () => {
  it("a 504 results in exactly ONE fetch attempt and surfaces the error", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({ ok: false, status: 504, json: async () => { throw new SyntaxError("html"); } } as unknown as Response);

    const promise = fetchAdminJson("/api/admin/tournaments/notify", { method: "POST", body: "{}" }, { retries: 0 });
    const assertion = expect(promise).rejects.toThrow("Не удалось выполнить запрос");
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a network TypeError results in exactly ONE fetch attempt", async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const promise = fetchAdminJson("/api/x", { method: "POST" }, { retries: 0 });
    const assertion = expect(promise).rejects.toThrow("Сеть нестабильна");
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still sends the admin headers and the exact same body", async () => {
    await fetchAdminJson("/api/x", { method: "POST", body: '{"broadcastId":"b"}' }, { retries: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: '{"broadcastId":"b"}',
      headers: { "X-Telegram-Init-Data": "init-data" },
    });
  });

  it("omitting options (or retries) keeps the default single retry for every other caller", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse({ error: "boom" }, false));

    const promise = fetchAdminJson("/api/x", { method: "POST" }, {});
    const assertion = expect(promise).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(400);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchJsonWithRetry", () => {
  it("retries = 0 sends a single request (the follow mutations' path)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Игрок не найден" }, false));

    await expect(fetchJsonWithRetry("/api/x", { method: "POST" }, 0)).rejects.toThrow("Игрок не найден");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
