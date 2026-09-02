import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishPokerClockTournament, getPokerClockLiveState } from "@/lib/poker-clock-client";

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
        isBreak: null,
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

  it("valid draft response parses through with all-null fields, including isBreak", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        status: "draft",
        startedAt: null,
        currentLevel: null,
        smallBlind: null,
        bigBlind: null,
        lateRegistrationRemainingSeconds: null,
        isBreak: null,
      }),
    });

    expect(await getPokerClockLiveState("t1")).toEqual({
      status: "draft",
      startedAt: null,
      currentLevel: null,
      smallBlind: null,
      bigBlind: null,
      lateRegistrationRemainingSeconds: null,
      isBreak: null,
    });
  });

  it("valid running response (not on break) parses through", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        status: "running",
        startedAt: "2026-08-26T19:05:00.000Z",
        currentLevel: 5,
        smallBlind: 300,
        bigBlind: 600,
        lateRegistrationRemainingSeconds: 2280,
        isBreak: false,
      }),
    });

    expect(await getPokerClockLiveState("t1")).toEqual({
      status: "running",
      startedAt: "2026-08-26T19:05:00.000Z",
      currentLevel: 5,
      smallBlind: 300,
      bigBlind: 600,
      lateRegistrationRemainingSeconds: 2280,
      isBreak: false,
    });
  });

  it("valid running response on break parses through with isBreak true", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        status: "running",
        startedAt: "2026-08-26T19:05:00.000Z",
        currentLevel: 5,
        smallBlind: 300,
        bigBlind: 600,
        lateRegistrationRemainingSeconds: 2280,
        isBreak: true,
      }),
    });

    const result = await getPokerClockLiveState("t1");
    expect(result?.isBreak).toBe(true);
    // The break is carried as an explicit flag, not inferred from blinds --
    // level/blind numbers can still be present and non-zero during a break.
    expect(result?.smallBlind).toBe(300);
    expect(result?.bigBlind).toBe(600);
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
        isBreak: false,
      }),
    });

    expect(await getPokerClockLiveState("t1")).toBeNull();
  });

  it("running with isBreak missing entirely is fully invalid (contract requires it live)", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        status: "running",
        startedAt: "2026-08-26T19:05:00.000Z",
        currentLevel: 5,
        smallBlind: 300,
        bigBlind: 600,
        lateRegistrationRemainingSeconds: null,
        // isBreak omitted entirely
      }),
    });

    expect(await getPokerClockLiveState("t1")).toBeNull();
  });

  it("running with isBreak explicitly null is fully invalid -- draft-only value leaking into a live status", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        status: "running",
        startedAt: "2026-08-26T19:05:00.000Z",
        currentLevel: 5,
        smallBlind: 300,
        bigBlind: 600,
        lateRegistrationRemainingSeconds: null,
        isBreak: null,
      }),
    });

    expect(await getPokerClockLiveState("t1")).toBeNull();
  });

  it("wrong-typed isBreak (e.g. string) is malformed -> null", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        status: "running",
        startedAt: null,
        currentLevel: 5,
        smallBlind: 300,
        bigBlind: 600,
        lateRegistrationRemainingSeconds: null,
        isBreak: "true",
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
        isBreak: false,
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
        isBreak: null,
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
        isBreak: false,
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
        isBreak: false,
      }),
    });

    const result = await getPokerClockLiveState("t1");
    expect(result?.status).toBe("paused");
  });

  it("paused clock on break is a valid contract value", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        status: "paused",
        startedAt: "2026-08-26T19:05:00.000Z",
        currentLevel: 5,
        smallBlind: 300,
        bigBlind: 600,
        lateRegistrationRemainingSeconds: null,
        isBreak: true,
      }),
    });

    const result = await getPokerClockLiveState("t1");
    expect(result?.status).toBe("paused");
    expect(result?.isBreak).toBe(true);
  });

  it("finished response with a real isBreak parses through unchanged", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        status: "finished",
        startedAt: "2026-08-26T19:05:00.000Z",
        currentLevel: 12,
        smallBlind: 2000,
        bigBlind: 4000,
        lateRegistrationRemainingSeconds: null,
        isBreak: false,
      }),
    });

    const result = await getPokerClockLiveState("t1");
    expect(result?.status).toBe("finished");
    expect(result?.isBreak).toBe(false);
  });
});

