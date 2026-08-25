import { describe, expect, it, vi, beforeEach } from "vitest";

const mockVerifyIntegrationRequest = vi.fn();
const mockGetIntegrationTournamentList = vi.fn();

vi.mock("@/lib/integration-auth", () => ({
  verifyIntegrationRequest: mockVerifyIntegrationRequest,
}));

vi.mock("@/features/tournaments", () => ({
  getIntegrationTournamentList: mockGetIntegrationTournamentList,
}));

const { GET, dynamic } = await import("@/app/api/integrations/v1/tournaments/route");

beforeEach(() => {
  mockVerifyIntegrationRequest.mockReset();
  mockGetIntegrationTournamentList.mockReset();
});

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) {
    headers.set("authorization", authorization);
  }
  return new Request("http://localhost/api/integrations/v1/tournaments", { headers });
}

describe("GET /api/integrations/v1/tournaments", () => {
  it("is force-dynamic, never statically generated at build time", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns 401 without ever calling the feature layer when there is no Bearer token", async () => {
    mockVerifyIntegrationRequest.mockReturnValue(false);

    const response = await GET(request());
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ error: "Unauthorized" });
    expect(mockGetIntegrationTournamentList).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid Bearer token", async () => {
    mockVerifyIntegrationRequest.mockReturnValue(false);

    const response = await GET(request("Bearer garbage-token"));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ error: "Unauthorized" });
    expect(mockGetIntegrationTournamentList).not.toHaveBeenCalled();
  });

  it("returns open tournaments only, matching the current contract shape", async () => {
    mockVerifyIntegrationRequest.mockReturnValue(true);
    mockGetIntegrationTournamentList.mockResolvedValue([
      {
        id: "t1",
        title: "CLASSIC",
        startAt: "2026-08-26T16:00:00.000Z",
        status: "open",
        tournamentType: "classic",
      },
    ]);

    const response = await GET(request("Bearer real-token"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      tournaments: [
        {
          id: "t1",
          title: "CLASSIC",
          startAt: "2026-08-26T16:00:00.000Z",
          status: "open",
          tournamentType: "classic",
        },
      ],
    });
    // No "completed" status anywhere in the response -- this endpoint no
    // longer offers completed tournaments as candidates for a new binding
    // (see features/tournaments.ts::getIntegrationTournamentList's doc
    // comment).
    expect(json.tournaments.every((t: { status: string }) => t.status === "open")).toBe(true);
  });
});
