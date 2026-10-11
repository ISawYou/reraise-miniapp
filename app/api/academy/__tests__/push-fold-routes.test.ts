import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const SECRET = "push-fold-route-secret-never-in-output";
const mockGetPlayerFromSessionServer = vi.fn();

vi.mock("@/features/auth-server", () => ({
  getPlayerFromSessionServer: mockGetPlayerFromSessionServer,
}));

// These tests exercise the SCORED Push/Fold engine (sessions, reveal, verifier)
// as it will run once a dataset is independently validated for scored
// training. Production keeps ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS EMPTY (see
// docs/ACADEMY_PUSH_FOLD_AUDIT.md); that real, unmocked fail-closed policy is
// pinned in features/__tests__/academy-push-fold-policy.test.ts.
vi.mock("@/config/academy/push-fold-trainer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/academy/push-fold-trainer")>();
  return { ...actual, ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS: actual.ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS };
});

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

const { POST: sessionPost } = await import("@/app/api/academy/solver/push-fold/session/route");
const { POST: revealPost } = await import("@/app/api/academy/solver/push-fold/reveal/route");
const { POST: mixSessionPost } = await import("@/app/api/academy/solver/push-fold/mix/session/route");
const { POST: mixRevealPost } = await import("@/app/api/academy/solver/push-fold/mix/reveal/route");
const { POST: attemptsPost } = await import("@/app/api/academy/attempts/route");
const { POST: preflopSessionPost } = await import("@/app/api/academy/solver/preflop/session/route");
const { buildAcademyPushFoldMixSession } = await import("@/lib/academy/push-fold-mix");
const { buildAcademyPushFoldSession } = await import("@/lib/academy/push-fold-trainer");

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const ATTACKER_ID = "99999999-9999-4999-8999-999999999999";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const DATASET_10 = "holdemmath_pushfold_9max_10bb_ante10_v1";
const NODE = "FIRST_IN_SHOVE_BTN";

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

const LEAKS = ["resolvedAction", "correctAction", "frequenc", "category", "EDGE_", "CORE_IN", "DEEP_OUT", "PURE:", "MIXED", "sourceCoverage", "evBb", "weight", SECRET];

