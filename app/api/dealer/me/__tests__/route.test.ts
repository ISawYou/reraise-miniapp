import { describe, expect, it, vi, beforeEach } from "vitest";

const mockResolveCurrentServerActor = vi.fn();
const mockGetPersonalDealerSummary = vi.fn();

// Wholesale module mocks -- NOT vi.importActual + spread. A function's
// internal call to a sibling export (assertServerActorRole ->
// resolveCurrentServerActor, or here the route -> resolveCurrentServerActor)
// goes through the module's internal ESM binding, not the exported object,
// so overriding just one named export via importActual would silently not
// redirect the call. See features/__tests__/tournament-admin-actions-auth.test.ts
// for the same lesson learned on lib/admin-auth.
vi.mock("@/lib/admin-auth", () => ({
  resolveCurrentServerActor: mockResolveCurrentServerActor,
}));

vi.mock("@/features/dealers", () => ({
  getPersonalDealerSummary: mockGetPersonalDealerSummary,
}));

const { GET } = await import("@/app/api/dealer/me/route");

beforeEach(() => {
  mockResolveCurrentServerActor.mockReset();
  mockGetPersonalDealerSummary.mockReset();
});

describe("GET /api/dealer/me", () => {
  it("returns 401 and never queries dealer data when there is no authenticated caller", async () => {
    mockResolveCurrentServerActor.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mockGetPersonalDealerSummary).not.toHaveBeenCalled();
  });

  it("derives the queried player id ONLY from the authenticated caller, never from the request", async () => {
    mockResolveCurrentServerActor.mockResolvedValue({ id: "p1", role: "player" });
    mockGetPersonalDealerSummary.mockResolvedValue({
      dealer: { isActive: true },
      openShift: null,
      monthSummary: { completedShiftCount: 0, uniqueTournamentCount: 0, workedMinutes: 0, paidHours: 0, amountRub: 0 },
      history: [],
    });

    const response = await GET();
    const json = await response.json();

    expect(mockGetPersonalDealerSummary).toHaveBeenCalledWith("p1");
    expect(mockGetPersonalDealerSummary).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(json.dealer).toEqual({ isActive: true });
  });

  it("a different authenticated caller only ever gets their OWN id queried, never another player's", async () => {
    mockResolveCurrentServerActor.mockResolvedValue({ id: "p2", role: "player" });
    mockGetPersonalDealerSummary.mockResolvedValue({
      dealer: null,
      openShift: null,
      monthSummary: { completedShiftCount: 0, uniqueTournamentCount: 0, workedMinutes: 0, paidHours: 0, amountRub: 0 },
      history: [],
    });

    await GET();

    expect(mockGetPersonalDealerSummary).toHaveBeenCalledWith("p2");
  });

  it("an ordinary player with no dealer profile gets dealer: null, not an error", async () => {
    mockResolveCurrentServerActor.mockResolvedValue({ id: "p1", role: "player" });
    mockGetPersonalDealerSummary.mockResolvedValue({
      dealer: null,
      openShift: null,
      monthSummary: { completedShiftCount: 0, uniqueTournamentCount: 0, workedMinutes: 0, paidHours: 0, amountRub: 0 },
      history: [],
    });

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.dealer).toBeNull();
  });

  it("returns 500 with the feature-layer error message when the query fails", async () => {
    mockResolveCurrentServerActor.mockResolvedValue({ id: "p1", role: "player" });
    mockGetPersonalDealerSummary.mockRejectedValue(new Error("db unreachable"));

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe("db unreachable");
  });

  it("an operator who also has a dealer profile gets their own dealer data too -- dealer is orthogonal to role", async () => {
    mockResolveCurrentServerActor.mockResolvedValue({ id: "op1", role: "operator" });
    mockGetPersonalDealerSummary.mockResolvedValue({
      dealer: { isActive: true },
      openShift: null,
      monthSummary: { completedShiftCount: 0, uniqueTournamentCount: 0, workedMinutes: 0, paidHours: 0, amountRub: 0 },
      history: [],
    });

    const response = await GET();
    const json = await response.json();

    expect(mockGetPersonalDealerSummary).toHaveBeenCalledWith("op1");
    expect(response.status).toBe(200);
    expect(json.dealer).toEqual({ isActive: true });
  });

  it("a Super Admin who also has a dealer profile gets their own dealer data too", async () => {
    mockResolveCurrentServerActor.mockResolvedValue({ id: "admin1", role: "admin" });
    mockGetPersonalDealerSummary.mockResolvedValue({
      dealer: { isActive: true },
      openShift: null,
      monthSummary: { completedShiftCount: 0, uniqueTournamentCount: 0, workedMinutes: 0, paidHours: 0, amountRub: 0 },
      history: [],
    });

    const response = await GET();
    const json = await response.json();

    expect(mockGetPersonalDealerSummary).toHaveBeenCalledWith("admin1");
    expect(response.status).toBe(200);
    expect(json.dealer).toEqual({ isActive: true });
  });
});
