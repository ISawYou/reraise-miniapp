import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetManualAchievementsForPlayer = vi.fn();
const mockGrantManualAchievement = vi.fn();
const mockRevokeManualAchievement = vi.fn();

vi.mock("@/features/achievements", () => ({
  getManualAchievementsForPlayer: mockGetManualAchievementsForPlayer,
  grantManualAchievement: mockGrantManualAchievement,
  revokeManualAchievement: mockRevokeManualAchievement,
}));

const { GET, POST, DELETE } = await import("@/app/api/admin/achievements/manual/route");

beforeEach(() => {
  mockGetManualAchievementsForPlayer.mockReset();
  mockGrantManualAchievement.mockReset().mockResolvedValue(undefined);
  mockRevokeManualAchievement.mockReset().mockResolvedValue(undefined);
});

function jsonRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/admin/achievements/manual", {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("GET /api/admin/achievements/manual", () => {
  it("requires playerId", async () => {
    const response = await GET(new Request("http://localhost/api/admin/achievements/manual"));
    expect(response.status).toBe(400);
  });

  it("returns the manual achievement list for a player", async () => {
    mockGetManualAchievementsForPlayer.mockResolvedValue([
      { code: "royal_flush", name: "Royal Flush", description: "...", granted: false, completed_at: null },
    ]);

    const response = await GET(
      new Request("http://localhost/api/admin/achievements/manual?playerId=p1")
    );
    const json = await response.json();

    expect(mockGetManualAchievementsForPlayer).toHaveBeenCalledWith("p1");
    expect(json.achievements).toHaveLength(1);
  });
});

describe("POST /api/admin/achievements/manual (grant)", () => {
  it("requires playerId and code", async () => {
    const response = await POST(jsonRequest("POST", { playerId: "p1" }));
    expect(response.status).toBe(400);
  });

  it("grants a manual achievement", async () => {
    const response = await POST(jsonRequest("POST", { playerId: "p1", code: "royal_flush" }));
    const json = await response.json();

    expect(mockGrantManualAchievement).toHaveBeenCalledWith("p1", "royal_flush");
    expect(json.ok).toBe(true);
  });

  it("returns 400 with the feature-layer error when the code is not manual", async () => {
    mockGrantManualAchievement.mockRejectedValue(
      new Error('"first_tournament" — automatic-достижение, его нельзя выдать/снять вручную')
    );

    const response = await POST(jsonRequest("POST", { playerId: "p1", code: "first_tournament" }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toMatch(/automatic/);
  });
});

describe("DELETE /api/admin/achievements/manual (revoke)", () => {
  it("requires playerId and code", async () => {
    const response = await DELETE(jsonRequest("DELETE", { code: "royal_flush" }));
    expect(response.status).toBe(400);
  });

  it("revokes a manual achievement", async () => {
    const response = await DELETE(jsonRequest("DELETE", { playerId: "p1", code: "royal_flush" }));
    const json = await response.json();

    expect(mockRevokeManualAchievement).toHaveBeenCalledWith("p1", "royal_flush");
    expect(json.ok).toBe(true);
  });

  it("returns 400 when the feature layer rejects an automatic code", async () => {
    mockRevokeManualAchievement.mockRejectedValue(
      new Error('"ten_itm" — automatic-достижение, его нельзя выдать/снять вручную')
    );

    const response = await DELETE(jsonRequest("DELETE", { playerId: "p1", code: "ten_itm" }));
    expect(response.status).toBe(400);
  });
});
