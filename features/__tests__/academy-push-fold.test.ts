import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACADEMY_SOLVER_LAB_COURSE_CODE,
  getAcademyCourse,
  getAcademyLessonByCode,
  listAcademyCourseAdditionalPracticeActivities,
  listAcademyCourseLessonCodes,
  listAcademyCoursePracticeActivities,
  listAllAcademyLessonCodes,
} from "@/config/academy/catalog";
import { getAcademyPushFoldDataset } from "@/config/academy/push-fold-datasets";
import {
  ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS,
  ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE,
} from "@/config/academy/push-fold-trainer";
import { ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE } from "@/config/academy/preflop-trainer";
import { holdemMathPushFoldDatasetId } from "@/config/academy/solver-dataset-ids";
import { CANONICAL_STARTING_HANDS } from "@/lib/academy/preflop";
import { buildPushFoldFeedback } from "@/lib/academy/push-fold-copy";
import {
  ACADEMY_PUSH_FOLD_MIX_SLOT_TEMPLATE,
  buildAcademyPushFoldMixSession,
  listAcademyPushFoldMixCandidates,
  selectPushFoldMixNodes,
} from "@/lib/academy/push-fold-mix";
import { buildPushFoldTableScene } from "@/lib/academy/push-fold-table-scene";
import {
  AcademyPushFoldSelectionError,
  buildAcademyPushFoldSession,
  classifyPushFoldHands,
  getPushFoldSpotScene,
  listAcademyPushFoldSpots,
  pushFoldPureAction,
  requireAcademyPushFoldSpot,
  requireAcademyPushFoldSpotByStack,
} from "@/lib/academy/push-fold-trainer";
import { buildAcademyPreflopTrainerSession, requireAcademyPreflopTrainerSpot } from "@/lib/academy/preflop-trainer";
import { resolveAcademyStrategyNodeAction } from "@/lib/academy/solver";
import type { AcademyProgressRepository } from "@/lib/repositories/academy-progress";

// These tests exercise the SCORED Push/Fold engine (sessions, reveal, verifier)
// as it will run once a dataset is independently validated for scored
// training. Production keeps ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS EMPTY (see
// docs/ACADEMY_PUSH_FOLD_AUDIT.md); that real, unmocked fail-closed policy is
// pinned in features/__tests__/academy-push-fold-policy.test.ts.
vi.mock("@/config/academy/push-fold-trainer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/academy/push-fold-trainer")>();
  return { ...actual, ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS: actual.ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS };
});

vi.mock("@/lib/repositories", () => ({ academyProgressRepository: {} }));
vi.mock("@/lib/repositories/academy-progress", () => ({ academyProgressRepository: {} }));

const {
  ACADEMY_PRACTICE_TRAINER_VERIFIERS,
  ACADEMY_TRAINER_VERIFIERS,
  AcademyValidationError,
  getAcademyPushFoldMixQuestion,
  getAcademyPushFoldQuestion,
  revealAcademyPushFoldAnswer,
  revealAcademyPushFoldMixAnswer,
  submitAcademyTrainingAttempt,
  verifyAcademyAttempt,
  verifyAcademyPushFoldAttempt,
} = await import("@/features/academy");

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PLAYER = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const LESSON = ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE;
const DATASET_10 = holdemMathPushFoldDatasetId(10, "ante10");
const DATASET_8 = holdemMathPushFoldDatasetId(8, "ante10");
const PROTOTYPE_KEYS = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "prototype", "__defineGetter__"];

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "push-fold-feature-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function fixed(datasetId = DATASET_10, nodeKey = "FIRST_IN_SHOVE_BTN", playerId = PLAYER_ID, attemptId = ATTEMPT_ID) {
  return buildAcademyPushFoldSession({ playerId, attemptId, datasetId, nodeKey });
}

