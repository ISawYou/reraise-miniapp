import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetTournamentEntryStats = vi.fn();
const mockGetTournamentDealerPayoutSummary = vi.fn();

vi.mock("@/features/tournaments", () => ({
  getTournamentEntryStats: mockGetTournamentEntryStats,
}));

vi.mock("@/features/dealers", () => ({
  getTournamentDealerPayoutSummary: mockGetTournamentDealerPayoutSummary,
}));

const { GET } = await import("@/app/api/admin/tournaments/[id]/completion-summary/route");

function context(id = "t1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockGetTournamentEntryStats.mockReset();
  mockGetTournamentDealerPayoutSummary.mockReset();
});

describe("GET /api/admin/tournaments/[id]/completion-summary", () => {
  it("bundles entry stats and dealer payout into one flat response", async () => {
    mockGetTournamentEntryStats.mockResolvedValue({
      playersCount: 9,
      totalEntries: 10,
      rebuysCount: 1,
      addonsCount: 3,
      freeEntriesCount: 2,
    });
    mockGetTournamentDealerPayoutSummary.mockResolvedValue({ dealersCount: 2, payoutRub: 3500 });

    const response = await GET(new Request("http://localhost"), context("t1"));
    const json = await response.json();

    expect(mockGetTournamentEntryStats).toHaveBeenCalledWith("t1");
    expect(mockGetTournamentDealerPayoutSummary).toHaveBeenCalledWith("t1");
    expect(response.status).toBe(200);
    expect(json).toEqual({
      playersCount: 9,
      totalEntries: 10,
      rebuysCount: 1,
      addonsCount: 3,
      freeEntriesCount: 2,
      dealersCount: 2,
      dealerPayoutRub: 3500,
    });
  });

  it("returns 500 with the underlying error message when either aggregate fails", async () => {
    mockGetTournamentEntryStats.mockRejectedValue(new Error("db unreachable"));
    mockGetTournamentDealerPayoutSummary.mockResolvedValue({ dealersCount: 0, payoutRub: 0 });

    const response = await GET(new Request("http://localhost"), context("t1"));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe("db unreachable");
  });
});