describe("Push/Fold session routes", () => {
  it("require an authenticated player", async () => {
    mockGetPlayerFromSessionServer.mockResolvedValue(null);
    for (const [route, path] of [[sessionPost, "session"], [revealPost, "reveal"], [mixSessionPost, "mix/session"], [mixRevealPost, "mix/reveal"]] as const) {
      const response = await route(post(`/api/academy/solver/push-fold/${path}`, { attemptId: ATTEMPT_ID, questionIndex: 0 }));
      expect(response.status).toBe(401);
    }
  });

  it("(20) public questions (fixed + Quick) contain only hand/cards/actions/spot — no answer leakage", async () => {
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      for (const response of [
        await sessionPost(post("/api/academy/solver/push-fold/session", { datasetId: DATASET_10, nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex })),
        await mixSessionPost(post("/api/academy/solver/push-fold/mix/session", { attemptId: ATTEMPT_ID, questionIndex })),
      ]) {
        expect(response.status).toBe(200);
        const body = await response.json() as Record<string, unknown>;
        expect(Object.keys(body).sort()).toEqual(["actions", "hand", "renderedCards", "spot"]);
        const raw = JSON.stringify(body);
        for (const leak of LEAKS) expect(raw).not.toContain(leak);
      }
    }
  });

  it("player id comes from the cookie only; a body playerId / datasetId / nodeKey cannot steer the Quick session", async () => {
    const expected = buildAcademyPushFoldMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID })[3];
    const response = await mixSessionPost(post("/api/academy/solver/push-fold/mix/session", {
      attemptId: ATTEMPT_ID, questionIndex: 3, playerId: ATTACKER_ID, datasetId: DATASET_10, nodeKey: "CALL_VS_SHOVE_BB_VS_SB",
    }));
    const body = await response.json() as { hand: string; spot: { nodeKey: string; datasetId: string } };
    expect(body.hand).toBe(expected.hand);
    expect(body.spot).toMatchObject({ nodeKey: expected.spot.nodeKey, datasetId: expected.spot.datasetId });
  });

  it("(21) reveal independently re-derives the question from (player, attempt, index)", async () => {
    const session = buildAcademyPushFoldMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      const response = await mixRevealPost(post("/api/academy/solver/push-fold/mix/reveal", {
        attemptId: ATTEMPT_ID, questionIndex, selectedAction: "FOLD", nodeKey: "FIRST_IN_SHOVE_UTG", resolvedAction: "FOLD",
      }));
      expect(response.status).toBe(200);
      const body = await response.json() as { hand: string; resolvedAction: string; matchesResolvedAction: boolean; spot: { nodeKey: string } };
      expect(body.hand).toBe(session[questionIndex].hand);
      expect(body.spot.nodeKey).toBe(session[questionIndex].spot.nodeKey);
      expect(body.resolvedAction).toBe(session[questionIndex].resolvedAction);
      expect(body.matchesResolvedAction).toBe(session[questionIndex].resolvedAction === "FOLD");
    }
    const fixed = buildAcademyPushFoldSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId: DATASET_10, nodeKey: NODE });
    const response = await revealPost(post("/api/academy/solver/push-fold/reveal", {
      datasetId: DATASET_10, nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex: 4, selectedAction: "ALL_IN",
    }));
    const body = await response.json() as { resolvedAction: string; hand: string };
    expect(body).toMatchObject({ hand: fixed[4].hand, resolvedAction: fixed[4].resolvedAction });
  });

  it("(22) forged / foreign / prototype-shaped dataset and node ids fail closed with 400 (never 500, never a default)", async () => {
    for (const [datasetId, nodeKey] of [
      ["__proto__", NODE], ["constructor", NODE], ["toString", NODE], [DATASET_10, "__proto__"], [DATASET_10, "constructor"],
      [DATASET_10, "hasOwnProperty"], ["external_mtt_preflop_9max_10bb_v1", "RFI_BTN"], ["hrc_scenario_b_rfi_9max_100bb_v1", "UTG"],
      ["holdemmath_pushfold_9max_20bb_ante10_v1", NODE], ["holdemmath_pushfold_9max_10bb_noante_v1", NODE], [DATASET_10, "FIRST_IN_SHOVE_BB"],
      [{ toString: "x" }, NODE], [DATASET_10, ["FIRST_IN_SHOVE_BTN"]],
    ] as const) {
      for (const [route, path] of [[sessionPost, "session"], [revealPost, "reveal"]] as const) {
        const response = await route(post(`/api/academy/solver/push-fold/${path}`, {
          datasetId, nodeKey, attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "FOLD",
        }));
        expect(response.status).toBe(400);
      }
    }
    // The MTT preflop route rejects Push/Fold datasets too.
    const crossed = await preflopSessionPost(post("/api/academy/solver/preflop/session", { datasetId: DATASET_10, nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex: 0 }));
    expect(crossed.status).toBe(400);
    // Unknown action / bad index / bad JSON.
    expect((await revealPost(post("/api/academy/solver/push-fold/reveal", { datasetId: DATASET_10, nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "CALL" }))).status).toBe(400);
    expect((await mixRevealPost(post("/api/academy/solver/push-fold/mix/reveal", { attemptId: ATTEMPT_ID, questionIndex: 10, selectedAction: "FOLD" }))).status).toBe(400);
    expect((await mixSessionPost(post("/api/academy/solver/push-fold/mix/session", "{not json"))).status).toBe(400);
  });

  it("attempts record under solver_push_fold_trainer; forged Quick nodes are rejected", async () => {
    const session = buildAcademyPushFoldMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
    const questions = session.map((q, questionIndex) => ({
      questionIndex, selectedAction: q.resolvedAction, datasetId: q.spot.datasetId, nodeKey: q.spot.nodeKey, mode: "PUSH_FOLD_QUICK",
    }));
    const ok = await attemptsPost(post("/api/academy/attempts", { attemptId: ATTEMPT_ID, lessonCode: "solver_push_fold_trainer", questions, playerId: ATTACKER_ID }));
    expect(ok.status).toBe(200);
    expect(memory.recorded).toHaveLength(1);
    expect(memory.recorded[0]).toMatchObject({ lessonCode: "solver_push_fold_trainer", playerId: PLAYER_ID, scorePercent: 100 });

    const forged = questions.map((answer, index) => (index === 0 ? { ...answer, nodeKey: "__proto__" } : answer));
    const rejected = await attemptsPost(post("/api/academy/attempts", { attemptId: ATTEMPT_ID, lessonCode: "solver_push_fold_trainer", questions: forged }));
    expect(rejected.status).toBe(400);
    expect(memory.recorded).toHaveLength(1);
  });
});
