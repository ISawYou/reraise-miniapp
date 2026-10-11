/**
 * Proves the generic N-action plumbing with the TEST ONLY synthetic fixture.
 * Nothing here touches production datasets, lessons or routes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAcademyCourses } from "@/config/academy/catalog";
import { listAcademyStrategyDatasetIds } from "@/config/academy/solver-datasets";
import { ACADEMY_SOLVER_LESSON_BINDINGS } from "@/config/academy/solver-lessons";
import {
  resolveAcademyStrategyNodeAction,
  resolveActionFromFrequencies,
} from "@/lib/academy/solver";
import { buildAcademySolverSession, toPublicSolverQuestion } from "@/lib/academy/solver-training";
import {
  TEST_ONLY_ACTION_ORDER,
  TEST_ONLY_MIXED_HAND,
  TEST_ONLY_MULTI_ACTION_DATASET_ID,
  TEST_ONLY_MULTI_ACTION_NODE_KEY,
  buildTestOnlyMultiActionDataset,
} from "@/lib/academy/__tests__/fixtures/test-only-multi-action-dataset";

const dataset = buildTestOnlyMultiActionDataset();
const node = dataset.nodes[TEST_ONLY_MULTI_ACTION_NODE_KEY];

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "multi-action-test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TEST ONLY multi-action fixture isolation", () => {
  it("is never registered, bound or in the catalog", () => {
    expect(listAcademyStrategyDatasetIds()).not.toContain(TEST_ONLY_MULTI_ACTION_DATASET_ID);
    expect(ACADEMY_SOLVER_LESSON_BINDINGS.some((binding) => binding.datasetId === TEST_ONLY_MULTI_ACTION_DATASET_ID)).toBe(false);
    expect(JSON.stringify(listAcademyCourses())).not.toMatch(/test_only|TEST_ONLY/i);
  });

  it("validates with 4 actions in the declared order", () => {
    expect(node.actionCodes).toEqual(["FOLD", "CALL", "RAISE_7BB", "ALL_IN"]);
    expect(node.hands[TEST_ONLY_MIXED_HAND]).toEqual({ FOLD: 0.1, CALL: 0.4, RAISE_7BB: 0.3, ALL_IN: 0.2 });
  });
});

describe("(17)(18) generic resolver over 4 actions", () => {
  const expectedFor = (percent: number) =>
    percent < 10 ? "FOLD" : percent < 50 ? "CALL" : percent < 80 ? "RAISE_7BB" : "ALL_IN";

  it("(17) resolves every integer randomizer 0..99 to the right action, with exact counts", () => {
    const counts: Record<string, number> = {};
    for (let percent = 0; percent < 100; percent += 1) {
      const action = resolveAcademyStrategyNodeAction(node, TEST_ONLY_MIXED_HAND, percent);
      expect(action).toBe(expectedFor(percent));
      counts[action] = (counts[action] ?? 0) + 1;
    }
    expect(counts).toEqual({ FOLD: 10, CALL: 40, RAISE_7BB: 30, ALL_IN: 20 });
  });

  it("(18) is exact at every boundary (percent scale, [lower, upper) intervals)", () => {
    const frequencies = node.hands[TEST_ONLY_MIXED_HAND];
    const order = TEST_ONLY_ACTION_ORDER;
    const cases: Array<[number, string]> = [
      [0, "FOLD"], [9, "FOLD"], [9.999999, "FOLD"],
      [10, "CALL"], [10.000001, "CALL"], [49, "CALL"], [49.999999, "CALL"],
      [50, "RAISE_7BB"], [79, "RAISE_7BB"], [79.999999, "RAISE_7BB"],
      [80, "ALL_IN"], [99, "ALL_IN"], [99.999999, "ALL_IN"],
    ];
    for (const [percent, action] of cases) {
      expect(resolveActionFromFrequencies(frequencies, order, percent)).toBe(action);
    }
    expect(() => resolveActionFromFrequencies(frequencies, order, 100)).toThrow(RangeError);
    expect(() => resolveActionFromFrequencies(frequencies, order, -0.000001)).toThrow(RangeError);
  });

  it("walks the dataset's declared code order, not kind/label order", () => {
    const frequencies = node.hands[TEST_ONLY_MIXED_HAND];
    // Reversed order resolves differently at 0 → proves order is semantic.
    expect(resolveActionFromFrequencies(frequencies, [...TEST_ONLY_ACTION_ORDER].reverse(), 0)).toBe("ALL_IN");
  });
});

describe("(19) multi-action session + public payload", () => {
  const key = {
    playerId: "11111111-1111-4111-8111-111111111111",
    lessonCode: "test_only_lesson",
    attemptId: "22222222-2222-4222-8222-222222222222",
    nodeKey: TEST_ONLY_MULTI_ACTION_NODE_KEY,
  };
  const session = () => buildAcademySolverSession(key, { dataset, primaryActionCode: "RAISE_7BB" });

  it("builds a balanced 10-hand session resolved over 4 actions", () => {
    const questions = session();
    expect(questions).toHaveLength(10);
    expect(questions.filter((question) => question.bucket === "MIXED")).toHaveLength(4);
    for (const question of questions) {
      expect(question.resolvedAction).toBe(
        resolveActionFromFrequencies(question.frequencies, TEST_ONLY_ACTION_ORDER, question.randomizerPercent));
    }
  });

  it("exposes action display metadata (code/label/kind/amountBb) but never frequencies or the answer", () => {
    for (const question of session()) {
      const publicQuestion = toPublicSolverQuestion(question);
      expect(Object.keys(publicQuestion).sort()).toEqual(["actions", "hand", "randomizerPercent", "renderedCards"]);
      expect(publicQuestion.actions).toEqual([
        { code: "FOLD", kind: "FOLD", label: "Fold" },
        { code: "CALL", kind: "CALL", label: "Call" },
        { code: "RAISE_7BB", kind: "RAISE", label: "Raise 7 BB", amountBb: 7 },
        { code: "ALL_IN", kind: "ALL_IN", label: "All-in" },
      ]);
      const raw = JSON.stringify(publicQuestion);
      for (const leak of ["frequencies", "frequency", "resolvedAction", "correctAction", "bucket", "evBb", "multi-action-test-secret"]) {
        expect(raw).not.toContain(leak);
      }
    }
  });
});
