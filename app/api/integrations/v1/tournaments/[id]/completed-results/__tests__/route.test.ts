import { describe, expect, it, vi, beforeEach } from "vitest";

const mockVerify = vi.fn();
const mockGet = vi.fn();

vi.mock("@/lib/integration-auth", () => ({ verifyIntegrationRequest: mockVerify }));
vi.mock("@/features/tournaments", () => ({ getCompletedTournamentResults: mockGet }));

const { GET, dynamic } = await import("@/app/api/integrations/v1/tournaments/[id]/completed-results/route");
const { TournamentNotFoundError } = await import("@/lib/tournament-errors");
const { CompletedResultsNotReadyError, CompletedResultsUnavailableError, UnsupportedCompletedResultsTypeError } = await import("@/lib/completed-results");

const request = () => new Request("http://localhost/api/integrations/v1/tournaments/t1/completed-results", { headers: { authorization: "Bearer token" } });
const context = (id = "t1") => ({ params: Promise.resolve({ id }) });

beforeEach(() => { mockVerify.mockReset(); mockGet.mockReset(); });

describe("GET /api/integrations/v1/tournaments/:id/completed-results", () => {
  it("is force-dynamic and rejects unauthorized requests", async () => {
    expect(dynamic).toBe("force-dynamic");
    mockVerify.mockReturnValue(false);
    const response = await GET(request(), context());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("returns canonical results and no-store headers", async () => {
    mockVerify.mockReturnValue(true);
    mockGet.mockResolvedValue({ tournamentId: "t1", title: "Classic", tournamentType: "classic", status: "completed", ratingApplicable: true, completedAt: null, participantsCount: 3, results: [] });
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ tournamentId: "t1", status: "completed", participantsCount: 3 });
  });

  it.each([
    [new TournamentNotFoundError("t1"), 404, undefined],
    [new CompletedResultsNotReadyError(), 409, "RESULTS_NOT_READY"],
    [new CompletedResultsUnavailableError(), 502, "RESULTS_UNAVAILABLE"],
    [new UnsupportedCompletedResultsTypeError("unknown"), 422, "UNSUPPORTED_TOURNAMENT_TYPE"],
  ])("maps domain error to stable HTTP response", async (error, status, code) => {
    mockVerify.mockReturnValue(true);
    mockGet.mockRejectedValue(error);
    const response = await GET(request(), context());
    expect(response.status).toBe(status);
    const json = await response.json();
    if (code) expect(json.code).toBe(code);
  });

  it("maps unexpected failures to safe 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockVerify.mockReturnValue(true);
    mockGet.mockRejectedValue(new Error("database secret details"));
    const response = await GET(request(), context());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("database secret details");
  });
});
