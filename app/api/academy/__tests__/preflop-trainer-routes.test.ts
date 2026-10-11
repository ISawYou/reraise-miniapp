import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const SECRET = "preflop-route-secret-never-in-output";
const mockGetPlayerFromSessionServer = vi.fn();

vi.mock("@/features/auth-server", () => ({
  getPlayerFromSessionServer: mockGetPlayerFromSessionServer,
}));

const memory = vi.hoisted(() => ({ recorded: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/repositories/academy-progress", () => ({
  academyProgressRepository: {
    recordCompletedAttempt: async (input: Record<string, unknown>) => {
      memory.recorded.push(input);
      return {
        lesson_code: input.lessonCode, attempts_count: 1, last_score_percent: input.scorePercent,
        best_score_percent: input.scorePercent, passed: input.passed, first_completed_at: null,
        last_attempt_at: "2026-10-11T00:00:00.000Z", is_new_attempt: true, first_pass: false, new_best: false,
      };
    },
  },
}));

const { POST: sessionPost } = await import("@/app/api/academy/solver/preflop/session/route");
const { POST: revealPost } = await import("@/app/api/academy/solver/preflop/reveal/route");
const { POST: attemptsPost } = await import("@/app/api/academy/attempts/route");
const { buildAcademyPreflopTrainerSession } = await import("@/lib/academy/preflop-trainer");

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const ATTACKER_ID = "99999999-9999-4999-8999-999999999999";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const DATASET = "external_mtt_preflop_9max_20bb_v1";
const NODE = "FACING_OPEN_BB_VS_BTN";

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", cookie: "reraise_session=signed" },
  });
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  mockGetPlayerFromSessionServer.mockReset().mockResolvedValue({ id: PLAYER_ID });
  memory.recorded = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/academy/solver/preflop/session", () => {
  it("requires an authenticated player", async () => {
    mockGetPlayerFromSessionServer.mockResolvedValue(null);
    const response = await sessionPost(post("/api/academy/solver/preflop/session", {
      datasetId: DATASET, nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex: 0,
    }));
    expect(response.status).toBe(401);
  });

  it("(11) returns ONLY hand, cards, safe actions and the spot — no strategy leakage, no randomizer", async () => {
    const response = await sessionPost(post("/api/academy/solver/preflop/session", {
      datasetId: DATASET, nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex: 4,
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["actions", "hand", "renderedCards", "spot"]);
    const raw = JSON.stringify(body);
    for (const leak of ["correctAction", "resolvedAction", "frequencies", "frequency", "bucket", "evBb", "MIXED", "PURE:", "randomizer", SECRET]) {
      expect(raw).not.toContain(leak);
    }
    const { actions, ...rest } = body;
    for (const code of ["ALL_IN", "CALL", "FOLD"]) expect(JSON.stringify(rest)).not.toContain(`"${code}"`);
    expect((actions as Array<{ code: string }>).map((action) => action.code)).toEqual(["ALL_IN", "CALL", "FOLD"]);
    expect(body.spot).toMatchObject({ stackBb: 20, heroPosition: "BB", villainPosition: "BTN", situation: "FACING_OPEN" });
    // Player-facing copy carries no source / brand / model claims.
    expect(raw).not.toMatch(/github|jensbaagaard|HRC|GTO|CHIP_EV|ICM|EXTERNAL_REFERENCE_UNVERIFIED|SOURCE_UNSTATED|ReRaise/i);
  });

  it("(14) ignores a body-supplied playerId: the session belongs to the cookie player", async () => {
    const mine = buildAcademyPreflopTrainerSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId: DATASET, nodeKey: NODE });
    const theirs = buildAcademyPreflopTrainerSession({ playerId: ATTACKER_ID, attemptId: ATTEMPT_ID, datasetId: DATASET, nodeKey: NODE });
    expect(mine.map((q) => q.hand)).not.toEqual(theirs.map((q) => q.hand));
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      const response = await sessionPost(post("/api/academy/solver/preflop/session", {
        playerId: ATTACKER_ID, datasetId: DATASET, nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex,
      }));
      const body = await response.json() as { hand: string };
      expect(body.hand).toBe(mine[questionIndex].hand);
      expect(body).not.toHaveProperty("randomizerPercent");
    }
    const reveal = await revealPost(post("/api/academy/solver/preflop/reveal", {
      playerId: ATTACKER_ID, datasetId: DATASET, nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "FOLD",
    }));
    expect((await reveal.json() as { hand: string }).hand).toBe(mine[0].hand);
    expect(mockGetPlayerFromSessionServer).toHaveBeenCalledWith("signed");
  });

  it("(13) rejects forged dataset ids and node keys with 400 (fail closed)", async () => {
    for (const forged of [
      { datasetId: "external_mtt_preflop_9max_30bb_v1", nodeKey: NODE },
      { datasetId: "hrc_scenario_b_rfi_9max_100bb_v1", nodeKey: "UTG" },
      { datasetId: DATASET, nodeKey: "FACING_3BET_BTN_VS_CO" },
      { datasetId: DATASET, nodeKey: "__proto__" },
      { nodeKey: NODE },
      { datasetId: DATASET },
      { datasetId: 20, nodeKey: NODE },
    ]) {
      const response = await sessionPost(post("/api/academy/solver/preflop/session", { ...forged, attemptId: ATTEMPT_ID, questionIndex: 0 }));
      expect(response.status).toBe(400);
      const reveal = await revealPost(post("/api/academy/solver/preflop/reveal", {
        ...forged, attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "FOLD",
      }));
      expect(reveal.status).toBe(400);
    }
    const badJson = await sessionPost(post("/api/academy/solver/preflop/session", "{not json"));
    expect(badJson.status).toBe(400);
  });
});

