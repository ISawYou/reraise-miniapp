import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const SECRET = "preflop-mix-route-secret-never-in-output";
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

const { POST: mixSessionPost } = await import("@/app/api/academy/solver/preflop/mix/session/route");
const { POST: mixRevealPost } = await import("@/app/api/academy/solver/preflop/mix/reveal/route");
const { POST: attemptsPost } = await import("@/app/api/academy/attempts/route");
const { buildAcademyPreflopMixSession } = await import("@/lib/academy/preflop-mix");
const { getAcademyStrategyDataset } = await import("@/config/academy/solver-datasets");

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const ATTACKER_ID = "99999999-9999-4999-8999-999999999999";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", cookie: "reraise_session=signed" },
  });
}

const mine = () => buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  mockGetPlayerFromSessionServer.mockReset().mockResolvedValue({ id: PLAYER_ID });
  memory.recorded = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/academy/solver/preflop/mix/session", () => {
  it("requires an authenticated player", async () => {
    mockGetPlayerFromSessionServer.mockResolvedValue(null);
    const response = await mixSessionPost(post("/api/academy/solver/preflop/mix/session", { attemptId: ATTEMPT_ID, questionIndex: 0 }));
    expect(response.status).toBe(401);
  });

  it("(2) starts with zero configuration: attemptId + questionIndex give a valid first question", async () => {
    const response = await mixSessionPost(post("/api/academy/solver/preflop/mix/session", { attemptId: ATTEMPT_ID, questionIndex: 0 }));
    expect(response.status).toBe(200);
    const body = await response.json() as { hand: string; actions: Array<{ code: string }>; spot: { nodeKey: string; datasetId: string } };
    const expected = mine()[0];
    expect(body.hand).toBe(expected.hand);
    expect(body.spot).toMatchObject({ datasetId: expected.spot.datasetId, nodeKey: expected.spot.nodeKey });
    expect(body.actions.map((action) => action.code)).toEqual(expected.actions.map((action) => action.code));
  });

  it("(9) the public question never leaks frequencies, the resolved action or derivation inputs", async () => {
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      const response = await mixSessionPost(post("/api/academy/solver/preflop/mix/session", { attemptId: ATTEMPT_ID, questionIndex }));
      const body = await response.json() as Record<string, unknown>;
      // (Part 2A) No randomizer before answering — it is secondary, post-answer information.
      expect(Object.keys(body).sort()).toEqual(["actions", "hand", "renderedCards", "spot"]);
      const raw = JSON.stringify(body);
      for (const leak of ["correctAction", "resolvedAction", "frequencies", "frequency", "bucket", "evBb", "MIXED", "PURE:", "weight", "randomizer", SECRET]) {
        expect(raw).not.toContain(leak);
      }
      const { actions, ...rest } = body;
      for (const code of (actions as Array<{ code: string }>).map((action) => action.code)) {
        expect(JSON.stringify(rest)).not.toContain(`"${code}"`);
      }
      expect(raw).not.toMatch(/github|jensbaagaard|HRC|GTO|CHIP_EV|ICM|EXTERNAL_REFERENCE_UNVERIFIED|SOURCE_UNSTATED|ReRaise/i);
    }
  });

  it("(8) the server derives every node: body node / dataset / playerId overrides are ignored", async () => {
    const session = mine();
    const theirs = buildAcademyPreflopMixSession({ playerId: ATTACKER_ID, attemptId: ATTEMPT_ID });
    expect(theirs.map((q) => q.spot.nodeKey)).not.toEqual(session.map((q) => q.spot.nodeKey));
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      const forgedNode = session[(questionIndex + 1) % 10].spot;
      const response = await mixSessionPost(post("/api/academy/solver/preflop/mix/session", {
        attemptId: ATTEMPT_ID, questionIndex, playerId: ATTACKER_ID,
        datasetId: "hrc_scenario_b_rfi_9max_100bb_v1", nodeKey: forgedNode.nodeKey, stackBb: forgedNode.stackBb,
      }));
      const body = await response.json() as { hand: string; spot: { nodeKey: string; datasetId: string } };
      expect(body.spot.nodeKey).toBe(session[questionIndex].spot.nodeKey);
      expect(body.spot.datasetId).toBe(session[questionIndex].spot.datasetId);
      expect(body.hand).toBe(session[questionIndex].hand);
      expect(body).not.toHaveProperty("randomizerPercent");
    }
    expect(mockGetPlayerFromSessionServer).toHaveBeenCalledWith("signed");
  });

  it("rejects malformed attempt ids / indices and bad JSON with 400", async () => {
    for (const body of [{ attemptId: "nope", questionIndex: 0 }, { attemptId: ATTEMPT_ID, questionIndex: 10 }, { attemptId: ATTEMPT_ID }, { questionIndex: 0 }]) {
      expect((await mixSessionPost(post("/api/academy/solver/preflop/mix/session", body))).status).toBe(400);
    }
    expect((await mixSessionPost(post("/api/academy/solver/preflop/mix/session", "{nope"))).status).toBe(400);
  });
});

