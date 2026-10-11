/**
 * Part 2 / 2A — three-state, server-verified scoring for NORMAL practice
 * (configurable preflop trainer + Quick Mix), randomizer as post-answer-only
 * information, and the contrast that the 100bb HRC Solver Lab trainer keeps
 * its exact-randomizer scoring.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE } from "@/config/academy/preflop-trainer";
import { buildAcademyPreflopMixSession } from "@/lib/academy/preflop-mix";
import { buildAcademyPreflopTrainerSession, type AcademyPreflopTrainerSessionQuestion } from "@/lib/academy/preflop-trainer";
import { resolveAcademyStrategyNodeAction } from "@/lib/academy/solver";
import { buildPracticeAnswerFeedback, formatPracticeFrequencyList } from "@/lib/academy/solver-feedback";
import { buildAcademySolverSessionForLesson } from "@/lib/academy/solver-training";
import { classifyStrategyAnswer, strategyAnswerCountsAsCorrect } from "@/lib/academy/strategy-answer";
import { getAcademyStrategyDataset } from "@/config/academy/solver-datasets";

vi.mock("@/lib/repositories", () => ({ academyProgressRepository: {} }));
vi.mock("@/lib/repositories/academy-progress", () => ({ academyProgressRepository: {} }));

const {
  getAcademyPreflopMixQuestion,
  getAcademyPreflopTrainerQuestion,
  revealAcademyPreflopMixAnswer,
  revealAcademyPreflopTrainerAnswer,
  verifyAcademyPreflopTrainerAttempt,
  verifyAcademySolverAttempt,
} = await import("@/features/academy");

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const LESSON = ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE;
const DATASET_40 = "external_mtt_preflop_9max_40bb_v1";
const NODE = "FACING_OPEN_BB_VS_BTN";

beforeEach(() => vi.stubEnv("SESSION_SECRET", "practice-scoring-secret"));
afterEach(() => vi.unstubAllEnvs());

const fixedSession = () => buildAcademyPreflopTrainerSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId: DATASET_40, nodeKey: NODE });
const playedOther = (q: AcademyPreflopTrainerSessionQuestion) =>
  q.actions.map((a) => a.code).find((code) => code !== q.resolvedAction && (q.frequencies[code] ?? 0) > 0);
const zeroAction = (q: AcademyPreflopTrainerSessionQuestion) => q.actions.map((a) => a.code).find((code) => (q.frequencies[code] ?? 0) === 0);
const fixedAnswers = (choose: (q: AcademyPreflopTrainerSessionQuestion) => string) =>
  fixedSession().map((q, questionIndex) => ({ questionIndex, selectedAction: choose(q), datasetId: DATASET_40, nodeKey: NODE }));
const verifyFixed = (questions: unknown[]) =>
  verifyAcademyPreflopTrainerAttempt({ attemptId: ATTEMPT_ID, lessonCode: LESSON, questions }, { playerId: PLAYER_ID });

describe("classifyStrategyAnswer (pure)", () => {
  const f = { RAISE: 0.77, CALL: 0.23, FOLD: 0 };
  it("A/B/C: 0% → NOT_IN_STRATEGY; > 0% ≠ resolved → VALID_MIXED; = resolved → RESOLVED_MATCH", () => {
    expect(classifyStrategyAnswer({ frequencies: f, selectedAction: "FOLD", resolvedAction: "CALL" })).toBe("NOT_IN_STRATEGY");
    expect(classifyStrategyAnswer({ frequencies: f, selectedAction: "RAISE", resolvedAction: "CALL" })).toBe("VALID_MIXED");
    expect(classifyStrategyAnswer({ frequencies: f, selectedAction: "CALL", resolvedAction: "CALL" })).toBe("RESOLVED_MATCH");
    expect(classifyStrategyAnswer({ frequencies: f, selectedAction: "LIMP", resolvedAction: "CALL" })).toBe("NOT_IN_STRATEGY");
    expect(strategyAnswerCountsAsCorrect("VALID_MIXED")).toBe(true);
    expect(strategyAnswerCountsAsCorrect("RESOLVED_MATCH")).toBe(true);
    expect(strategyAnswerCountsAsCorrect("NOT_IN_STRATEGY")).toBe(false);
  });
});

describe("normal preflop trainer verifier (server-side)", () => {
  it("(5) a selected action with frequency > 0 that differs from the resolved action counts as CORRECT", () => {
    const session = fixedSession();
    const mixed = session.filter((q) => playedOther(q) !== undefined);
    expect(mixed.length).toBeGreaterThan(0);
    const result = verifyFixed(fixedAnswers((q) => playedOther(q) ?? q.resolvedAction));
    expect(result).toMatchObject({ correctAnswers: 10, percentage: 100, passed: true });
  });

  it("(6) a selected action with frequency == 0 counts as INCORRECT", () => {
    const session = fixedSession();
    const withZero = session.filter((q) => zeroAction(q) !== undefined).length;
    expect(withZero).toBeGreaterThan(0);
    const result = verifyFixed(fixedAnswers((q) => zeroAction(q) ?? q.resolvedAction));
    expect(result.correctAnswers).toBe(10 - withZero);
  });

  it("Quick Mix uses the same rule: every played action counts, a 0% action does not", () => {
    const mix = buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
    const answer = (choose: (q: AcademyPreflopTrainerSessionQuestion) => string) => mix.map((q, questionIndex) => ({
      questionIndex, selectedAction: choose(q), datasetId: q.spot.datasetId, nodeKey: q.spot.nodeKey, mode: "QUICK_MIX",
    }));
    const verify = (questions: unknown[]) => verifyAcademyPreflopTrainerAttempt({ attemptId: ATTEMPT_ID, lessonCode: LESSON, questions }, { playerId: PLAYER_ID });
    expect(verify(answer((q) => playedOther(q) ?? q.resolvedAction)).correctAnswers).toBe(10);
    const zeros = mix.filter((q) => zeroAction(q) !== undefined).length;
    expect(verify(answer((q) => zeroAction(q) ?? q.resolvedAction)).correctAnswers).toBe(10 - zeros);
  });

  it("the client cannot inject a 'valid' flag: only selectedAction is read", () => {
    const answers = fixedAnswers((q) => zeroAction(q) ?? q.resolvedAction)
      .map((answer) => ({ ...answer, countsAsCorrect: true, outcome: "VALID_MIXED", correct: true }));
    const zeros = fixedSession().filter((q) => zeroAction(q) !== undefined).length;
    expect(verifyFixed(answers).correctAnswers).toBe(10 - zeros);
  });
});

describe("(10) HRC 100bb Solver Lab keeps exact-randomizer scoring (unchanged)", () => {
  it("a mixed-hand action other than the resolved one is NOT counted there", () => {
    const lessonCode = "solver_rfi_9max_100bb_hj";
    const session = buildAcademySolverSessionForLesson({ playerId: PLAYER_ID, lessonCode, attemptId: ATTEMPT_ID });
    const answers = session.map((q, questionIndex) => {
      const other = q.actions.map((a) => a.code).find((code) => code !== q.resolvedAction && (q.frequencies[code] ?? 0) > 0);
      return { questionIndex, selectedAction: other ?? q.resolvedAction };
    });
    const validMixed = answers.filter((answer, index) => answer.selectedAction !== session[index].resolvedAction).length;
    expect(validMixed).toBeGreaterThan(0);
    expect(verifyAcademySolverAttempt({ attemptId: ATTEMPT_ID, lessonCode, questions: answers }, { playerId: PLAYER_ID }).correctAnswers)
      .toBe(10 - validMixed);
  });
});

describe("(8)(9) randomizer: absent before answering, explained after", () => {
  it("(8) the public pre-answer payload (fixed + Quick) has no randomizer", () => {
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      for (const question of [
        getAcademyPreflopTrainerQuestion(PLAYER_ID, { datasetId: DATASET_40, nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex }),
        getAcademyPreflopMixQuestion(PLAYER_ID, { attemptId: ATTEMPT_ID, questionIndex }),
      ]) {
        expect(question).not.toHaveProperty("randomizerPercent");
        expect(JSON.stringify(question)).not.toMatch(/randomizer|resolvedAction|frequenc/);
      }
    }
  });

  it("(9) the reveal carries the server randomizer, consistent with the resolved action, plus the outcome", () => {
    const dataset = getAcademyStrategyDataset(DATASET_40);
    fixedSession().forEach((q, questionIndex) => {
      const choice = playedOther(q) ?? q.resolvedAction;
      const reveal = revealAcademyPreflopTrainerAnswer(PLAYER_ID, { datasetId: DATASET_40, nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex, selectedAction: choice });
      expect(reveal.randomizerPercent).toBe(q.randomizerPercent);
      expect(Number.isInteger(reveal.randomizerPercent) && reveal.randomizerPercent >= 0 && reveal.randomizerPercent < 100).toBe(true);
      expect(reveal.resolvedAction).toBe(resolveAcademyStrategyNodeAction(dataset.nodes[NODE], reveal.hand, reveal.randomizerPercent));
      expect(reveal.outcome).toBe(choice === q.resolvedAction ? "RESOLVED_MATCH" : "VALID_MIXED");
      expect(reveal.countsAsCorrect).toBe(true);
    });
    const mix = buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
    const zeroIndex = mix.findIndex((q) => zeroAction(q) !== undefined);
    expect(zeroIndex).toBeGreaterThanOrEqual(0);
    const wrong = revealAcademyPreflopMixAnswer(PLAYER_ID, { attemptId: ATTEMPT_ID, questionIndex: zeroIndex, selectedAction: zeroAction(mix[zeroIndex])! });
    expect(wrong).toMatchObject({ outcome: "NOT_IN_STRATEGY", countsAsCorrect: false, randomizerPercent: mix[zeroIndex].randomizerPercent });
  });
});

describe("plain-Russian practice feedback", () => {
  const actions = [
    { code: "RAISE", label: "Raise", ru: { button: "3-бет", inline: "3-бет", short: "3-бет", always: "всегда делаем 3-бет" } },
    { code: "CALL", label: "Call", ru: { button: "Колл", inline: "колл", short: "колл", always: "всегда коллируем" } },
    { code: "FOLD", label: "Fold", ru: { button: "Фолд", inline: "фолд", short: "фолд", always: "всегда сбрасываем" } },
  ];
  const frequencies = { RAISE: 0.77, CALL: 0.23, FOLD: 0 };
  const forbidden = /ошибк|неправильн|неверн|wrong/i;

  it("valid mixed: frequencies first, verdict 'входит в стратегию', randomizer as a secondary note (spec example)", () => {
    const feedback = buildPracticeAnswerFeedback({
      hand: "AJs", frequencies, randomizerPercent: 85, resolvedAction: "CALL", selectedAction: "RAISE", outcome: "VALID_MIXED", actions,
    });
    expect(feedback).toMatchObject({
      tone: "valid",
      title: "Допустимое решение",
      summary: "3-бет — 77%, колл — 23%. Твой 3-бет входит в стратегию.",
      randomizerNote: "По рандомайзеру в этой раздаче выпал колл.",
    });
    expect(`${feedback.title} ${feedback.summary} ${feedback.randomizerNote}`).not.toMatch(forbidden);
    expect(feedback.detail).toContain("85");
  });

  it("resolved match and 0% choice", () => {
    expect(buildPracticeAnswerFeedback({
      hand: "AJs", frequencies, randomizerPercent: 10, resolvedAction: "RAISE", selectedAction: "RAISE", outcome: "RESOLVED_MATCH", actions,
    })).toMatchObject({ tone: "correct", title: "Верно", randomizerNote: "По рандомайзеру в этой раздаче тоже выпал 3-бет." });
    const wrong = buildPracticeAnswerFeedback({
      hand: "AJs", frequencies, randomizerPercent: 10, resolvedAction: "RAISE", selectedAction: "FOLD", outcome: "NOT_IN_STRATEGY", actions,
    });
    expect(wrong).toMatchObject({ tone: "incorrect", title: "Не входит в стратегию", randomizerNote: null });
    expect(wrong.summary).toBe("3-бет — 77%, колл — 23%. Фолд с этой рукой здесь не играют.");
    expect(formatPracticeFrequencyList({ RAISE: 0.004, CALL: 0.996, FOLD: 0 }, actions)).toBe("Колл — >99%, 3-бет — <1%");
  });

  it("pure hands: one short line, no randomizer", () => {
    const pure = buildPracticeAnswerFeedback({
      hand: "AA", frequencies: { RAISE: 1, CALL: 0, FOLD: 0 }, randomizerPercent: 50, resolvedAction: "RAISE", selectedAction: "RAISE", outcome: "RESOLVED_MATCH", actions,
    });
    expect(pure).toMatchObject({ tone: "correct", title: "Верно", summary: "С AA здесь всегда делаем 3-бет.", randomizerNote: null });
  });
});
