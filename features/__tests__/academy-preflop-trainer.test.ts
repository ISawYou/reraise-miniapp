import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACADEMY_SOLVER_LAB_COURSE_CODE,
  getAcademyCourse,
  getAcademyLessonByCode,
  listAcademyCourseLessonCodes,
  listAcademyCoursePracticeActivities,
  listAllAcademyLessonCodes,
} from "@/config/academy/catalog";
import { ACADEMY_MTT_REFERENCE_IMPORTS } from "@/config/academy/mtt-reference-datasets";
import mtt40 from "@/data/academy/reference/mtt-preflop/MTT_40_GTO.json";
import { ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE } from "@/config/academy/preflop-trainer";
import { ACADEMY_SOLVER_LESSON_BINDINGS } from "@/config/academy/solver-lessons";
import { buildAcademyPreflopTrainerSession } from "@/lib/academy/preflop-trainer";
import { ACADEMY_NEUTRAL_FEEDBACK_WORDING, buildSolverAnswerFeedback } from "@/lib/academy/solver-feedback";
import type { AcademyProgressRepository } from "@/lib/repositories/academy-progress";

vi.mock("@/lib/repositories", () => ({ academyProgressRepository: {} }));
vi.mock("@/lib/repositories/academy-progress", () => ({ academyProgressRepository: {} }));

const {
  ACADEMY_PRACTICE_TRAINER_VERIFIERS,
  ACADEMY_TRAINER_VERIFIERS,
  AcademyValidationError,
  getAcademyPreflopTrainerQuestion,
  getAllAcademyCoursesProgress,
  revealAcademyPreflopTrainerAnswer,
  submitAcademyTrainingAttempt,
  verifyAcademyAttempt,
  verifyAcademyPreflopTrainerAttempt,
} = await import("@/features/academy");

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const LESSON = ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE;
const DATASET_40 = "external_mtt_preflop_9max_40bb_v1";
const NODE = "FACING_OPEN_BB_VS_BTN";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "preflop-feature-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function session(datasetId = DATASET_40, nodeKey = NODE, playerId = PLAYER_ID) {
  return buildAcademyPreflopTrainerSession({ playerId, attemptId: ATTEMPT_ID, datasetId, nodeKey });
}

function answers(selected: readonly string[], datasetId = DATASET_40, nodeKey = NODE) {
  return selected.map((selectedAction, questionIndex) => ({ questionIndex, selectedAction, datasetId, nodeKey }));
}

