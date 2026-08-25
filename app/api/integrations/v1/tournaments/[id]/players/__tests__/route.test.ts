import { describe, expect, it, vi, beforeEach } from "vitest";

const mockVerifyIntegrationRequest = vi.fn();
const mockGetArrivedPlayersForIntegration = vi.fn();

vi.mock("@/lib/integration-auth", () => ({
  verifyIntegrationRequest: mockVerifyIntegrationRequest,
}));

vi.mock("@/features/tournaments", () => ({
  getArrivedPlayersForIntegration: mockGetArrivedPlayersForIntegration,
}));

// TournamentNotFoundError is a plain class from a separate, unmocked module
// (lib/tournament-errors.ts) -- imported for real so `instanceof` inside the
// route handler works exactly as it does in production.
const { TournamentNotFoundError } = await import("@/lib/tournament-errors");
const { GET, dynamic } = await import("@/app/api/integrations/v1/tournaments/[id]/players/route");

beforeEach(() => {
  mockVerifyIntegrationRequest.mockReset();
  mockGetArrivedPlayersForIntegration.mockReset();
  vi.restoreAllMocks();
});

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) {
    headers.set("authorization", authorization);
  }
  return new Request("http://localhost/api/integrations/v1/tournaments/t1/players", { headers });
}

function context(id = "t1") {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/integrations/v1/tournaments/:id/players", () => {
  it("is force-dynamic, never statically generated at build time", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns 401 without ever calling the feature layer when there is no Bearer token", async () => {
    mockVerifyIntegrationRequest.mockReturnValue(false);

    const response = await GET(request(), context());
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ error: "Unauthorized" });
    expect(mockGetArrivedPlayersForIntegration).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid Bearer token", async () => {
    mockVerifyIntegrationRequest.mockReturnValue(false);

    const response = await GET(request("Bearer garbage-token"), context());
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ error: "Unauthorized" });
  });

  it("returns 404 for an unknown tournament", async () => {
    mockVerifyIntegrationRequest.mockReturnValue(true);
    mockGetArrivedPlayersForIntegration.mockRejectedValue(new TournamentNotFoundError("unknown-id"));

    const response = await GET(request("Bearer real-token"), context("unknown-id"));
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json).toEqual({ error: "Tournament not found" });
  });

  it("returns 500 (and logs, never leaking the raw error) for an unexpected failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockVerifyIntegrationRequest.mockReturnValue(true);
    mockGetArrivedPlayersForIntegration.mockRejectedValue(new Error("db connection reset"));

    const response = await GET(request("Bearer real-token"), context());
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toEqual({ error: "Internal error" });
    expect(JSON.stringify(json)).not.toContain("db connection reset");
    expect(consoleError).toHaveBeenCalled();
  });

  it("returns arrived players including eliminated=true ones, not filtered out", async () => {
    mockVerifyIntegrationRequest.mockReturnValue(true);
    mockGetArrivedPlayersForIntegration.mockResolvedValue([
      { id: "p1", nickname: "Active Player", avatarUrl: null, ratingPoints: 10, eliminated: false },
      { id: "p2", nickname: "Busted Player", avatarUrl: null, ratingPoints: 0, eliminated: true },
    ]);

    const response = await GET(request("Bearer real-token"), context());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.players).toHaveLength(2);
    expect(json.players.find((p: { id: string }) => p.id === "p2")).toEqual({
      id: "p2",
      nickname: "Busted Player",
      avatarUrl: null,
      ratingPoints: 0,
      eliminated: true,
    });
  });

  it("avatarUrl and ratingPoints nullable semantics pass through unchanged", async () => {
    mockVerifyIntegrationRequest.mockReturnValue(true);
    mockGetArrivedPlayersForIntegration.mockResolvedValue([
      { id: "p1", nickname: "No Season No Avatar", avatarUrl: null, ratingPoints: null, eliminated: false },
    ]);

    const response = await GET(request("Bearer real-token"), context());
    const json = await response.json();

    expect(json.players[0].avatarUrl).toBeNull();
    expect(json.players[0].ratingPoints).toBeNull();
  });

  it("response contains no PII beyond the documented player contract fields", async () => {
    mockVerifyIntegrationRequest.mockReturnValue(true);
    mockGetArrivedPlayersForIntegration.mockResolvedValue([
      { id: "p1", nickname: "Player", avatarUrl: null, ratingPoints: 5, eliminated: false },
    ]);

    const response = await GET(request("Bearer real-token"), context());
    const json = await response.json();

    expect(Object.keys(json.players[0]).sort()).toEqual(
      ["avatarUrl", "eliminated", "id", "nickname", "ratingPoints"].sort()
    );
    const raw = JSON.stringify(json);
    for (const forbidden of ["email", "telegram", "username", "role", "moderation", "access"]) {
      expect(raw.toLowerCase()).not.toContain(forbidden);
    }
  });
});