describe("finishPokerClockTournament", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("POST 200 -> FINISHED", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200 });

    const result = await finishPokerClockTournament("t1");

    expect(result).toEqual({ status: "finished" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://poker-clock:3000/api/integrations/v1/tournaments/t1/finish",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("uses POST, not GET/PATCH", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200 });

    await finishPokerClockTournament("t1");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
  });

  it("sends the SAME existing outbound Bearer credential as getPokerClockLiveState (POKER_CLOCK_LIVE_STATE_TOKEN)", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200 });

    await finishPokerClockTournament("t1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { Authorization: "Bearer secret-token" } })
    );
  });

  it("URL-encodes the ReRaise tournament id path segment", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200 });

    await finishPokerClockTournament("weird id/with slash");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://poker-clock:3000/api/integrations/v1/tournaments/weird%20id%2Fwith%20slash/finish",
      expect.anything()
    );
  });

  it("404 (no linked Poker Clock tournament) -> NOT_LINKED, a normal no-op, not logged as an error", async () => {
    const errorSpy = vi.spyOn(console, "error");
    mockFetchOnce({ ok: false, status: 404 });

    const result = await finishPokerClockTournament("t1");

    expect(result).toEqual({ status: "not_linked" });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("401 -> FAILED", async () => {
    mockFetchOnce({ ok: false, status: 401 });
    const result = await finishPokerClockTournament("t1");
    expect(result).toEqual({ status: "failed", reason: "unauthorized" });
  });

  it("403 -> FAILED", async () => {
    mockFetchOnce({ ok: false, status: 403 });
    const result = await finishPokerClockTournament("t1");
    expect(result).toEqual({ status: "failed", reason: "unauthorized" });
  });

  it("409 (linked Clock tournament still draft -- lifecycle conflict) -> FAILED", async () => {
    mockFetchOnce({ ok: false, status: 409 });
    const result = await finishPokerClockTournament("t1");
    expect(result).toEqual({ status: "failed", reason: "lifecycle_conflict" });
  });

  it("5xx -> FAILED", async () => {
    mockFetchOnce({ ok: false, status: 500 });
    const result = await finishPokerClockTournament("t1");
    expect(result.status).toBe("failed");

    mockFetchOnce({ ok: false, status: 503 });
    const result2 = await finishPokerClockTournament("t1");
    expect(result2.status).toBe("failed");
  });

  it("network error -> FAILED", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await finishPokerClockTournament("t1");
    expect(result).toEqual({ status: "failed", reason: "network_error" });
  });

  it("timeout (AbortError) -> FAILED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }))
    );
    const result = await finishPokerClockTournament("t1");
    expect(result).toEqual({ status: "failed", reason: "timeout" });
  });

  it("missing POKER_CLOCK_BASE_URL -> FAILED, never fetches", async () => {
    setConfig(undefined, "secret-token");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await finishPokerClockTournament("t1");

    expect(result).toEqual({ status: "failed", reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("missing POKER_CLOCK_LIVE_STATE_TOKEN -> FAILED, never fetches", async () => {
    setConfig("http://poker-clock:3000", undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await finishPokerClockTournament("t1");

    expect(result).toEqual({ status: "failed", reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws, even on an unexpected non-404/401/403/409/5xx status", async () => {
    mockFetchOnce({ ok: false, status: 418 });
    const result = await finishPokerClockTournament("t1");
    expect(result.status).toBe("failed");
  });

  it("logs safe categorical context (tournamentId + reason label) for a FAILED outcome, never the raw response", async () => {
    const errorSpy = vi.spyOn(console, "error");
    mockFetchOnce({ ok: false, status: 500 });

    await finishPokerClockTournament("t1");

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("finish failed"),
      expect.objectContaining({ tournamentId: "t1", reason: "upstream_error" })
    );
  });
});
