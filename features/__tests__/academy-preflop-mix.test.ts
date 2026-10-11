import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAcademyLessonByCode, listAllAcademyLessonCodes } from "@/config/academy/catalog";
import { ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE } from "@/config/academy/preflop-trainer";
import { buildAcademyPreflopMixSession } from "@/lib/academy/preflop-mix";
import { buildAcademyPreflopTrainerSession } from "@/lib/academy/preflop-trainer";
import { ACADEMY_NEUTRAL_FEEDBACK_WORDING, buildSolverAnswerFeedback } from "@/lib/academy/solver-feedback";
import type { AcademyProgressRepository } from "@/lib/repositories/academy-progress";

vi.mock("@/lib/repositories", () => ({ academyProgressRepository: {} }));
vi.mock("@/lib/repositories/academy-progress", () => ({ academyProgressRepository: {} }));

const {
  ACADEMY_PRACTICE_TRAINER_VERIFIERS,
  AcademyValidationError,
  getAcademyPreflopMixQuestion,
  revealAcademyPreflopMixAnswer,
  submitAcademyTrainingAttempt,
  verifyAcademyAttempt,
  verifyAcademyPreflopTrainerAttempt,
} = await import("@/features/academy");

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const LESSON = ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE;

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "preflop-mix-feature-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const session = () => buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });

function mixAnswers(pick: (question: ReturnType<typeof session>[number]) => string) {
  return session().map((question, questionIndex) => ({
    questionIndex, selectedAction: pick(question), datasetId: question.spot.datasetId, nodeKey: question.spot.nodeKey, mode: "QUICK_MIX",
  }));
}

describe("Quick Mix progress identity (no new lesson code, no migration)", () => {
  it("records under the existing solver_preflop_trainer code; the catalog is unchanged", async () => {
    expect(listAllAcademyLessonCodes()).toHaveLength(14);
    expect(getAcademyLessonByCode(LESSON)?.trainerKind).toBe("PREFLOP_CONFIGURABLE_FREQUENCY");
    expect(ACADEMY_PRACTICE_TRAINER_VERIFIERS.PREFLOP_CONFIGURABLE_FREQUENCY).toBe(verifyAcademyPreflopTrainerAttempt);
    const recorded: Array<Record<string, unknown>> = [];
    const repository = {
      recordCompletedAttempt: async (input: Record<string, unknown>) => {
        recorded.push(input);
        return {
          lesson_code: input.lessonCode as string, attempts_count: 1, last_score_percent: input.scorePercent as number,
          best_score_percent: input.scorePercent as number, passed: input.passed as boolean, first_completed_at: null,
          last_attempt_at: "2026-10-11T00:00:00.000Z", is_new_attempt: true, first_pass: false, new_best: false,
        };
      },
    } as unknown as AcademyProgressRepository;
    const result = await submitAcademyTrainingAttempt(PLAYER_ID, {
      attemptId: ATTEMPT_ID, lessonCode: LESSON, questions: mixAnswers((question) => question.resolvedAction),
    }, repository);
    expect(result.result).toMatchObject({ correctAnswers: 10, percentage: 100, passed: true });
    expect(result.progress.lessonCode).toBe(LESSON);
    expect(recorded).toEqual([{ attemptId: ATTEMPT_ID, playerId: PLAYER_ID, lessonCode: LESSON, scorePercent: 100, passed: true }]);
  });
});

