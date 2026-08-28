import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetTournamentVisualConfigs = vi.fn();

vi.mock("@/features/tournament-visuals", () => ({
  getTournamentVisualConfigs: mockGetTournamentVisualConfigs,
}));

const { GET, dynamic } = await import("@/app/api/tournament-visuals/route");

beforeEach(() => {
  mockGetTournamentVisualConfigs.mockReset();
});

describe("GET /api/tournament-visuals", () => {
  // Regression guard: without force-dynamic this route has no request-bound
  // API calls, so Next.js is free to statically render it once and keep
  // serving that build-time response to every client (including scale/
  // offset/opacity saved in admin afterwards) until the next deploy.
  it("is force-dynamic, never statically generated at build time", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns the current visual configs on success", async () => {
    mockGetTournamentVisualConfigs.mockResolvedValue([
      { tournamentType: "classic", assetUrl: "/x.png", scale: 100, offsetX: 0, offsetY: 0, opacity: 100 },
    ]);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.visuals).toHaveLength(1);
  });

  it("returns 500 with a message when the configs lookup throws", async () => {
    mockGetTournamentVisualConfigs.mockRejectedValue(new Error("boom"));

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("boom");
  });
});
