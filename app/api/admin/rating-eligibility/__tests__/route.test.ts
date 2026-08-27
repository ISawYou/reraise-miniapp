import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFindActive = vi.fn();
const mockListRatingEligibility = vi.fn();
const mockSetRatingEligibility = vi.fn();
const mockResolveCurrentServerActor = vi.fn();

vi.mock("@/lib/repositories", () => ({
  seasonRepository: { findActive: mockFindActive },
}));

vi.mock("@/features/rating-eligibility", () => ({
  listRatingEligibility: mockListRatingEligibility,
  setRatingEligibility: mockSetRatingEligibility,
}));

// Wholesale module mock, not importActual + spread -- see
// features/__tests__/tournament-admin-actions-auth.test.ts for why a
// function's internal call to a sibling export can't be redirected that way.
vi.mock("@/lib/admin-auth", () => ({
  resolveCurrentServerActor: mockResolveCurrentServerActor,
}));

const { GET, PATCH } = await import("@/app/api/admin/rating-eligibility/route");

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/admin/rating-eligibility", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockFindActive.mockReset();
  mockListRatingEligibility.mockReset();
  mockSetRatingEligibility.mockReset();
  mockResolveCurrentServerActor.mockReset();
});

describe("GET /api/admin/rating-eligibility", () => {
  it("returns the active season and its player list", async () => {
    mockFindActive.mockResolvedValue({ id: "s1", title: "Season 1" });
    mockListRatingEligibility.mockResolvedValue([
      { playerId: "p1", displayName: "Player 1", username: "p1", points: 100, excluded: false, reason: null },
    ]);

    const response = await GET();
    const json = await response.json();

    expect(mockListRatingEligibility).toHaveBeenCalledWith("s1");
    expect(response.status).toBe(200);
    expect(json.season).toEqual({ id: "s1", title: "Season 1" });
    expect(json.players).toHaveLength(1);
  });

  it("returns 404 when there is no active season", async () => {
    mockFindActive.mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(404);
    expect(mockListRatingEligibility).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/rating-eligibility", () => {
  it("derives created_by/actor from the authenticated caller, never from the request body", async () => {
    mockFindActive.mockResolvedValue({ id: "s1", title: "Season 1" });
    mockResolveCurrentServerActor.mockResolvedValue({ id: "real-admin", role: "admin" });

    const response = await PATCH(
      patchRequest({ playerId: "p1", excluded: true, reason: "Владелец", actorPlayerId: "spoofed-id" })
    );

    expect(response.status).toBe(200);
    expect(mockSetRatingEligibility).toHaveBeenCalledWith("s1", "p1", true, "Владелец", "real-admin");
  });

  it("rejects a missing playerId", async () => {
    mockFindActive.mockResolvedValue({ id: "s1", title: "Season 1" });

    const response = await PATCH(patchRequest({ excluded: true }));

    expect(response.status).toBe(400);
    expect(mockSetRatingEligibility).not.toHaveBeenCalled();
  });

  it("rejects a missing/non-boolean excluded flag", async () => {
    mockFindActive.mockResolvedValue({ id: "s1", title: "Season 1" });

    const response = await PATCH(patchRequest({ playerId: "p1", excluded: "yes" }));

    expect(response.status).toBe(400);
    expect(mockSetRatingEligibility).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no authenticated caller (belt-and-suspenders on top of middleware)", async () => {
    mockFindActive.mockResolvedValue({ id: "s1", title: "Season 1" });
    mockResolveCurrentServerActor.mockResolvedValue(null);

    const response = await PATCH(patchRequest({ playerId: "p1", excluded: true }));

    expect(response.status).toBe(401);
    expect(mockSetRatingEligibility).not.toHaveBeenCalled();
  });

  it("setting excluded=false removes the exclusion (restores eligibility)", async () => {
    mockFindActive.mockResolvedValue({ id: "s1", title: "Season 1" });
    mockResolveCurrentServerActor.mockResolvedValue({ id: "real-admin", role: "admin" });

    await PATCH(patchRequest({ playerId: "p1", excluded: false }));

    expect(mockSetRatingEligibility).toHaveBeenCalledWith("s1", "p1", false, null, "real-admin");
  });
});
