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

function request(path: string, body?: unknown, sessionCookie?: string) {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  if (sessionCookie) headers.set("cookie", `reraise_session=${sessionCookie}`);

  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
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
  it("resolves an authenticated web cookie through the canonical session helper", async () => {
    const response = await GET(
      request("/api/academy/progress", undefined, "signed-web-session"),
    );

    expect(response.status).toBe(200);
    expect(mockGetPlayerFromSessionServer).toHaveBeenCalledWith(
      "signed-web-session",
    );
    expect(mockGetAcademyCourseProgress).toHaveBeenCalledWith("player-1");
  });

  it("uses the same canonical player after a progress reload", async () => {
    await GET(
      request("/api/academy/progress", undefined, "signed-web-session"),
    );
    await GET(
      request("/api/academy/progress", undefined, "signed-web-session"),
    );

    expect(mockGetAcademyCourseProgress).toHaveBeenNthCalledWith(1, "player-1");
    expect(mockGetAcademyCourseProgress).toHaveBeenNthCalledWith(2, "player-1");
  });

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
