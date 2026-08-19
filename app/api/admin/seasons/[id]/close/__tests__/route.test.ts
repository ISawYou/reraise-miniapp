import { describe, expect, it, vi, beforeEach } from "vitest";

const mockCloseSeason = vi.fn();

vi.mock("@/features/seasons", () => ({
  closeSeason: mockCloseSeason,
}));

const { POST } = await import("@/app/api/admin/seasons/[id]/close/route");

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockCloseSeason.mockReset();
});

describe("POST /api/admin/seasons/[id]/close", () => {
  it("returns 200 with the winner on a successful close", async () => {
    mockCloseSeason.mockResolvedValue({
      status: "closed",
      seasonId: "s1",
      winnerPlayerId: "p1",
      winnerRating: 100,
    });

    const response = await POST(new Request("http://localhost"), context("s1"));
    const json = await response.json();

    expect(mockCloseSeason).toHaveBeenCalledWith("s1");
    expect(response.status).toBe(200);
    expect(json).toMatchObject({ ok: true, status: "closed", winnerPlayerId: "p1" });
  });

  it("returns 409 (not 200) on a tie, and does not report ok: true", async () => {
    mockCloseSeason.mockResolvedValue({
      status: "tie",
      seasonId: "s1",
      tiedPlayerIds: ["p1", "p2"],
      rating: 100,
    });

    const response = await POST(new Request("http://localhost"), context("s1"));
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.ok).not.toBe(true);
    expect(json.tiedPlayerIds).toEqual(["p1", "p2"]);
  });

  it("returns 400 with the feature-layer error message when closeSeason throws", async () => {
    mockCloseSeason.mockRejectedValue(new Error('Сезон "s1" уже закрыт (is_active = false) — повторное закрытие запрещено'));

    const response = await POST(new Request("http://localhost"), context("s1"));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toMatch(/уже закрыт/);
  });

  it("passes through no_results as a 200 (a legitimate, non-error outcome)", async () => {
    mockCloseSeason.mockResolvedValue({ status: "no_results", seasonId: "s1" });

    const response = await POST(new Request("http://localhost"), context("s1"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ ok: true, status: "no_results" });
  });
});
