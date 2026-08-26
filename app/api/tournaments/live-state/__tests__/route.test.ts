import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetPokerClockLiveState = vi.fn();
const mockGetArrivedPlayersForIntegration = vi.fn();
const mockGetTournamentStateForIntegration = vi.fn();

vi.mock("@/lib/poker-clock-client", () => ({
  getPokerClockLiveState: mockGetPokerClockLiveState,
}));

vi.mock("@/features/tournaments", () => ({
  getArrivedPlayersForIntegration: mockGetArrivedPlayersForIntegration,
}));

vi.mock("@/features/late-registration", () => ({
  getTournamentStateForIntegration: mockGetTournamentStateForIntegration,
}));

const { GET, dynamic } = await import("@/app/api/tournaments/live-state/route");

function request(idsParam: string) {
  return new Request(
    `http://localhost/api/tournaments/live-state?ids=${encodeURIComponent(idsParam)}`
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tournaments/live-state", () => {
  it("is force-dynamic, never statically generated/cached at build time", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns an empty result set for no ids, without calling any downstream service", async () => {
    const response = await GET(request(""));
    const json = await response.json();

    expect(json).toEqual({ results: {} });
    expect(mockGetPokerClockLiveState).not.toHaveBeenCalled();
  });

  it("unlinked tournament (Poker Clock 404) -> clock null, old card stays functional", async () => {
    mockGetPokerClockLiveState.mockResolvedValue(null);
    mockGetTournamentStateForIntegration.mockResolvedValue({
      lateRegistration: { status: "open", closedAt: null },
      rating: null,
    });

    const response = await GET(request("t1"));
    const json = await response.json();

    expect(json.results.t1.clock).toBeNull();
    expect(json.results.t1.attendance).toBeNull();
    expect(mockGetArrivedPlayersForIntegration).not.toHaveBeenCalled();
  });

  it("draft clock -> not live, no attendance lookup performed", async () => {
    mockGetPokerClockLiveState.mockResolvedValue({
      status: "draft",
      startedAt: null,
      currentLevel: null,
      smallBlind: null,
      bigBlind: null,
      lateRegistrationRemainingSeconds: null,
    });
    mockGetTournamentStateForIntegration.mockResolvedValue({
      lateRegistration: { status: "open", closedAt: null },
      rating: null,
    });

    const response = await GET(request("t1"));
    const json = await response.json();

    expect(json.results.t1.clock.status).toBe("draft");
    expect(json.results.t1.attendance).toBeNull();
    expect(mockGetArrivedPlayersForIntegration).not.toHaveBeenCalled();
  });

  it("running clock -> live, attendance derived from the existing arrived/eliminated aggregate", async () => {
    mockGetPokerClockLiveState.mockResolvedValue({
      status: "running",
      startedAt: "2026-08-26T19:05:00.000Z",
      currentLevel: 5,
      smallBlind: 300,
      bigBlind: 600,
      lateRegistrationRemainingSeconds: 2280,
    });
    mockGetTournamentStateForIntegration.mockResolvedValue({
      lateRegistration: { status: "open", closedAt: null },
      rating: null,
    });
    mockGetArrivedPlayersForIntegration.mockResolvedValue([
      { id: "p1", eliminated: false },
      { id: "p2", eliminated: false },
      { id: "p3", eliminated: true },
    ]);

    const response = await GET(request("t1"));
    const json = await response.json();

    expect(json.results.t1.clock.status).toBe("running");
    expect(json.results.t1.attendance).toEqual({ arrived: 3, active: 2 });
    expect(json.results.t1.lateRegistration).toEqual({ status: "open", closedAt: null });
  });

  it("paused clock still counts as live", async () => {
    mockGetPokerClockLiveState.mockResolvedValue({
      status: "paused",
      startedAt: "2026-08-26T19:05:00.000Z",
      currentLevel: 5,
      smallBlind: 300,
      bigBlind: 600,
      lateRegistrationRemainingSeconds: null,
    });
    mockGetTournamentStateForIntegration.mockResolvedValue({
      lateRegistration: { status: "closed", closedAt: "2026-08-26T19:30:00.000Z" },
      rating: { places: [] },
    });
    mockGetArrivedPlayersForIntegration.mockResolvedValue([{ id: "p1", eliminated: false }]);

    const response = await GET(request("t1"));
    const json = await response.json();

    expect(json.results.t1.attendance).toEqual({ arrived: 1, active: 1 });
    expect(json.results.t1.lateRegistration).toEqual({
      status: "closed",
      closedAt: "2026-08-26T19:30:00.000Z",
    });
  });

  it("finished clock -> not live", async () => {
    mockGetPokerClockLiveState.mockResolvedValue({
      status: "finished",
      startedAt: "2026-08-26T19:05:00.000Z",
      currentLevel: 12,
      smallBlind: 2000,
      bigBlind: 4000,
      lateRegistrationRemainingSeconds: null,
    });
    mockGetTournamentStateForIntegration.mockResolvedValue({
      lateRegistration: { status: "closed", closedAt: "2026-08-26T19:30:00.000Z" },
      rating: { places: [] },
    });

    const response = await GET(request("t1"));
    const json = await response.json();

    expect(json.results.t1.attendance).toBeNull();
    expect(mockGetArrivedPlayersForIntegration).not.toHaveBeenCalled();
  });

  it("a non-free tournament (late-registration lookup throws) -> lateRegistration null, not 'open'", async () => {
    mockGetPokerClockLiveState.mockResolvedValue({
      status: "running",
      startedAt: "2026-08-26T19:05:00.000Z",
      currentLevel: 1,
      smallBlind: 100,
      bigBlind: 200,
      lateRegistrationRemainingSeconds: 600,
    });
    mockGetTournamentStateForIntegration.mockRejectedValue(
      new Error("Late Registration snapshot поддерживается только для рейтинговых free-турниров")
    );
    mockGetArrivedPlayersForIntegration.mockResolvedValue([]);

    const response = await GET(request("t1"));
    const json = await response.json();

    expect(json.results.t1.lateRegistration).toBeNull();
  });

  it("one tournament's failure never breaks the batch for the others", async () => {
    mockGetPokerClockLiveState.mockImplementation((id: string) =>
      id === "bad" ? Promise.reject(new Error("boom")) : Promise.resolve(null)
    );
    mockGetTournamentStateForIntegration.mockResolvedValue({
      lateRegistration: { status: "open", closedAt: null },
      rating: null,
    });

    const response = await GET(request("bad,good"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.results.bad.clock).toBeNull();
    expect(json.results.good.clock).toBeNull();
  });

  it("dedupes ids and caps the batch size", async () => {
    mockGetPokerClockLiveState.mockResolvedValue(null);
    mockGetTournamentStateForIntegration.mockResolvedValue({
      lateRegistration: { status: "open", closedAt: null },
      rating: null,
    });

    const manyIds = Array.from({ length: 30 }, (_, i) => `t${i}`);
    const response = await GET(request(["t1", "t1", ...manyIds].join(",")));
    const json = await response.json();

    expect(Object.keys(json.results).length).toBeLessThanOrEqual(20);
  });
});