describe("POST /api/academy/solver/preflop/reveal", () => {
  it("(12) reveals the exact node frequencies and the resolved action after answering", async () => {
    const expected = buildAcademyPreflopTrainerSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId: DATASET, nodeKey: NODE });
    const response = await revealPost(post("/api/academy/solver/preflop/reveal", {
      datasetId: DATASET, nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex: 2, selectedAction: "CALL",
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.frequencies).toEqual(expected[2].frequencies);
    expect(body.resolvedAction).toBe(expected[2].resolvedAction);
    expect(body.matchesResolvedAction).toBe(expected[2].resolvedAction === "CALL");
    // (Part 2A) The randomizer is revealed only now, as secondary information.
    expect(body.randomizerPercent).toBe(expected[2].randomizerPercent);
    const callPlayed = (expected[2].frequencies.CALL ?? 0) > 0;
    expect(body.countsAsCorrect).toBe(expected[2].resolvedAction === "CALL" || callPlayed);
  });

  it("(13) rejects an action the node does not offer", async () => {
    const response = await revealPost(post("/api/academy/solver/preflop/reveal", {
      datasetId: DATASET, nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "RAISE",
    }));
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toBe("Допустимые действия: ALL_IN, CALL или FOLD");
  });
});

describe("POST /api/academy/attempts for the configurable trainer", () => {
  it("(14) scores the cookie player's session and records ONE lesson code; body playerId / score are ignored", async () => {
    const mine = buildAcademyPreflopTrainerSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId: DATASET, nodeKey: NODE });
    const response = await attemptsPost(post("/api/academy/attempts", {
      playerId: ATTACKER_ID,
      percentage: 100,
      passed: true,
      attemptId: ATTEMPT_ID,
      lessonCode: "solver_preflop_trainer",
      questions: mine.map((question, questionIndex) => ({
        questionIndex, selectedAction: question.resolvedAction, datasetId: DATASET, nodeKey: NODE,
      })),
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { correctAnswers: number } };
    expect(body.result.correctAnswers).toBe(10);
    expect(memory.recorded).toEqual([{
      attemptId: ATTEMPT_ID, playerId: PLAYER_ID, lessonCode: "solver_preflop_trainer", scorePercent: 100, passed: true,
    }]);
  });

  it("(13) rejects a forged node in the submitted answers with 400 and records nothing", async () => {
    const response = await attemptsPost(post("/api/academy/attempts", {
      attemptId: ATTEMPT_ID,
      lessonCode: "solver_preflop_trainer",
      questions: Array.from({ length: 10 }, (_, questionIndex) => ({
        questionIndex, selectedAction: "FOLD", datasetId: DATASET, nodeKey: "FACING_4BET_BB_VS_BTN",
      })),
    }));
    expect(response.status).toBe(400);
    expect(memory.recorded).toEqual([]);
  });
});
