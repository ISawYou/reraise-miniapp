import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const SECRET = "route-test-secret-Q7-never-in-output";
const mockGetPlayerFromSessionServer = vi.fn();
const memory = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock("@/features/auth-server", () => ({
  getPlayerFromSessionServer: mockGetPlayerFromSessionServer,
}));

vi.mock("@/lib/repositories/academy-progress", () => ({
  academyProgressRepository: {
    listCourseProgress: async (_playerId: string, lessonCodes: readonly string[]) =>
      memory.rows.filter((row) => lessonCodes.includes(row.lesson_code as string)),
  },
}));

const { POST: sessionPost } = await import("@/app/api/academy/solver/session/route");
const { POST: revealPost } = await import("@/app/api/academy/solver/reveal/route");
const { GET: progressGet } = await import("@/app/api/academy/progress/route");
const { getAcademyCourseProgress } = await import("@/features/academy");
const { buildAcademySolverSessionForLesson } = await import("@/lib/academy/solver-training");

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const LESSON = "solver_rfi_9max_100bb_co";

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie: "reraise_session=signed" },
  });
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  mockGetPlayerFromSessionServer.mockReset().mockResolvedValue({ id: PLAYER_ID });
  memory.rows = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/academy/solver/session", () => {
  it("requires an authenticated player", async () => {
    mockGetPlayerFromSessionServer.mockResolvedValue(null);
    const response = await sessionPost(post("/api/academy/solver/session", {
      lessonCode: LESSON, attemptId: ATTEMPT_ID, questionIndex: 0,
    }));
    expect(response.status).toBe(401);
  });

  it("(23) returns ONLY hand, renderedCards, randomizerPercent and safe action display metadata", async () => {
    const response = await sessionPost(post("/api/academy/solver/session", {
      lessonCode: LESSON, attemptId: ATTEMPT_ID, questionIndex: 3,
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["actions", "hand", "randomizerPercent", "renderedCards"]);
    const raw = JSON.stringify(body);
    for (const leak of ["correctAction", "resolvedAction", "frequencies", "frequency", "bucket", "evBb", SECRET]) {
      expect(raw).not.toContain(leak);
    }
    // Action codes may appear ONLY inside the (answer-independent) action
    // display metadata — never anywhere else in the payload.
    const { actions, ...rest } = body;
    for (const leak of ["RAISE_2_25BB", "FOLD"]) expect(JSON.stringify(rest)).not.toContain(leak);
    expect(actions).toEqual([
      {
        code: "RAISE_2_25BB", kind: "RAISE", label: "Raise 2.25 BB", amountBb: 2.25,
        ru: { button: "Рейз 2.25 BB", inline: "рейз 2.25 BB", short: "рейз", always: "всегда открываем рейзом" },
      },
      {
        code: "FOLD", kind: "FOLD", label: "Fold",
        ru: { button: "Фолд", inline: "фолд", short: "фолд", always: "всегда сбрасываем" },
      },
    ]);

    const expected = buildAcademySolverSessionForLesson({
      playerId: PLAYER_ID, lessonCode: LESSON, attemptId: ATTEMPT_ID,
    })[3];
    expect(body).toEqual({
      hand: expected.hand,
      renderedCards: expected.renderedCards,
      randomizerPercent: expected.randomizerPercent,
      actions: expected.actions,
    });
  });

  it("(24) is idempotent for the same question", async () => {
    const body = { lessonCode: LESSON, attemptId: ATTEMPT_ID, questionIndex: 5 };
    const first = await (await sessionPost(post("/api/academy/solver/session", body))).json();
    const second = await (await sessionPost(post("/api/academy/solver/session", body))).json();
    expect(second).toEqual(first);
  });

  it("derives the session from the authenticated player, not from the body", async () => {
    async function fullSession(body: Record<string, unknown>) {
      return Promise.all(Array.from({ length: 10 }, async (_, questionIndex) =>
        (await sessionPost(post("/api/academy/solver/session", { ...body, questionIndex }))).json()));
    }
    const body = { lessonCode: LESSON, attemptId: ATTEMPT_ID };
    const mine = await fullSession(body);
    expect(await fullSession({ ...body, playerId: "attacker-chosen" })).toEqual(mine);

    mockGetPlayerFromSessionServer.mockResolvedValue({ id: "99999999-9999-4999-8999-999999999999" });
    expect(await fullSession(body)).not.toEqual(mine);
  });

  it.each([
    ["old База MTT lesson", { lessonCode: "preflop_rfi_9max_100bb_co", attemptId: ATTEMPT_ID, questionIndex: 0 }],
    ["unknown lesson", { lessonCode: "nope", attemptId: ATTEMPT_ID, questionIndex: 0 }],
    ["bad attempt id", { lessonCode: LESSON, attemptId: "x", questionIndex: 0 }],
    ["index too high", { lessonCode: LESSON, attemptId: ATTEMPT_ID, questionIndex: 10 }],
    ["fractional index", { lessonCode: LESSON, attemptId: ATTEMPT_ID, questionIndex: 1.5 }],
    ["string index", { lessonCode: LESSON, attemptId: ATTEMPT_ID, questionIndex: "1" }],
  ])("rejects %s with 400", async (_name, body) => {
    expect((await sessionPost(post("/api/academy/solver/session", body))).status).toBe(400);
  });

  it("returns a generic 500 (no secret details) when SESSION_SECRET is missing", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await sessionPost(post("/api/academy/solver/session", {
      lessonCode: LESSON, attemptId: ATTEMPT_ID, questionIndex: 0,
    }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/SESSION_SECRET/);
    errorSpy.mockRestore();
  });
});

