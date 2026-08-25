import { beforeEach, describe, expect, it, vi } from "vitest";

const mockVerify = vi.fn();
const mockGetState = vi.fn();

vi.mock("@/lib/integration-auth", () => ({ verifyIntegrationRequest: mockVerify }));
vi.mock("@/features/late-registration", () => ({
  getTournamentStateForIntegration: mockGetState,
}));

const { TournamentNotFoundError } = await import("@/lib/tournament-errors");
const { GET, dynamic } = await import(
  "@/app/api/integrations/v1/tournaments/[id]/state/route"
);

function request() {
  return new Request("http://localhost/api/integrations/v1/tournaments/t1/state", {
    headers: { authorization: "Bearer token" },
  });
}

const context = { params: Promise.resolve({ id: "t1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockVerify.mockReturnValue(true);
});

describe("GET /api/integrations/v1/tournaments/:id/state", () => {
  it("is force-dynamic and protected by integration Bearer auth", async () => {
    expect(dynamic).toBe("force-dynamic");
    mockVerify.mockReturnValue(false);
    const response = await GET(request(), context);
    expect(response.status).toBe(401);
    expect(mockGetState).not.toHaveBeenCalled();
  });

  it("returns the open contract before close", async () => {
    mockGetState.mockResolvedValue({
      lateRegistration: { status: "open", closedAt: null },
      rating: null,
    });
    const response = await GET(request(), context);
    expect(await response.json()).toEqual({
      lateRegistration: { status: "open", closedAt: null },
      rating: null,
    });
  });

  it("returns only frozen place points after close, without PII or raw rows", async () => {
    mockGetState.mockResolvedValue({
      lateRegistration: { status: "closed", closedAt: "2026-08-25T12:00:00.000Z" },
      rating: { places: [{ place: 1, points: 70 }] },
    });
    const response = await GET(request(), context);
    const json = await response.json();
    expect(json.rating.places).toEqual([{ place: 1, points: 70 }]);
    expect(JSON.stringify(json)).not.toMatch(/player|email|telegram|sheet/i);
  });

  it("maps a missing tournament to 404", async () => {
    mockGetState.mockRejectedValue(new TournamentNotFoundError("t1"));
    const response = await GET(request(), context);
    expect(response.status).toBe(404);
  });
});
