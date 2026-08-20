import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockGetPlayerFromSessionServer = vi.fn();
const mockGetAcademyCourseProgress = vi.fn();
const mockSubmitAcademyTrainingAttempt = vi.fn();

vi.mock("@/features/auth-server", () => ({
  getPlayerFromSessionServer: mockGetPlayerFromSessionServer,
}));

vi.mock("@/features/academy", () => ({
  AcademyValidationError: class AcademyValidationError extends Error {},
  getAcademyCourseProgress: mockGetAcademyCourseProgress,
  submitAcademyTrainingAttempt: mockSubmitAcademyTrainingAttempt,
}));

const { GET } = await import("@/app/api/academy/progress/route");
const { POST } = await import("@/app/api/academy/attempts/route");

function request(path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  });
}

beforeEach(() => {
  mockGetPlayerFromSessionServer.mockReset().mockResolvedValue({ id: "player-1" });
  mockGetAcademyCourseProgress.mockReset().mockResolvedValue({
    lessons: [],
    course: { passedLessons: 0, totalLessons: 7, progressPercent: 0 },
  });
  mockSubmitAcademyTrainingAttempt.mockReset().mockResolvedValue({ ok: true });
});

describe("Academy API authentication", () => {
  it("rejects progress reads without a canonical player session", async () => {
    mockGetPlayerFromSessionServer.mockResolvedValue(null);
    expect((await GET(request("/api/academy/progress"))).status).toBe(401);
  });

  it("rejects attempt submission without a canonical player session", async () => {
    mockGetPlayerFromSessionServer.mockResolvedValue(null);
    expect((await POST(request("/api/academy/attempts", {}))).status).toBe(401);
  });
});

describe("Academy API transport", () => {
  it("loads progress for the authenticated player", async () => {
    const response = await GET(request("/api/academy/progress"));
    expect(response.status).toBe(200);
    expect(mockGetAcademyCourseProgress).toHaveBeenCalledWith("player-1");
  });

  it("submits answers without accepting client score or player id", async () => {
    const body = {
      playerId: "attacker-selected-player",
      percentage: 100,
      passed: true,
      attemptId: "22222222-2222-4222-8222-222222222222",
      lessonCode: "preflop_rfi_9max_100bb_utg",
      questions: [{ hand: "AA", selectedAction: "OPEN" }],
    };
    const response = await POST(request("/api/academy/attempts", body));

    expect(response.status).toBe(200);
    expect(mockSubmitAcademyTrainingAttempt).toHaveBeenCalledWith("player-1", {
      attemptId: body.attemptId,
      lessonCode: body.lessonCode,
      questions: body.questions,
    });
  });
});