describe("one lesson code for the whole configurable trainer", () => {
  it("is a Solver Lab practice activity, not a module lesson: the 7 HRC lessons and totals are unchanged", () => {
    const lesson = getAcademyLessonByCode(LESSON);
    expect(lesson).toMatchObject({
      code: "solver_preflop_trainer",
      title: "Префлоп-тренажёр",
      route: "/academy/solver/preflop",
      trainerKind: "PREFLOP_CONFIGURABLE_FREQUENCY",
    });
    expect(listAcademyCoursePracticeActivities(ACADEMY_SOLVER_LAB_COURSE_CODE).map((entry) => entry.code)).toEqual([LESSON]);
    const solverLab = getAcademyCourse(ACADEMY_SOLVER_LAB_COURSE_CODE)!;
    expect(listAcademyCourseLessonCodes(solverLab)).toHaveLength(7);
    expect(listAcademyCourseLessonCodes(solverLab)).not.toContain(LESSON);
    expect(listAllAcademyLessonCodes()).toHaveLength(14);
    // Never bound through the 100bb lesson-binding table.
    expect(ACADEMY_SOLVER_LESSON_BINDINGS.map((binding) => binding.lessonCode)).not.toContain(LESSON);
    expect(Object.keys(ACADEMY_TRAINER_VERIFIERS)).toEqual(["PREFLOP_RFI_BINARY", "PREFLOP_RFI_FREQUENCY"]);
    expect(ACADEMY_PRACTICE_TRAINER_VERIFIERS.PREFLOP_CONFIGURABLE_FREQUENCY).toBe(verifyAcademyPreflopTrainerAttempt);
  });

  it("attempts for different spots all record under the same single lesson code", async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const repository = {
      recordCompletedAttempt: async (input: Record<string, unknown>) => {
        recorded.push(input);
        return {
          lesson_code: input.lessonCode as string,
          attempts_count: recorded.length,
          last_score_percent: input.scorePercent as number,
          best_score_percent: input.scorePercent as number,
          passed: input.passed as boolean,
          first_completed_at: null,
          last_attempt_at: "2026-10-11T00:00:00.000Z",
          is_new_attempt: true,
          first_pass: false,
          new_best: false,
        };
      },
    } as unknown as AcademyProgressRepository;
    for (const [datasetId, nodeKey] of [[DATASET_40, NODE], ["external_mtt_preflop_9max_20bb_v1", "RFI_SB"]] as const) {
      const perfect = session(datasetId, nodeKey).map((question) => question.resolvedAction);
      const result = await submitAcademyTrainingAttempt(PLAYER_ID, {
        attemptId: ATTEMPT_ID, lessonCode: LESSON, questions: answers(perfect, datasetId, nodeKey),
      }, repository);
      expect(result.result).toMatchObject({ correctAnswers: 10, percentage: 100, passed: true });
      expect(result.progress.lessonCode).toBe(LESSON);
    }
    expect(recorded.map((entry) => entry.lessonCode)).toEqual([LESSON, LESSON]);
    expect(recorded.every((entry) => entry.playerId === PLAYER_ID)).toBe(true);
  });

  it("practice progress rows never leak into course progress (solver_lab stays out of 7)", async () => {
    const row = (lessonCode: string) => ({
      lesson_code: lessonCode, attempts_count: 1, last_score_percent: 100, best_score_percent: 100, passed: true,
      first_completed_at: "2026-10-11T00:00:00.000Z", last_attempt_at: "2026-10-11T00:00:00.000Z",
    });
    const repository = {
      listCourseProgress: async (_playerId: string, codes: readonly string[]) =>
        [row(LESSON), row("solver_rfi_9max_100bb_co")].filter((entry) => codes.includes(entry.lesson_code)),
    } as unknown as AcademyProgressRepository;
    const all = await getAllAcademyCoursesProgress(PLAYER_ID, repository);
    expect(all.courses[1].course).toEqual({ passedLessons: 1, totalLessons: 7, progressPercent: 14 });
  });
});

