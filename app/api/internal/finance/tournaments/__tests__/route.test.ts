import { describe, expect, it, vi, beforeEach } from "vitest";

const mockVerifyFinanceSyncRequest = vi.fn();
const mockGetFinanceTournamentExport = vi.fn();

vi.mock("@/lib/finance-sync-auth", () => ({
  verifyFinanceSyncRequest: mockVerifyFinanceSyncRequest,
}));

vi.mock("@/features/finance-export", () => ({
  getFinanceTournamentExport: mockGetFinanceTournamentExport,
}));

const { GET, dynamic } = await import("@/app/api/internal/finance/tournaments/route");

beforeEach(() => {
  mockVerifyFinanceSyncRequest.mockReset();
  mockGetFinanceTournamentExport.mockReset();
});

function request(authorization?: string, search = ""): Request {
  const headers = new Headers();
  if (authorization !== undefined) {
    headers.set("authorization", authorization);
  }
  return new Request(`http://localhost/api/internal/finance/tournaments${search}`, { headers });
}

describe("GET /api/internal/finance/tournaments", () => {
  it("is force-dynamic, never statically generated at build time", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns 401 without ever calling the feature layer when there is no Bearer token (auth missing)", async () => {
    mockVerifyFinanceSyncRequest.mockReturnValue(false);

    const response = await GET(request());
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ error: "Unauthorized" });
    expect(mockGetFinanceTournamentExport).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid Bearer token (auth wrong)", async () => {
    mockVerifyFinanceSyncRequest.mockReturnValue(false);

    const response = await GET(request("Bearer wrong-token"));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ error: "Unauthorized" });
    expect(mockGetFinanceTournamentExport).not.toHaveBeenCalled();
  });

  it("calls the feature layer and returns 200 for a valid Bearer token (auth correct)", async () => {
    mockVerifyFinanceSyncRequest.mockReturnValue(true);
    mockGetFinanceTournamentExport.mockResolvedValue([]);

    const response = await GET(request("Bearer real-token"));

    expect(response.status).toBe(200);
    expect(mockGetFinanceTournamentExport).toHaveBeenCalledTimes(1);
  });

  it("passes from/to query params through to the feature layer", async () => {
    mockVerifyFinanceSyncRequest.mockReturnValue(true);
    mockGetFinanceTournamentExport.mockResolvedValue([]);

    await GET(request("Bearer real-token", "?from=2026-01-01&to=2026-01-31"));

    expect(mockGetFinanceTournamentExport).toHaveBeenCalledWith({
      from: "2026-01-01",
      to: "2026-01-31",
    });
  });

  it("returns the feature layer's rows verbatim, including the missing-pricing-equivalent reliability flag", async () => {
    mockVerifyFinanceSyncRequest.mockReturnValue(true);
    mockGetFinanceTournamentExport.mockResolvedValue([
      {
        sourceTournamentId: "t1",
        title: "CLASSIC",
        tournamentType: "classic",
        startAt: "2026-01-15T20:00:00.000Z",
        playersCount: 20,
        entryCount: 20,
        reentryCount: 5,
        addonCount: 3,
        dealerPayrollRub: 6500,
        attendanceUnknownCount: 0,
        financiallyReliable: true,
        sourceUpdatedAt: null,
      },
    ]);

    const response = await GET(request("Bearer real-token"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      tournaments: [
        {
          sourceTournamentId: "t1",
          title: "CLASSIC",
          tournamentType: "classic",
          startAt: "2026-01-15T20:00:00.000Z",
          playersCount: 20,
          entryCount: 20,
          reentryCount: 5,
          addonCount: 3,
          dealerPayrollRub: 6500,
          attendanceUnknownCount: 0,
          financiallyReliable: true,
          sourceUpdatedAt: null,
        },
      ],
    });
  });

  // I) authenticated export contains freeReentryCount.
  it("I: an authenticated export row includes freeReentryCount, passed through verbatim", async () => {
    mockVerifyFinanceSyncRequest.mockReturnValue(true);
    mockGetFinanceTournamentExport.mockResolvedValue([
      {
        sourceTournamentId: "t1",
        title: "CLASSIC",
        tournamentType: "classic",
        startAt: "2026-01-15T20:00:00.000Z",
        playersCount: 20,
        entryCount: 20,
        reentryCount: 5,
        addonCount: 3,
        freeReentryCount: 4,
        dealerPayrollRub: 6500,
        attendanceUnknownCount: 0,
        financiallyReliable: true,
        sourceUpdatedAt: null,
      },
    ]);

    const response = await GET(request("Bearer real-token"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.tournaments[0].freeReentryCount).toBe(4);
  });

  // M) authenticated export returns adminPayrollRub.
  it("M: an authenticated export row includes adminPayrollRub, passed through verbatim", async () => {
    mockVerifyFinanceSyncRequest.mockReturnValue(true);
    mockGetFinanceTournamentExport.mockResolvedValue([
      {
        sourceTournamentId: "t1",
        title: "CLASSIC",
        tournamentType: "classic",
        startAt: "2026-01-15T20:00:00.000Z",
        playersCount: 20,
        entryCount: 20,
        reentryCount: 5,
        addonCount: 3,
        freeReentryCount: 0,
        dealerPayrollRub: 6500,
        adminPayrollRub: 4000,
        attendanceUnknownCount: 0,
        financiallyReliable: true,
        sourceUpdatedAt: null,
      },
    ]);

    const response = await GET(request("Bearer real-token"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.tournaments[0].adminPayrollRub).toBe(4000);
  });

  // S) authenticated export contains freeReentryBreakdown (automatic
  // owner/operator/dealer/promo classification).
  it("S: an authenticated export row includes freeReentryBreakdown, passed through verbatim", async () => {
    mockVerifyFinanceSyncRequest.mockReturnValue(true);
    mockGetFinanceTournamentExport.mockResolvedValue([
      {
        sourceTournamentId: "t1",
        title: "CLASSIC",
        tournamentType: "classic",
        startAt: "2026-01-15T20:00:00.000Z",
        playersCount: 20,
        entryCount: 20,
        reentryCount: 5,
        addonCount: 3,
        freeReentryCount: 4,
        freeReentryBreakdown: { ownerFreeCount: 1, operatorFreeCount: 1, dealerFreeCount: 0, promoFreeCount: 2 },
        dealerPayrollRub: 6500,
        adminPayrollRub: 4000,
        attendanceUnknownCount: 0,
        financiallyReliable: true,
        sourceUpdatedAt: null,
      },
    ]);

    const response = await GET(request("Bearer real-token"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.tournaments[0].freeReentryBreakdown).toEqual({
      ownerFreeCount: 1,
      operatorFreeCount: 1,
      dealerFreeCount: 0,
      promoFreeCount: 2,
    });
  });
});