function attempt(n: number): string {
  return `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
}

describe("one practice identity for the whole Push/Fold module", () => {
  it("is a Solver Lab practice activity (not a module lesson); course totals and the MTT trainer identity are unchanged", () => {
    expect(getAcademyLessonByCode(LESSON)).toMatchObject({
      code: "solver_push_fold_trainer",
      route: "/academy/solver/push-fold",
      trainerKind: "PUSH_FOLD_PURE",
      lessonKind: "PUSH_FOLD_TRAINER",
    });
    expect(listAcademyCourseAdditionalPracticeActivities(ACADEMY_SOLVER_LAB_COURSE_CODE).map((lesson) => lesson.code)).toEqual([LESSON]);
    expect(listAcademyCoursePracticeActivities(ACADEMY_SOLVER_LAB_COURSE_CODE).map((lesson) => lesson.code))
      .toEqual([ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE]);
    const solverLab = getAcademyCourse(ACADEMY_SOLVER_LAB_COURSE_CODE)!;
    expect(listAcademyCourseLessonCodes(solverLab)).toHaveLength(7);
    expect(listAcademyCourseLessonCodes(solverLab)).not.toContain(LESSON);
    expect(listAllAcademyLessonCodes()).toHaveLength(14);
    expect(listAllAcademyLessonCodes()).not.toContain(LESSON);
    expect(Object.keys(ACADEMY_TRAINER_VERIFIERS)).toEqual(["PREFLOP_RFI_BINARY", "PREFLOP_RFI_FREQUENCY"]);
    expect(ACADEMY_PRACTICE_TRAINER_VERIFIERS.PUSH_FOLD_PURE).toBe(verifyAcademyPushFoldAttempt);
  });

  it("every spot (fixed or Quick) records under the single lesson code — no per-stack / per-seat codes", async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const repository = {
      recordCompletedAttempt: async (input: Record<string, unknown>) => {
        recorded.push(input);
        return {
          lesson_code: input.lessonCode, attempts_count: recorded.length, last_score_percent: input.scorePercent,
          best_score_percent: input.scorePercent, passed: input.passed, first_completed_at: null,
          last_attempt_at: "2026-10-11T00:00:00.000Z", is_new_attempt: true, first_pass: false, new_best: false,
        };
      },
    } as unknown as AcademyProgressRepository;
    for (const [datasetId, nodeKey, n] of [[DATASET_10, "FIRST_IN_SHOVE_BTN", 1], [DATASET_8, "CALL_VS_SHOVE_BB_VS_SB", 2]] as const) {
      const attemptId = attempt(n);
      const questions = fixed(datasetId, nodeKey, PLAYER_ID, attemptId)
        .map((q, questionIndex) => ({ questionIndex, selectedAction: q.resolvedAction, datasetId, nodeKey }));
      await submitAcademyTrainingAttempt(PLAYER_ID, { attemptId, lessonCode: LESSON, questions }, repository);
    }
    const mix = buildAcademyPushFoldMixSession({ playerId: PLAYER_ID, attemptId: attempt(3) });
    await submitAcademyTrainingAttempt(PLAYER_ID, {
      attemptId: attempt(3),
      lessonCode: LESSON,
      questions: mix.map((q, questionIndex) => ({
        questionIndex, selectedAction: q.resolvedAction, datasetId: q.spot.datasetId, nodeKey: q.spot.nodeKey, mode: "PUSH_FOLD_QUICK",
      })),
    }, repository);
    expect(recorded.map((entry) => entry.lessonCode)).toEqual([LESSON, LESSON, LESSON]);
    expect(recorded.every((entry) => entry.scorePercent === 100)).toBe(true);
  });
});

describe("spot index + fail-closed selection", () => {
  it("offers exactly the whitelisted ante10 4–15 BB nodes: 6 × (8 first-in + 36 call)", () => {
    const spots = listAcademyPushFoldSpots();
    expect(spots).toHaveLength(6 * 44);
    expect(new Set(spots.map((spot) => spot.datasetId))).toEqual(new Set(ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS));
    expect([...new Set(spots.map((spot) => spot.stackBb))]).toEqual([4, 6, 8, 10, 12, 15]);
    expect(spots.filter((spot) => spot.situation === "FIRST_IN_SHOVE")).toHaveLength(48);
    expect(spots.find((spot) => spot.nodeKey === "FIRST_IN_SHOVE_BTN" && spot.stackBb === 10)).toEqual({
      datasetId: DATASET_10, nodeKey: "FIRST_IN_SHOVE_BTN", stackBb: 10, situation: "FIRST_IN_SHOVE", heroPosition: "BTN",
    });
    // Spot descriptors carry no range / frequency data.
    expect(JSON.stringify(spots)).not.toMatch(/frequenc|sourceCoverage|ALL_IN|"CALL"/);
  });

  it("(22) forged / unknown / foreign datasets and node keys fail closed — including prototype-shaped ids", () => {
    const badDatasets: unknown[] = [
      "nope", "", undefined, null, 10, {}, ["x"],
      "hrc_scenario_b_rfi_9max_100bb_v1",
      "external_mtt_preflop_9max_10bb_v1",
      holdemMathPushFoldDatasetId(20, "ante10"),
      holdemMathPushFoldDatasetId(10, "noante"),
      ...PROTOTYPE_KEYS,
    ];
    for (const datasetId of badDatasets) {
      expect(() => requireAcademyPushFoldSpot(datasetId, "FIRST_IN_SHOVE_BTN")).toThrow(AcademyPushFoldSelectionError);
    }
    for (const nodeKey of ["", "FIRST_IN_SHOVE_BB", "first_in_shove_btn", "RFI_BTN", "FACING_OPEN_BB_VS_BTN", "CALL_VS_SHOVE_SB_VS_BB", 7, null, ...PROTOTYPE_KEYS]) {
      expect(() => requireAcademyPushFoldSpot(DATASET_10, nodeKey)).toThrow(AcademyPushFoldSelectionError);
    }
    expect(() => requireAcademyPushFoldSpotByStack(20, "FIRST_IN_SHOVE_BTN")).toThrow(AcademyPushFoldSelectionError);
    expect(() => requireAcademyPushFoldSpotByStack(10, "__proto__")).toThrow(AcademyPushFoldSelectionError);
  });

  it("(22) the two trainers cannot reach each other's datasets", () => {
    expect(() => requireAcademyPreflopTrainerSpot(DATASET_10, "FIRST_IN_SHOVE_BTN")).toThrow();
    expect(() => buildAcademyPreflopTrainerSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId: DATASET_10, nodeKey: "FIRST_IN_SHOVE_BTN" }))
      .toThrow();
    expect(() => requireAcademyPushFoldSpot("external_mtt_preflop_9max_10bb_v1", "RFI_BTN")).toThrow(AcademyPushFoldSelectionError);
  });
});

describe("table scene", () => {
  it("first-in 10 BB BTN: seats before BTN folded, BTN is hero, blinds still to act", () => {
    const scene = getPushFoldSpotScene(requireAcademyPushFoldSpotByStack(10, "FIRST_IN_SHOVE_BTN").spot);
    expect(scene.heroSeat).toBe("BTN");
    expect(scene.villainSeat).toBeUndefined();
    expect(scene.seats.map((seat) => [seat.seat, seat.role, seat.actionLabel ?? null])).toEqual([
      ["UTG", "folded", "Фолд"], ["UTG1", "folded", "Фолд"], ["UTG2", "folded", "Фолд"], ["LJ", "folded", "Фолд"],
      ["HJ", "folded", "Фолд"], ["CO", "folded", "Фолд"], ["BTN", "hero", null], ["SB", "waiting", null], ["BB", "waiting", null],
    ]);
  });

  it("call 8 BB BB vs CO: CO labelled Олл-ин (from CO's real first-in node), between folded, BB hero", () => {
    const scene = getPushFoldSpotScene(requireAcademyPushFoldSpotByStack(8, "CALL_VS_SHOVE_BB_VS_CO").spot);
    expect(scene).toMatchObject({ heroSeat: "BB", villainSeat: "CO" });
    expect(scene.seats.map((seat) => [seat.seat, seat.role, seat.actionLabel ?? null])).toEqual([
      ["UTG", "folded", "Фолд"], ["UTG1", "folded", "Фолд"], ["UTG2", "folded", "Фолд"], ["LJ", "folded", "Фолд"],
      ["HJ", "folded", "Фолд"], ["CO", "villain", "Олл-ин"], ["BTN", "folded", "Фолд"], ["SB", "folded", "Фолд"], ["BB", "hero", null],
    ]);
  });

  it("call with seats after hero: they are still to act (no invented action)", () => {
    const scene = getPushFoldSpotScene(requireAcademyPushFoldSpotByStack(12, "CALL_VS_SHOVE_CO_VS_HJ").spot);
    const roles = Object.fromEntries(scene.seats.map((seat) => [seat.seat, seat.role]));
    expect(roles).toMatchObject({ HJ: "villain", CO: "hero", BTN: "waiting", SB: "waiting", BB: "waiting", LJ: "folded" });
  });

  it("rejects inconsistent seats instead of drawing them", () => {
    expect(() => buildPushFoldTableScene({ situation: "CALL_VS_SHOVE", heroPosition: "CO", villainPosition: "BTN" })).toThrow();
    expect(() => buildPushFoldTableScene({ situation: "FIRST_IN_SHOVE", heroPosition: "CO", villainPosition: "HJ" })).toThrow();
    expect(() => buildPushFoldTableScene({ situation: "FIRST_IN_SHOVE", heroPosition: "MP" })).toThrow();
  });
});

describe("hand categories + fixed-node session", () => {
  it("pure answers only; categories partition the 169 hands by range boundary", () => {
    const { node } = requireAcademyPushFoldSpotByStack(10, "FIRST_IN_SHOVE_BTN");
    const categories = classifyPushFoldHands(node);
    const all = [...categories.values()].flat();
    expect(all.sort()).toEqual([...CANONICAL_STARTING_HANDS].sort());
    for (const hand of categories.get("CORE_IN")!.concat(categories.get("EDGE_IN")!)) expect(pushFoldPureAction(node, hand)).toBe("ALL_IN");
    for (const hand of categories.get("DEEP_OUT")!.concat(categories.get("EDGE_OUT")!)) expect(pushFoldPureAction(node, hand)).toBe("FOLD");
    expect(categories.get("CORE_IN")).toContain("AA");
    expect(categories.get("EDGE_IN")!.length).toBeGreaterThan(0);
    expect(categories.get("EDGE_OUT")!.length).toBeGreaterThan(0);
  });

  it("fixed-node session: deterministic, 10 unique hands, ≥ 6 boundary hands when available, answers = dataset", () => {
    const session = fixed();
    expect(session).toEqual(fixed());
    expect(new Set(session.map((q) => q.hand)).size).toBe(10);
    expect(session.filter((q) => q.category === "EDGE_IN" || q.category === "EDGE_OUT").length).toBeGreaterThanOrEqual(6);
    const dataset = getAcademyPushFoldDataset(DATASET_10);
    for (const q of session) {
      expect(q.frequencies).toBe(dataset.nodes.FIRST_IN_SHOVE_BTN.hands[q.hand]);
      expect(q.resolvedAction).toBe(resolveAcademyStrategyNodeAction(dataset.nodes.FIRST_IN_SHOVE_BTN, q.hand, 50));
    }
    expect(fixed(DATASET_10, "FIRST_IN_SHOVE_BTN", OTHER_PLAYER)).not.toEqual(session);
  });
});

describe("Quick Push/Fold", () => {
  it("(18) same (player, attempt) → same 10-question sequence; different attempt / player → different", () => {
    const a = buildAcademyPushFoldMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
    expect(a).toHaveLength(10);
    expect(buildAcademyPushFoldMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID })).toEqual(a);
    const key = (session: typeof a) => session.map((q) => `${q.spot.datasetId}/${q.spot.nodeKey}/${q.hand}`).join("|");
    expect(key(buildAcademyPushFoldMixSession({ playerId: PLAYER_ID, attemptId: attempt(9) }))).not.toBe(key(a));
    expect(key(buildAcademyPushFoldMixSession({ playerId: OTHER_PLAYER, attemptId: ATTEMPT_ID }))).not.toBe(key(a));
  });

  it("(19) every session: all 6 stacks (none > 2×), both families, first-in 5–6, BB calls ≥ 2, no consecutive / repeated node", () => {
    const totals = { firstIn: 0, call: 0, edge: 0, questions: 0 };
    for (let n = 0; n < 40; n += 1) {
      const session = buildAcademyPushFoldMixSession({ playerId: PLAYER_ID, attemptId: attempt(100 + n) });
      const stacks = session.map((q) => q.spot.stackBb);
      expect(new Set(stacks)).toEqual(new Set([4, 6, 8, 10, 12, 15]));
      for (const stack of new Set(stacks)) expect(stacks.filter((value) => value === stack).length).toBeLessThanOrEqual(2);
      const firstIn = session.filter((q) => q.spot.situation === "FIRST_IN_SHOVE").length;
      expect(firstIn).toBeGreaterThanOrEqual(5);
      expect(firstIn).toBeLessThanOrEqual(6);
      expect(session.filter((q) => q.spot.situation === "CALL_VS_SHOVE" && q.spot.heroPosition === "BB").length).toBeGreaterThanOrEqual(2);
      expect(new Set(session.map((q) => `${q.spot.datasetId}:${q.spot.nodeKey}`)).size).toBe(10);
      for (let i = 1; i < session.length; i += 1) expect(session[i].spot.nodeKey).not.toBe(session[i - 1].spot.nodeKey);
      expect(new Set(session.map((q) => q.hand)).size).toBe(10);
      for (const q of session) expect(ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS).toContain(q.spot.datasetId);
      totals.firstIn += firstIn;
      totals.call += 10 - firstIn;
      totals.edge += session.filter((q) => q.category === "EDGE_IN" || q.category === "EDGE_OUT").length;
      totals.questions += 10;
    }
    expect(totals.firstIn / totals.questions).toBeGreaterThan(0.5);
    expect(totals.call / totals.questions).toBeGreaterThan(0.4);
    // Not AA/72o-only: most hands sit on a range boundary.
    expect(totals.edge / totals.questions).toBeGreaterThanOrEqual(0.55);
  });

  it("slot template + node pool are the documented ones (seeded streams)", () => {
    expect(ACADEMY_PUSH_FOLD_MIX_SLOT_TEMPLATE.filter((slot) => slot === "FIRST_IN")).toHaveLength(5);
    expect(listAcademyPushFoldMixCandidates()).toHaveLength(264);
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < 200; i += 1) {
      const nodes = selectPushFoldMixNodes(random);
      expect(nodes).toHaveLength(10);
      expect(nodes.filter((node) => node.category === "FIRST_IN").length).toBeGreaterThanOrEqual(5);
    }
  });

  it("(20) public questions carry no frequencies / answer / category", () => {
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      for (const question of [
        getAcademyPushFoldMixQuestion(PLAYER_ID, { attemptId: ATTEMPT_ID, questionIndex }),
        getAcademyPushFoldQuestion(PLAYER_ID, { datasetId: DATASET_10, nodeKey: "FIRST_IN_SHOVE_BTN", attemptId: ATTEMPT_ID, questionIndex }),
      ]) {
        expect(Object.keys(question).sort()).toEqual(["actions", "hand", "renderedCards", "spot"]);
        const raw = JSON.stringify(question);
        for (const leak of ["frequenc", "resolvedAction", "correctAction", "category", "EDGE_", "CORE_IN", "DEEP_OUT", "PURE:", "MIXED", "sourceCoverage", "evBb", "weight"]) {
          expect(raw).not.toContain(leak);
        }
      }
    }
  });

  it("(21) reveal re-derives the answer server-side and matches the real imported dataset", () => {
    const session = buildAcademyPushFoldMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
    session.forEach((q, questionIndex) => {
      const wrong = q.actions.find((action) => action.code !== q.resolvedAction)!.code;
      const reveal = revealAcademyPushFoldMixAnswer(PLAYER_ID, { attemptId: ATTEMPT_ID, questionIndex, selectedAction: wrong });
      const node = getAcademyPushFoldDataset(q.spot.datasetId).nodes[q.spot.nodeKey];
      const pure = node.actionCodes.find((code) => node.hands[q.hand][code] === 1);
      expect(reveal).toMatchObject({ hand: q.hand, resolvedAction: pure, selectedAction: wrong, matchesResolvedAction: false });
      expect(reveal.frequencies).toEqual(node.hands[q.hand]);
      expect(buildPushFoldFeedback(reveal).tone).toBe("incorrect");
    });
    const fixedReveal = revealAcademyPushFoldAnswer(PLAYER_ID, {
      datasetId: DATASET_8, nodeKey: "CALL_VS_SHOVE_BB_VS_SB", attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "CALL",
    });
    const node8 = getAcademyPushFoldDataset(DATASET_8).nodes.CALL_VS_SHOVE_BB_VS_SB;
    expect(fixedReveal.resolvedAction).toBe(node8.hands[fixedReveal.hand].CALL === 1 ? "CALL" : "FOLD");
    expect(fixedReveal.matchesResolvedAction).toBe(fixedReveal.resolvedAction === "CALL");
    expect(() => revealAcademyPushFoldMixAnswer(PLAYER_ID, { attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "RAISE" }))
      .toThrow(AcademyValidationError);
    expect(() => revealAcademyPushFoldMixAnswer(PLAYER_ID, { attemptId: ATTEMPT_ID, questionIndex: 10, selectedAction: "FOLD" }))
      .toThrow(AcademyValidationError);
    expect(() => getAcademyPushFoldMixQuestion(PLAYER_ID, { attemptId: "not-a-uuid", questionIndex: 0 })).toThrow(AcademyValidationError);
  });
});

describe("verifier", () => {
  const verify = (questions: unknown[], playerId: string = PLAYER_ID) =>
    verifyAcademyPushFoldAttempt({ attemptId: ATTEMPT_ID, lessonCode: LESSON, questions }, { playerId });

  it("scores only selectedAction against the re-derived session (fixed + Quick); dispatch goes through the practice registry", () => {
    const answers = fixed().map((q, questionIndex) => ({ questionIndex, selectedAction: q.resolvedAction, datasetId: DATASET_10, nodeKey: "FIRST_IN_SHOVE_BTN" }));
    expect(verify(answers)).toMatchObject({ correctAnswers: 10, passed: true });
    const folds = answers.map((answer) => ({ ...answer, selectedAction: "FOLD" }));
    expect(verify(folds).correctAnswers).toBe(fixed().filter((q) => q.resolvedAction === "FOLD").length);
    expect(verifyAcademyAttempt(getAcademyLessonByCode(LESSON)!, { attemptId: ATTEMPT_ID, lessonCode: LESSON, questions: answers }, { playerId: PLAYER_ID }))
      .toEqual(verify(answers));
    const mix = buildAcademyPushFoldMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID }).map((q, questionIndex) => ({
      questionIndex, selectedAction: q.resolvedAction, datasetId: q.spot.datasetId, nodeKey: q.spot.nodeKey, mode: "PUSH_FOLD_QUICK",
    }));
    expect(verify(mix)).toMatchObject({ correctAnswers: 10, passed: true });
  });

  it("(22) rejects forged nodes, foreign datasets, prototype keys, mixed modes, wrong lesson, missing player", () => {
    const answers = fixed().map((q, questionIndex) => ({ questionIndex, selectedAction: q.resolvedAction, datasetId: DATASET_10, nodeKey: "FIRST_IN_SHOVE_BTN" }));
    for (const forged of [
      answers.map((answer) => ({ ...answer, datasetId: "external_mtt_preflop_9max_10bb_v1" })),
      answers.map((answer) => ({ ...answer, datasetId: holdemMathPushFoldDatasetId(20, "ante10") })),
      answers.map((answer) => ({ ...answer, nodeKey: "__proto__" })),
      answers.map((answer) => ({ ...answer, datasetId: "constructor" })),
      answers.map((answer, index) => (index === 3 ? { ...answer, nodeKey: "FIRST_IN_SHOVE_CO" } : answer)),
      answers.map((answer) => ({ ...answer, selectedAction: "CALL" })),
      answers.map((answer, index) => (index === 2 ? { ...answer, mode: "PUSH_FOLD_QUICK" } : answer)),
      answers.map((answer) => ({ ...answer, mode: "QUICK_MIX" })),
      answers.slice(0, 9),
    ]) {
      expect(() => verify(forged)).toThrow(AcademyValidationError);
    }
    const mix = buildAcademyPushFoldMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID }).map((q, questionIndex) => ({
      questionIndex, selectedAction: q.resolvedAction, datasetId: q.spot.datasetId, nodeKey: q.spot.nodeKey, mode: "PUSH_FOLD_QUICK",
    }));
    const swapped = mix.map((answer, index) => (index === 0 ? { ...answer, nodeKey: mix[1].nodeKey, datasetId: mix[1].datasetId } : answer));
    expect(() => verify(swapped)).toThrow(AcademyValidationError);
    expect(() => verifyAcademyPushFoldAttempt({ attemptId: ATTEMPT_ID, lessonCode: LESSON, questions: answers }, {}))
      .toThrow(AcademyValidationError);
    expect(() => verifyAcademyPushFoldAttempt({ attemptId: ATTEMPT_ID, lessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, questions: answers }, { playerId: PLAYER_ID }))
      .toThrow(AcademyValidationError);
  });
});