describe("POST /api/academy/solver/preflop/mix/reveal", () => {
  it("(10) re-derives node + hand + randomizer and returns the dataset's exact stored frequencies", async () => {
    const session = mine();
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      const expected = session[questionIndex];
      const selectedAction = expected.actions[expected.actions.length - 1].code;
      const response = await mixRevealPost(post("/api/academy/solver/preflop/mix/reveal", {
        attemptId: ATTEMPT_ID, questionIndex, selectedAction,
        // Forged selection: must be ignored.
        datasetId: "external_mtt_preflop_9max_5bb_v1", nodeKey: "RFI_UTG",
      }));
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown> & { spot: { nodeKey: string } };
      const stored = getAcademyStrategyDataset(expected.spot.datasetId).nodes[expected.spot.nodeKey].hands[expected.hand];
      expect(body.spot.nodeKey).toBe(expected.spot.nodeKey);
      expect(body.hand).toBe(expected.hand);
      expect(body.frequencies).toEqual(stored);
      expect(body.randomizerPercent).toBe(expected.randomizerPercent);
      expect(body.resolvedAction).toBe(expected.resolvedAction);
      expect(body.selectedAction).toBe(selectedAction);
      expect(body.matchesResolvedAction).toBe(selectedAction === expected.resolvedAction);
      // Server-computed three-state outcome (normal practice scoring).
      const played = (expected.frequencies[selectedAction] ?? 0) > 0;
      expect(body.outcome).toBe(selectedAction === expected.resolvedAction ? "RESOLVED_MATCH" : played ? "VALID_MIXED" : "NOT_IN_STRATEGY");
      expect(body.countsAsCorrect).toBe(selectedAction === expected.resolvedAction || played);
    }
  });

  it("rejects an action that question's node does not offer", async () => {
    const response = await mixRevealPost(post("/api/academy/solver/preflop/mix/reveal", {
      attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "SHOVE_EVERYTHING",
    }));
    expect(response.status).toBe(400);
  });
});

describe("POST /api/academy/attempts for Quick Mix", () => {
  const answersFor = (session: ReturnType<typeof mine>, pick: (q: ReturnType<typeof mine>[number]) => string) =>
    session.map((question, questionIndex) => ({
      questionIndex, selectedAction: pick(question), datasetId: question.spot.datasetId, nodeKey: question.spot.nodeKey, mode: "QUICK_MIX",
    }));

  it("scores the cookie player's server-derived mix and records under the ONE existing lesson code", async () => {
    const response = await attemptsPost(post("/api/academy/attempts", {
      playerId: ATTACKER_ID, percentage: 0, attemptId: ATTEMPT_ID, lessonCode: "solver_preflop_trainer",
      questions: answersFor(mine(), (question) => question.resolvedAction),
    }));
    expect(response.status).toBe(200);
    expect((await response.json() as { result: { correctAnswers: number } }).result.correctAnswers).toBe(10);
    expect(memory.recorded).toEqual([{
      attemptId: ATTEMPT_ID, playerId: PLAYER_ID, lessonCode: "solver_preflop_trainer", scorePercent: 100, passed: true,
    }]);
  });

  it("rejects answers whose node is not the server-derived node of that question (400, nothing recorded)", async () => {
    const session = mine();
    const answers = answersFor(session, (question) => question.resolvedAction);
    answers[3] = { ...answers[3], nodeKey: session[4].spot.nodeKey, datasetId: session[4].spot.datasetId };
    const response = await attemptsPost(post("/api/academy/attempts", {
      attemptId: ATTEMPT_ID, lessonCode: "solver_preflop_trainer", questions: answers,
    }));
    expect(response.status).toBe(400);
    expect(memory.recorded).toEqual([]);
  });
});
