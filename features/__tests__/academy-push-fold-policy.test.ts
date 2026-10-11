/**
 * Part 1A — player-facing Push/Fold safety policy, against the REAL (unmocked)
 * configuration: no HoldemMath multiway dataset is validated for SCORED
 * training, so every scored path fails closed while the reference (study)
 * views stay intact. See docs/ACADEMY_PUSH_FOLD_AUDIT.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS,
  ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS,
  ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE,
} from "@/config/academy/push-fold-trainer";
import { ACADEMY_PUSH_FOLD_STRATEGY_DATASETS, getAcademyPushFoldDataset } from "@/config/academy/push-fold-datasets";
import { CANONICAL_STARTING_HANDS } from "@/lib/academy/preflop";
import { buildAcademyPushFoldMixSession, listAcademyPushFoldMixCandidates, selectPushFoldMixNodes } from "@/lib/academy/push-fold-mix";
import {
  AcademyPushFoldScoringUnavailableError,
  buildAcademyPushFoldSession,
  buildPushFoldQuestion,
  isAcademyPushFoldDatasetScored,
  isAcademyPushFoldScoredTrainingEnabled,
  listAcademyPushFoldSpots,
  requireAcademyPushFoldSpot,
  requireAcademyPushFoldSpotByStack,
} from "@/lib/academy/push-fold-trainer";

const mockGetPlayerFromSessionServer = vi.fn();
vi.mock("@/features/auth-server", () => ({ getPlayerFromSessionServer: mockGetPlayerFromSessionServer }));
const memory = vi.hoisted(() => ({ recorded: [] as unknown[] }));
vi.mock("@/lib/repositories", () => ({ academyProgressRepository: {} }));
vi.mock("@/lib/repositories/academy-progress", () => ({
  academyProgressRepository: {
    recordCompletedAttempt: async (input: unknown) => {
      memory.recorded.push(input);
      throw new Error("must never record a Push/Fold attempt while scoring is paused");
    },
  },
}));

const {
  AcademyTrainerUnavailableError,
  AcademyValidationError,
  getAcademyPushFoldMixQuestion,
  getAcademyPushFoldQuestion,
  revealAcademyPushFoldAnswer,
  revealAcademyPushFoldMixAnswer,
  verifyAcademyPushFoldAttempt,
} = await import("@/features/academy");
const { POST: sessionPost } = await import("@/app/api/academy/solver/push-fold/session/route");
const { POST: revealPost } = await import("@/app/api/academy/solver/push-fold/reveal/route");
const { POST: mixSessionPost } = await import("@/app/api/academy/solver/push-fold/mix/session/route");
const { POST: mixRevealPost } = await import("@/app/api/academy/solver/push-fold/mix/reveal/route");
const { POST: attemptsPost } = await import("@/app/api/academy/attempts/route");

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const DATASET_10 = "holdemmath_pushfold_9max_10bb_ante10_v1";

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie: "reraise_session=signed" },
  });
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "push-fold-policy-secret");
  mockGetPlayerFromSessionServer.mockReset().mockResolvedValue({ id: PLAYER_ID });
  memory.recorded = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("scored whitelist policy", () => {
  it("no dataset is validated for scored Push/Fold training; the reference whitelist is unchanged", () => {
    expect(ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS).toEqual([]);
    expect(isAcademyPushFoldScoredTrainingEnabled()).toBe(false);
    expect(ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS).toEqual([4, 6, 8, 10, 12, 15].map((bb) => `holdemmath_pushfold_9max_${bb}bb_ante10_v1`));
  });

  it("(4) structural: a dataset built on the single-caller multiway approximation can never be on the scored list", () => {
    for (const datasetId of Object.keys(ACADEMY_PUSH_FOLD_STRATEGY_DATASETS)) {
      const assumptions = getAcademyPushFoldDataset(datasetId).assumptions as Record<string, unknown>;
      expect(assumptions.multiwayModel, datasetId).toBe("SINGLE_CALLER_APPROXIMATION");
      expect(ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS, datasetId).not.toContain(datasetId);
      expect(isAcademyPushFoldDatasetScored(datasetId), datasetId).toBe(false);
    }
    for (const forged of ["__proto__", "constructor", "", null, undefined, 10, "external_mtt_preflop_9max_10bb_v1"]) {
      expect(isAcademyPushFoldDatasetScored(forged)).toBe(false);
    }
  });

  it("(4) no scored question can be built from ANY unverified HoldemMath node (all 264 reference nodes × the shared question builder)", () => {
    const spots = listAcademyPushFoldSpots();
    expect(spots).toHaveLength(264);
    const noRandom = () => 0.5;
    for (const spot of spots) {
      const resolved = requireAcademyPushFoldSpot(spot.datasetId, spot.nodeKey);
      expect(() => buildPushFoldQuestion(resolved, 0, CANONICAL_STARTING_HANDS[0], "EDGE_IN", noRandom), spot.nodeKey)
        .toThrow(AcademyPushFoldScoringUnavailableError);
      expect(() => buildAcademyPushFoldSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId: spot.datasetId, nodeKey: spot.nodeKey }), spot.nodeKey)
        .toThrow(AcademyPushFoldScoringUnavailableError);
    }
  });

  it("(3) Quick Push/Fold fails closed: no candidates, no session, no silent fallback to another dataset", () => {
    expect(listAcademyPushFoldMixCandidates()).toEqual([]);
    expect(() => selectPushFoldMixNodes(() => 0.5)).toThrow();
    for (let n = 0; n < 5; n += 1) {
      expect(() => buildAcademyPushFoldMixSession({ playerId: PLAYER_ID, attemptId: `22222222-2222-4222-8222-00000000000${n}` }))
        .toThrow(AcademyPushFoldScoringUnavailableError);
    }
  });

  it("(3) serve / reveal / verify (fixed + Quick) throw AcademyTrainerUnavailableError (a validation error, never a 500)", () => {
    const cases: Array<() => unknown> = [
      () => getAcademyPushFoldQuestion(PLAYER_ID, { datasetId: DATASET_10, nodeKey: "FIRST_IN_SHOVE_BTN", attemptId: ATTEMPT_ID, questionIndex: 0 }),
      () => revealAcademyPushFoldAnswer(PLAYER_ID, { datasetId: DATASET_10, nodeKey: "FIRST_IN_SHOVE_BTN", attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "FOLD" }),
      () => getAcademyPushFoldMixQuestion(PLAYER_ID, { attemptId: ATTEMPT_ID, questionIndex: 0 }),
      () => revealAcademyPushFoldMixAnswer(PLAYER_ID, { attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "FOLD" }),
      () => verifyAcademyPushFoldAttempt({
        attemptId: ATTEMPT_ID, lessonCode: ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE,
        questions: Array.from({ length: 10 }, (_, questionIndex) => ({ questionIndex, selectedAction: "FOLD", datasetId: DATASET_10, nodeKey: "FIRST_IN_SHOVE_BTN" })),
      }, { playerId: PLAYER_ID }),
      () => verifyAcademyPushFoldAttempt({
        attemptId: ATTEMPT_ID, lessonCode: ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE,
        questions: Array.from({ length: 10 }, (_, questionIndex) => ({ questionIndex, selectedAction: "FOLD", datasetId: DATASET_10, nodeKey: "FIRST_IN_SHOVE_BTN", mode: "PUSH_FOLD_QUICK" })),
      }, { playerId: PLAYER_ID }),
    ];
    for (const run of cases) {
      expect(run).toThrow(AcademyTrainerUnavailableError);
      expect(run).toThrow(AcademyValidationError);
    }
  });

  it("(3) the API routes answer 409 (serve / reveal, fixed + Quick); attempts are rejected and nothing is recorded", async () => {
    const responses = [
      await sessionPost(post("/api/academy/solver/push-fold/session", { datasetId: DATASET_10, nodeKey: "FIRST_IN_SHOVE_BTN", attemptId: ATTEMPT_ID, questionIndex: 0 })),
      await revealPost(post("/api/academy/solver/push-fold/reveal", { datasetId: DATASET_10, nodeKey: "FIRST_IN_SHOVE_BTN", attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "FOLD" })),
      await mixSessionPost(post("/api/academy/solver/push-fold/mix/session", { attemptId: ATTEMPT_ID, questionIndex: 0 })),
      await mixRevealPost(post("/api/academy/solver/push-fold/mix/reveal", { attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "FOLD" })),
    ];
    for (const response of responses) {
      expect(response.status).toBe(409);
      const body = await response.json() as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(["error"]);
      expect(String(body.error)).toContain("справочник");
    }
    const attempt = await attemptsPost(post("/api/academy/attempts", {
      attemptId: ATTEMPT_ID, lessonCode: ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE,
      questions: Array.from({ length: 10 }, (_, questionIndex) => ({ questionIndex, selectedAction: "FOLD", datasetId: DATASET_10, nodeKey: "FIRST_IN_SHOVE_BTN" })),
    }));
    expect(attempt.status).toBe(400);
    expect(memory.recorded).toEqual([]);
  });

  it("forged selections still fail as ordinary validation errors (400), unrelated to the pause", async () => {
    const response = await sessionPost(post("/api/academy/solver/push-fold/session", { datasetId: "__proto__", nodeKey: "FIRST_IN_SHOVE_BTN", attemptId: ATTEMPT_ID, questionIndex: 0 }));
    expect(response.status).toBe(400);
  });

  it("reference views stay intact: every reference node still resolves for its study page", () => {
    for (const spot of listAcademyPushFoldSpots()) {
      expect(requireAcademyPushFoldSpotByStack(spot.stackBb, spot.nodeKey).spot).toEqual(spot);
    }
  });
});