describe("question / reveal / verify", () => {
  it("(11) the served question never exposes frequencies or the resolved action", () => {
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      const question = getAcademyPreflopTrainerQuestion(PLAYER_ID, { datasetId: DATASET_40, nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex });
      expect(Object.keys(question).sort()).toEqual(["actions", "hand", "randomizerPercent", "renderedCards", "spot"]);
      const raw = JSON.stringify(question);
      for (const leak of ["frequencies", "frequency", "resolvedAction", "bucket", "evBb", "preflop-feature-secret"]) expect(raw).not.toContain(leak);
      expect(question.spot).toMatchObject({ stackBb: 40, heroPosition: "BB", villainPosition: "BTN", title: "BB против BTN" });
    }
  });

  it("(12) reveal returns the exact imported frequencies for the hand (cross-checked with the raw source)", () => {
    const raw = mtt40 as Record<string, Record<string, number>>;
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      const reveal = revealAcademyPreflopTrainerAnswer(PLAYER_ID, {
        datasetId: DATASET_40, nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex, selectedAction: "FOLD",
      });
      const dataset = ACADEMY_MTT_REFERENCE_IMPORTS[40].dataset;
      expect(reveal.frequencies).toEqual(dataset.nodes[NODE].hands[reveal.hand]);
      // Facing an open has no `prev` normalization: raise = 3BetBBvsBTN, call = CallBBvsBTN, fold = 1 - both.
      const r = raw["3BetBBvsBTN"][reveal.hand];
      const c = raw.CallBBvsBTN[reveal.hand];
      expect(reveal.frequencies.RAISE).toBe(r);
      expect(reveal.frequencies.CALL).toBe(c);
      expect(reveal.frequencies.FOLD).toBeCloseTo(1 - r - c, 12);
      expect(reveal.matchesResolvedAction).toBe(reveal.resolvedAction === "FOLD");
      expect(reveal.resolvedAction).toBe(session()[questionIndex].resolvedAction);
    }
  });

  it("scores against the resolved action only (perfect / all-fold), like the 100bb trainer", () => {
    const resolved = session().map((question) => question.resolvedAction);
    const verify = (selected: readonly string[]) => verifyAcademyPreflopTrainerAttempt(
      { attemptId: ATTEMPT_ID, lessonCode: LESSON, questions: answers(selected) }, { playerId: PLAYER_ID });
    expect(verify(resolved)).toMatchObject({ correctAnswers: 10, percentage: 100, passed: true });
    const foldCount = resolved.filter((action) => action === "FOLD").length;
    expect(verify(resolved.map(() => "FOLD")).correctAnswers).toBe(foldCount);
    // Dispatch by the catalog lesson's trainer kind uses the same verifier.
    expect(verifyAcademyAttempt(getAcademyLessonByCode(LESSON)!, {
      attemptId: ATTEMPT_ID, lessonCode: LESSON, questions: answers(resolved),
    }, { playerId: PLAYER_ID })).toEqual(verify(resolved));
  });

  it("(13) forged dataset / node / action are rejected at serve, reveal and verify", () => {
    const forgedSelections: Array<[unknown, unknown]> = [
      ["external_mtt_preflop_9max_30bb_v1", NODE],
      ["hrc_scenario_b_rfi_9max_100bb_v1", "UTG"],
      [DATASET_40, "FACING_4BET_CO_VS_UTG"], // rejected by the import (negative fold remainder)
      [DATASET_40, "FACING_5BET_SB_VS_BB"], // unreachable at 40 BB
      [DATASET_40, "__proto__"],
      [undefined, undefined],
      [DATASET_40, ["FACING_OPEN_BB_VS_BTN"]],
    ];
    for (const [datasetId, nodeKey] of forgedSelections) {
      expect(() => getAcademyPreflopTrainerQuestion(PLAYER_ID, { datasetId, nodeKey, attemptId: ATTEMPT_ID, questionIndex: 0 }))
        .toThrow(AcademyValidationError);
      expect(() => revealAcademyPreflopTrainerAnswer(PLAYER_ID, { datasetId, nodeKey, attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "FOLD" }))
        .toThrow(AcademyValidationError);
      expect(() => verifyAcademyPreflopTrainerAttempt({
        attemptId: ATTEMPT_ID, lessonCode: LESSON,
        questions: Array.from({ length: 10 }, (_, questionIndex) => ({ questionIndex, selectedAction: "FOLD", datasetId, nodeKey })),
      }, { playerId: PLAYER_ID })).toThrow(AcademyValidationError);
    }
    // Action not offered by this node (2-action CALL/FOLD node at 10 BB has no RAISE).
    expect(() => revealAcademyPreflopTrainerAnswer(PLAYER_ID, {
      datasetId: "external_mtt_preflop_9max_10bb_v1", nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "RAISE",
    })).toThrow("Допустимые действия: CALL или FOLD");
    expect(() => verifyAcademyPreflopTrainerAttempt({
      attemptId: ATTEMPT_ID, lessonCode: LESSON, questions: answers(Array(10).fill("ALL_IN")),
    }, { playerId: PLAYER_ID })).toThrow("Допустимые действия: RAISE, CALL или FOLD");
    // Mixed selections inside one attempt are rejected.
    const mixed = answers(Array(10).fill("FOLD"));
    mixed[5] = { ...mixed[5], nodeKey: "FACING_OPEN_BB_VS_CO" };
    expect(() => verifyAcademyPreflopTrainerAttempt({ attemptId: ATTEMPT_ID, lessonCode: LESSON, questions: mixed }, { playerId: PLAYER_ID }))
      .toThrow(AcademyValidationError);
    // Wrong lesson code / no player / bad index / bad attempt id.
    expect(() => verifyAcademyPreflopTrainerAttempt({ attemptId: ATTEMPT_ID, lessonCode: "solver_rfi_9max_100bb_co", questions: answers(Array(10).fill("FOLD")) }, { playerId: PLAYER_ID }))
      .toThrow(AcademyValidationError);
    expect(() => verifyAcademyPreflopTrainerAttempt({ attemptId: ATTEMPT_ID, lessonCode: LESSON, questions: answers(Array(10).fill("FOLD")) }))
      .toThrow(AcademyValidationError);
    expect(() => getAcademyPreflopTrainerQuestion(PLAYER_ID, { datasetId: DATASET_40, nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex: 10 }))
      .toThrow(AcademyValidationError);
    expect(() => getAcademyPreflopTrainerQuestion(PLAYER_ID, { datasetId: DATASET_40, nodeKey: NODE, attemptId: "nope", questionIndex: 0 }))
      .toThrow(AcademyValidationError);
  });
});

