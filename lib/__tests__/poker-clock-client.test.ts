import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPokerClockLiveState } from "@/lib/poker-clock-client";

const ORIGINAL_ENV = { ...process.env };

function setConfig(baseUrl?: string, token?: string) {
  if (baseUrl === undefined) delete process.env.POKER_CLOCK_BASE_URL;
  else process.env.POKER_CLOCK_BASE_URL = baseUrl;

  if (token === undefined) delete process.env.POKER_CLOCK_LIVE_STATE_TOKEN;
  else process.env.POKER_CLOCK_LIVE_STATE_TOKEN = token;
}

beforeEach(() => {
  setConfig("http://poker-clock:3000", "secret-token");
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockFetchOnce(response: { ok: boolean; status?: number; json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("getPokerClockLiveState", () => {
  it("returns null and never fetches when POKER_CLOCK_BASE_URL is unset", async () => {
    setConfig(undefined, "secret-token");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await getPokerClockLiveState("t1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null and never fetches when POKER_CLOCK_LIVE_STATE_TOKEN is unset", async () => {
    setConfig("http://poker-clock:3000", undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await getPokerClockLiveState("t1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the outbound bearer token to the configured base URL", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => ({
        status: "draft",
        startedAt: null,
        currentLevel: null,
        smallBlind: null,
        bigBlind: null,
        lateRegistrationRemainingSeconds: null,
      }),
    });

    await getPokerClockLiveState("t1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://poker-clock:3000/api/integrations/v1/tournaments/t1/live-state",
      expect.objectContaining({
        headers: { Authorization: "Bearer secret-token" },
      })
    );
  });

  it("404 (no binding) resolves to null, not an error", async () => {
    mockFetchOnce({ ok: false, status: 404 });
    expect(await getPokerClockLiveState("t1")).toBeNull();
  });

  it("401/5xx resolve to null", async () => {
    mockFetchOnce({ ok: false, status: 401 });
    expect(await getPokerClockLiveState("t1")).toBeNull();

    mockFetchOnce({ ok: false, status: 500 });
    expect(await getPokerClockLiveState("t1")).toBeNull();
  });

  it("network error / timeout resolves to null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );
    expect(await getPokerClockLiveState("t1")).toBeNull();
  });

  it("malformed JSON body resolves to null", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => {
        throw new Error("not json");
      },
    });
    expect(await getPokerClockLiveState("t1")).toBeNull();
  });

  it("valid draft response parses through with all-null fields", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        status: "draft",
        startedAt: null,
        currentLevel: null,
        smallBlind: null,
        bigBlind: null,
        lateRegistrationRemainingSeconds: null,
      }),
    });

    expect(await getPokerClockLiveState("t1")).toEqual({
      status: "draft",
      startedAt: null,
      currentLevel: null,
      smallBlind: null,
      bigBlind: null,
      lateRegistrationRemainingSeconds: null,
    });
  });

  it("valid running response parses through", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        status: "running",
        startedAt: "2026-08-26T19:05:00.000Z",
        currentLevel: 5,
        smallBlind: 300,
        bigBlind: 600,
        lateRegistrationRemainingSeconds: 2280,
      }),
    });

    expect(await getPokerClockLiveState("t1")).toEqual({
      status: "running",
      startedAt: "2026-08-26T19:05:00.000Z",
      currentLevel: 5,
      smallBlind: 300,
      bigBlind: 600,
      lateRegistrationRemainingSeconds: 2280,
    });
  });

  it("running with missing level/blinds is treated as fully invalid, not zero/undefined", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        status: "running",
        startedAt: "2026-08-26T19:05:00.000Z",
        currentLevel: null,
        smallBlind: null,
        bigBlind: null,
        lateRegistrationRemainingSeconds: null,
      }),
    });

    expect(await getPokerClockLiveState("t1")).toBeNull();
  });

  it("wrong-typed field (e.g. currentLevel as a string) is malformed -> null", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        status: "running",
        startedAt: null,
        currentLevel: "5",
        smallBlind: 300,
        bigBlind: 600,
        lateRegistrationRemainingSeconds: null,
      }),
    });

    expect(await getPokerClockLiveState("t1")).toBeNull();
  });

  it("unknown status value is malformed -> null", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        status: "unknown",
        startedAt: null,
        currentLevel: null,
        smallBlind: null,
        bigBlind: null,
        lateRegistrationRemainingSeconds: null,
      }),
    });

    expect(await getPokerClockLiveState("t1")).toBeNull();
  });

  it("NaN numeric fields are rejected, not treated as valid numbers", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        status: "running",
        startedAt: null,
        currentLevel: Number.NaN,
        smallBlind: 300,
        bigBlind: 600,
        lateRegistrationRemainingSeconds: null,
      }),
    });

    expect(await getPokerClockLiveState("t1")).toBeNull();
  });

  it("paused clock is a valid contract value", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        status: "paused",
        startedAt: "2026-08-26T19:05:00.000Z",
        currentLevel: 5,
        smallBlind: 300,
        bigBlind: 600,
        lateRegistrationRemainingSeconds: null,
      }),
    });

    const result = await getPokerClockLiveState("t1");
    expect(result?.status).toBe("paused");
  });
});