describe("POST /api/academy/solver/reveal", () => {
  it("reveals frequencies and the resolved action only for an answered question", async () => {
    const response = await revealPost(post("/api/academy/solver/reveal", {
      lessonCode: LESSON, attemptId: ATTEMPT_ID, questionIndex: 2, selectedAction: "FOLD",
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    const expected = buildAcademySolverSessionForLesson({
      playerId: PLAYER_ID, lessonCode: LESSON, attemptId: ATTEMPT_ID,
    })[2];
    expect(body).toMatchObject({
      hand: expected.hand,
      resolvedAction: expected.resolvedAction,
      frequencies: expected.frequencies,
      selectedAction: "FOLD",
      matchesResolvedAction: expected.resolvedAction === "FOLD",
    });
  });

  it("requires a valid selected action", async () => {
    const response = await revealPost(post("/api/academy/solver/reveal", {
      lessonCode: LESSON, attemptId: ATTEMPT_ID, questionIndex: 2,
    }));
    expect(response.status).toBe(400);
  });
});

describe("GET /api/academy/progress (additive shape)", () => {
  it("(36) keeps the single-course База MTT shape at the top level and adds `courses`", async () => {
    memory.rows = [
      {
        lesson_code: "preflop_rfi_9max_100bb_utg", attempts_count: 1, last_score_percent: 90,
        best_score_percent: 90, passed: true, first_completed_at: "2026-01-01T00:00:00.000Z",
        last_attempt_at: "2026-01-01T00:00:00.000Z",
      },
      {
        lesson_code: "solver_rfi_9max_100bb_btn", attempts_count: 2, last_score_percent: 60,
        best_score_percent: 60, passed: false, first_completed_at: null,
        last_attempt_at: "2026-01-02T00:00:00.000Z",
      },
    ];
    const response = await progressGet(new NextRequest("http://localhost/api/academy/progress", {
      headers: { cookie: "reraise_session=signed" },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    const legacy = await getAcademyCourseProgress(PLAYER_ID);

    const { courses, ...topLevel } = body;
    expect(topLevel).toEqual(JSON.parse(JSON.stringify(legacy)));
    expect(topLevel.courseCode).toBe("base_mtt");
    expect(topLevel.lessons.map((l: { lessonCode: string }) => l.lessonCode)).toEqual(["preflop_rfi_9max_100bb_utg"]);
    expect(courses.map((c: { courseCode: string }) => c.courseCode)).toEqual(["base_mtt", "solver_lab"]);
    expect(courses[0]).toEqual(topLevel);
    expect(courses[1].course).toEqual({ passedLessons: 0, totalLessons: 7, progressPercent: 0 });
    expect(courses[1].lessons.map((l: { lessonCode: string }) => l.lessonCode)).toEqual(["solver_rfi_9max_100bb_btn"]);
  });
});