describe("(15) mixed-strategy feedback semantics for N actions", () => {
  const forbidden = /неправильн|неверн|ошибк|wrong/i;
  const actions = [
    { code: "RAISE", label: "Raise", ru: { button: "3-бет", inline: "3-бет", short: "3-бет", always: "всегда делаем 3-бет" } },
    { code: "CALL", label: "Call", ru: { button: "Колл", inline: "колл", short: "колл", always: "всегда коллируем" } },
    { code: "FOLD", label: "Fold", ru: { button: "Фолд", inline: "фолд", short: "фолд", always: "всегда сбрасываем" } },
  ];

  it("a mismatch on a genuinely mixed hand is non-judgmental and states the split", () => {
    const feedback = buildSolverAnswerFeedback({
      hand: "AJo", frequencies: { RAISE: 0.3, CALL: 0.5, FOLD: 0.2 }, randomizerPercent: 12,
      resolvedAction: "RAISE", selectedAction: "CALL", actions,
    }, ACADEMY_NEUTRAL_FEEDBACK_WORDING);
    expect(feedback.tone).toBe("mixed");
    expect(feedback.title).toBe("Смешанная рука");
    expect(`${feedback.title} ${feedback.summary} ${feedback.detail}`).not.toMatch(forbidden);
    expect(feedback.summary).toBe("Частота стратегии для AJo смешанная: 3-бет 30% / колл 50% / фолд 20%.");
    expect(feedback.detail).toContain("Рандомайзер 12 → в этой раздаче выпал 3-бет.");
    expect(feedback.detail).toContain("колл здесь тоже часть стратегии");
    expect(`${feedback.summary} ${feedback.detail}`).not.toMatch(/солвер/i);
  });

  it("choosing a 0% action in a mixed hand is stated plainly (not called 'part of the strategy')", () => {
    const feedback = buildSolverAnswerFeedback({
      hand: "KQs", frequencies: { RAISE: 0.4, CALL: 0.6, FOLD: 0 }, randomizerPercent: 70,
      resolvedAction: "CALL", selectedAction: "FOLD", actions,
    }, ACADEMY_NEUTRAL_FEEDBACK_WORDING);
    expect(feedback.tone).toBe("incorrect");
    expect(feedback.detail).not.toContain("тоже часть стратегии");
    expect(feedback.detail).toContain("«фолд» в этой руке стратегия не играет совсем");
  });

  it("the default (100bb) wording is unchanged", () => {
    const feedback = buildSolverAnswerFeedback({
      hand: "AJo", frequencies: { RAISE: 0.41, FOLD: 0.59 }, randomizerPercent: 50,
      resolvedAction: "FOLD", selectedAction: "RAISE",
      actions: [actions[0], actions[2]],
    });
    expect(feedback.summary).toBe("Солверная частота для AJo смешанная: 3-бет 41% / фолд 59%.");
  });

  it("feedback built from a real reveal of a mixed hand is non-judgmental", () => {
    const mixedIndex = session().findIndex((question) => question.bucket === "MIXED");
    expect(mixedIndex).toBeGreaterThanOrEqual(0);
    const question = session()[mixedIndex];
    const other = question.actions.map((action) => action.code)
      .find((code) => code !== question.resolvedAction && question.frequencies[code] > 0)!;
    const reveal = revealAcademyPreflopTrainerAnswer(PLAYER_ID, {
      datasetId: DATASET_40, nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex: mixedIndex, selectedAction: other,
    });
    const feedback = buildSolverAnswerFeedback(reveal, ACADEMY_NEUTRAL_FEEDBACK_WORDING);
    expect(reveal.matchesResolvedAction).toBe(false);
    expect(feedback.tone).toBe("mixed");
    expect(`${feedback.title} ${feedback.summary} ${feedback.detail}`).not.toMatch(forbidden);
  });
});