describe("Quick Mix serve / reveal / verify", () => {
  it("(9) serves answer-free questions whose node is server-derived", () => {
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      const question = getAcademyPreflopMixQuestion(PLAYER_ID, { attemptId: ATTEMPT_ID, questionIndex });
      expect(Object.keys(question).sort()).toEqual(["actions", "hand", "randomizerPercent", "renderedCards", "spot"]);
      expect(question.spot.nodeKey).toBe(session()[questionIndex].spot.nodeKey);
      const raw = JSON.stringify(question);
      for (const leak of ["frequencies", "resolvedAction", "bucket", "preflop-mix-feature-secret"]) expect(raw).not.toContain(leak);
    }
  });

  it("(10) reveal returns the stored frequencies + resolved action; mixed mismatch feedback stays neutral", () => {
    const all = session();
    const mixedIndex = all.findIndex((question) =>
      question.bucket === "MIXED" && question.actions.some((action) => action.code !== question.resolvedAction && question.frequencies[action.code] > 0));
    expect(mixedIndex).toBeGreaterThanOrEqual(0);
    const question = all[mixedIndex];
    const other = question.actions.map((action) => action.code)
      .find((code) => code !== question.resolvedAction && question.frequencies[code] > 0)!;
    const reveal = revealAcademyPreflopMixAnswer(PLAYER_ID, { attemptId: ATTEMPT_ID, questionIndex: mixedIndex, selectedAction: other });
    expect(reveal.frequencies).toBe(question.frequencies);
    expect(reveal.resolvedAction).toBe(question.resolvedAction);
    expect(reveal.matchesResolvedAction).toBe(false);
    const feedback = buildSolverAnswerFeedback(reveal, ACADEMY_NEUTRAL_FEEDBACK_WORDING);
    expect(feedback.tone).toBe("mixed");
    expect(feedback.detail).toContain(`Рандомайзер ${reveal.randomizerPercent}`);
    expect(`${feedback.title} ${feedback.summary} ${feedback.detail}`).not.toMatch(/ошибк|неправильн|неверн|wrong/i);
  });

  it("verifies only selectedAction against the re-derived mix; forged nodes / modes / players are rejected", () => {
    const verify = (questions: unknown[]) =>
      verifyAcademyPreflopTrainerAttempt({ attemptId: ATTEMPT_ID, lessonCode: LESSON, questions }, { playerId: PLAYER_ID });
    const resolved = mixAnswers((question) => question.resolvedAction);
    expect(verify(resolved)).toMatchObject({ correctAnswers: 10, passed: true });
    const folds = mixAnswers((question) => (question.actions.some((a) => a.code === "FOLD") ? "FOLD" : question.actions[0].code));
    expect(verify(folds).correctAnswers).toBe(session().filter((q, i) => q.resolvedAction === folds[i].selectedAction).length);
    expect(verifyAcademyAttempt(getAcademyLessonByCode(LESSON)!, { attemptId: ATTEMPT_ID, lessonCode: LESSON, questions: resolved }, { playerId: PLAYER_ID }))
      .toEqual(verify(resolved));

    const swapped = resolved.map((answer) => ({ ...answer }));
    swapped[0] = { ...swapped[0], nodeKey: resolved[1].nodeKey, datasetId: resolved[1].datasetId };
    expect(() => verify(swapped)).toThrow(AcademyValidationError);
    const mixedModes = resolved.map((answer, index) => (index === 4 ? { ...answer, mode: undefined } : answer));
    expect(() => verify(mixedModes)).toThrow(AcademyValidationError);
    const wrongMode = resolved.map((answer) => ({ ...answer, mode: "FIXED" }));
    expect(() => verify(wrongMode)).toThrow(AcademyValidationError);
    expect(() => verifyAcademyPreflopTrainerAttempt({ attemptId: ATTEMPT_ID, lessonCode: LESSON, questions: resolved }))
      .toThrow(AcademyValidationError);
    expect(() => verify(resolved.slice(0, 9))).toThrow(AcademyValidationError);
    const outOfOrder = resolved.map((answer, index) => ({ ...answer, questionIndex: 9 - index }));
    expect(() => verify(outOfOrder)).toThrow(AcademyValidationError);
  });

  it("the fixed-node path (answers without `mode`) is unchanged", () => {
    const fixed = buildAcademyPreflopTrainerSession({
      playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId: "external_mtt_preflop_9max_40bb_v1", nodeKey: "FACING_OPEN_BB_VS_BTN",
    });
    const answers = fixed.map((question, questionIndex) => ({
      questionIndex, selectedAction: question.resolvedAction, datasetId: "external_mtt_preflop_9max_40bb_v1", nodeKey: "FACING_OPEN_BB_VS_BTN",
    }));
    expect(verifyAcademyPreflopTrainerAttempt({ attemptId: ATTEMPT_ID, lessonCode: LESSON, questions: answers }, { playerId: PLAYER_ID }))
      .toMatchObject({ correctAnswers: 10, percentage: 100, passed: true });
  });
});
