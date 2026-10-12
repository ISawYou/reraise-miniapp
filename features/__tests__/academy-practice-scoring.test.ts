/**
 * Weighted, server-verified scoring for NORMAL practice (configurable preflop
 * trainer + Quick Mix; the dormant scored Push/Fold path shares it):
 *   primary (highest-frequency) action = 1, other supported action = 0.5,
 *   0% / missing / non-finite = 0 — counted in integer half-point units.
 * The randomizer is post-answer information only and never decides points.
 * The 100bb HRC Solver Lab trainer keeps its exact-randomizer scoring and the
 * old basic trainer keeps `scoreTrainingSession` (contrast tests below).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACADEMY_PASS_THRESHOLD } from "@/config/academy/training";
import { ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE } from "@/config/academy/preflop-trainer";
import { buildAcademyPreflopMixSession } from "@/lib/academy/preflop-mix";
import { buildAcademyPreflopTrainerSession, type AcademyPreflopTrainerSessionQuestion } from "@/lib/academy/preflop-trainer";
import { resolveAcademyStrategyNodeAction } from "@/lib/academy/solver";
import { buildPracticeAnswerFeedback, formatPracticeFrequencyList } from "@/lib/academy/solver-feedback";
import { buildAcademySolverSessionForLesson } from "@/lib/academy/solver-training";
import {
  ACADEMY_STRATEGY_ANSWER_UNITS,
  classifyStrategyAnswer,
  primaryStrategyActions,
  scoreWeightedPracticeSession,
  strategyAnswerCountsAsCorrect,
  strategyAnswerIsMistake,
  strategyAnswerPoints,
  type AcademyStrategyAnswerOutcome,
} from "@/lib/academy/strategy-answer";
import { scoreTrainingSession } from "@/lib/academy/training";
import { getAcademyStrategyDataset } from "@/config/academy/solver-datasets";

vi.mock("@/lib/repositories", () => ({ academyProgressRepository: {} }));
vi.mock("@/lib/repositories/academy-progress", () => ({ academyProgressRepository: {} }));

const {
  getAcademyPreflopMixQuestion,
  getAcademyPreflopTrainerQuestion,
  revealAcademyPreflopMixAnswer,
  revealAcademyPreflopTrainerAnswer,
  submitAcademyTrainingAttempt,
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

type Q = AcademyPreflopTrainerSessionQuestion;
const codes = (q: Q) => q.actions.map((a) => a.code);
const freq = (q: Q, code: string) => q.frequencies[code] ?? 0;
/** Independent oracle (not the module under test): highest frequency of the hand. */
const maxFreq = (q: Q) => Math.max(...codes(q).map((code) => freq(q, code)));
const primaryOf = (q: Q) => codes(q).find((code) => freq(q, code) > 0 && freq(q, code) === maxFreq(q))!;
const alternativeOf = (q: Q) => codes(q).find((code) => freq(q, code) > 0 && freq(q, code) < maxFreq(q));
const zeroOf = (q: Q) => codes(q).find((code) => freq(q, code) === 0);
const oracleUnits = (q: Q, code: string) => (freq(q, code) === 0 ? 0 : freq(q, code) === maxFreq(q) ? 2 : 1);

const fixedSession = (attemptId = ATTEMPT_ID) =>
  buildAcademyPreflopTrainerSession({ playerId: PLAYER_ID, attemptId, datasetId: DATASET_40, nodeKey: NODE });
const mixSession = (attemptId = ATTEMPT_ID) => buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId });
const fixedAnswers = (session: readonly Q[], choose: (q: Q) => string) =>
  session.map((q, questionIndex) => ({ questionIndex, selectedAction: choose(q), datasetId: DATASET_40, nodeKey: NODE }));
const mixAnswers = (session: readonly Q[], choose: (q: Q) => string) => session.map((q, questionIndex) => ({
  questionIndex, selectedAction: choose(q), datasetId: q.spot.datasetId, nodeKey: q.spot.nodeKey, mode: "QUICK_MIX",
}));
const verify = (questions: unknown[], attemptId = ATTEMPT_ID) =>
  verifyAcademyPreflopTrainerAttempt({ attemptId, lessonCode: LESSON, questions }, { playerId: PLAYER_ID });

describe("classifyStrategyAnswer — weighted, frequency-only (pure)", () => {
  const units = (frequencies: Record<string, number>, selectedAction: string) =>
    ACADEMY_STRATEGY_ANSWER_UNITS[classifyStrategyAnswer({ frequencies, selectedAction })];

  it("95/5: the 95% action scores 1, the 5% action 0.5, a 0% action 0", () => {
    const f = { FOLD: 0.95, CALL: 0.05, RAISE: 0 };
    expect(classifyStrategyAnswer({ frequencies: f, selectedAction: "FOLD" })).toBe("PRIMARY");
    expect(strategyAnswerPoints(classifyStrategyAnswer({ frequencies: f, selectedAction: "FOLD" }))).toBe(1);
    expect(classifyStrategyAnswer({ frequencies: f, selectedAction: "CALL" })).toBe("SUPPORTED_ALTERNATIVE");
    expect(strategyAnswerPoints(classifyStrategyAnswer({ frequencies: f, selectedAction: "CALL" }))).toBe(0.5);
    expect(classifyStrategyAnswer({ frequencies: f, selectedAction: "RAISE" })).toBe("NOT_IN_STRATEGY");
    expect(strategyAnswerPoints(classifyStrategyAnswer({ frequencies: f, selectedAction: "RAISE" }))).toBe(0);
  });

  it("77/23 and 55/45: primary 1, the other 0.5", () => {
    expect([units({ RAISE: 0.77, CALL: 0.23 }, "RAISE"), units({ RAISE: 0.77, CALL: 0.23 }, "CALL")]).toEqual([2, 1]);
    expect([units({ RAISE: 0.55, CALL: 0.45 }, "RAISE"), units({ RAISE: 0.55, CALL: 0.45 }, "CALL")]).toEqual([2, 1]);
  });

  it("50/50 tie: BOTH tied actions are primary (1 point each), either order", () => {
    const f = { RAISE: 0.5, CALL: 0.5, FOLD: 0 };
    expect(classifyStrategyAnswer({ frequencies: f, selectedAction: "RAISE" })).toBe("PRIMARY");
    expect(classifyStrategyAnswer({ frequencies: f, selectedAction: "CALL" })).toBe("PRIMARY");
    expect(classifyStrategyAnswer({ frequencies: { CALL: 0.5, RAISE: 0.5 }, selectedAction: "RAISE" })).toBe("PRIMARY");
    expect(primaryStrategyActions(f)).toEqual(["RAISE", "CALL"]);
    // Float noise from decimal fractions still counts as a tie.
    expect(units({ RAISE: 0.1 + 0.2, CALL: 0.3, FOLD: 0.4 }, "FOLD")).toBe(2);
    expect(units({ RAISE: 0.35000000000000003, CALL: 0.35, FOLD: 0.3 }, "CALL")).toBe(2);
  });

  it("33/33/34: the 34% action scores 1, either 33% action 0.5", () => {
    const f = { RAISE: 0.33, CALL: 0.33, FOLD: 0.34 };
    expect(units(f, "FOLD")).toBe(2);
    expect(units(f, "RAISE")).toBe(1);
    expect(units(f, "CALL")).toBe(1);
    expect(primaryStrategyActions(f)).toEqual(["FOLD"]);
  });

  it("a missing action entry scores 0 (incl. prototype keys)", () => {
    const f = { RAISE: 0.6, CALL: 0.4 };
    expect(classifyStrategyAnswer({ frequencies: f, selectedAction: "FOLD" })).toBe("NOT_IN_STRATEGY");
    expect(classifyStrategyAnswer({ frequencies: f, selectedAction: "toString" })).toBe("NOT_IN_STRATEGY");
    expect(classifyStrategyAnswer({ frequencies: f, selectedAction: "__proto__" })).toBe("NOT_IN_STRATEGY");
  });

  it("non-finite / negative frequencies fail closed to 0 and never crash or poison the primary", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.2]) {
      const f = { RAISE: bad, CALL: 0.3, FOLD: 0.1 };
      expect(() => classifyStrategyAnswer({ frequencies: f, selectedAction: "RAISE" })).not.toThrow();
      expect(classifyStrategyAnswer({ frequencies: f, selectedAction: "RAISE" })).toBe("NOT_IN_STRATEGY");
      // The bad entry is ignored when finding the primary action.
      expect(classifyStrategyAnswer({ frequencies: f, selectedAction: "CALL" })).toBe("PRIMARY");
      expect(classifyStrategyAnswer({ frequencies: f, selectedAction: "FOLD" })).toBe("SUPPORTED_ALTERNATIVE");
    }
    expect(primaryStrategyActions({ RAISE: Number.NaN })).toEqual([]);
    expect(classifyStrategyAnswer({ frequencies: { RAISE: Number.NaN }, selectedAction: "RAISE" })).toBe("NOT_IN_STRATEGY");
  });

  it("the classifier has no randomizer input at all (signature) — extra fields are ignored", () => {
    const f = { FOLD: 0.95, CALL: 0.05 };
    const withRandomizer = { frequencies: f, selectedAction: "CALL", resolvedAction: "CALL", randomizerPercent: 99 };
    expect(classifyStrategyAnswer(withRandomizer as Parameters<typeof classifyStrategyAnswer>[0])).toBe("SUPPORTED_ALTERNATIVE");
  });

  it("outcome helpers: points, counts-as-correct, and only 0-point answers are mistakes", () => {
    expect(["PRIMARY", "SUPPORTED_ALTERNATIVE", "NOT_IN_STRATEGY"].map((o) => strategyAnswerPoints(o as AcademyStrategyAnswerOutcome))).toEqual([1, 0.5, 0]);
    expect(strategyAnswerCountsAsCorrect("SUPPORTED_ALTERNATIVE")).toBe(true);
    expect(strategyAnswerCountsAsCorrect("NOT_IN_STRATEGY")).toBe(false);
    expect(strategyAnswerIsMistake("SUPPORTED_ALTERNATIVE")).toBe(false);
    expect(strategyAnswerIsMistake("PRIMARY")).toBe(false);
    expect(strategyAnswerIsMistake("NOT_IN_STRATEGY")).toBe(true);
  });
});

describe("scoreWeightedPracticeSession — half-point units, no migration", () => {
  const session = (primary: number, alternative: number, wrong: number) => [
    ...Array<AcademyStrategyAnswerOutcome>(primary).fill("PRIMARY"),
    ...Array<AcademyStrategyAnswerOutcome>(alternative).fill("SUPPORTED_ALTERNATIVE"),
    ...Array<AcademyStrategyAnswerOutcome>(wrong).fill("NOT_IN_STRATEGY"),
  ];

  it("8 primary + 1 alternative + 1 wrong → 17 units, 8.5 / 10, exactly 85%", () => {
    expect(scoreWeightedPracticeSession(session(8, 1, 1), 10)).toEqual({
      correctAnswers: 8,
      totalQuestions: 10,
      percentage: 85,
      passed: true,
      feedback: "Пройдено",
      scoring: "WEIGHTED_HALF_POINTS",
      scoreUnits: 17,
      maxScoreUnits: 20,
      scorePoints: 8.5,
      primaryAnswers: 8,
      supportedAlternativeAnswers: 1,
      notInStrategyAnswers: 1,
    });
  });

  it("EVERY possible 10-question mix yields an integer percentage that is a multiple of 5 (= 5 × units)", () => {
    let combos = 0;
    for (let primary = 0; primary <= 10; primary += 1) {
      for (let alternative = 0; primary + alternative <= 10; alternative += 1) {
        const result = scoreWeightedPracticeSession(session(primary, alternative, 10 - primary - alternative), 10);
        const units = 2 * primary + alternative;
        expect(result.scoreUnits).toBe(units);
        expect(result.scorePoints).toBe(units / 2);
        expect(Number.isInteger(result.percentage)).toBe(true);
        expect(result.percentage % 5).toBe(0);
        expect(result.percentage).toBe(5 * units);
        expect(result.passed).toBe(result.percentage >= 80);
        combos += 1;
      }
    }
    expect(combos).toBe(66);
  });

  it("pass threshold unchanged (0.8) and applied to the weighted percentage: 8.0 → 80% passes, 7.5 → 75% fails", () => {
    expect(ACADEMY_PASS_THRESHOLD).toBe(0.8);
    expect(scoreWeightedPracticeSession(session(8, 0, 2), 10)).toMatchObject({ scorePoints: 8, percentage: 80, passed: true });
    expect(scoreWeightedPracticeSession(session(6, 4, 0), 10)).toMatchObject({ scorePoints: 8, percentage: 80, passed: true });
    expect(scoreWeightedPracticeSession(session(7, 1, 2), 10)).toMatchObject({ scorePoints: 7.5, percentage: 75, passed: false });
    // Ten supported alternatives = 5 / 10: never a pass, never zero.
    expect(scoreWeightedPracticeSession(session(0, 10, 0), 10)).toMatchObject({ scorePoints: 5, percentage: 50, passed: false });
    expect(scoreWeightedPracticeSession(session(9, 0, 1), 10).feedback).toBe("Отлично");
  });

  it("rejects malformed input instead of guessing", () => {
    expect(() => scoreWeightedPracticeSession(session(8, 1, 0), 10)).toThrow();
    expect(() => scoreWeightedPracticeSession(["NOPE" as AcademyStrategyAnswerOutcome], 1)).toThrow();
  });

  it("the shared binary scorer (old basic trainer / HRC) is untouched: integer correct counts only", () => {
    expect(scoreTrainingSession(8, 10)).toEqual({ correctAnswers: 8, totalQuestions: 10, percentage: 80, passed: true, feedback: "Пройдено" });
    expect(() => scoreTrainingSession(8.5, 10)).toThrow("Training score values must be integers");
  });
});

describe("server verifiers — fixed node and Quick Mix share ONE weighted rule", () => {
  it("fixed node: all primary → 10 / 10; all supported alternatives score 0.5 each; all 0% score 0", () => {
    const session = fixedSession();
    expect(verify(fixedAnswers(session, primaryOf))).toMatchObject({ scoreUnits: 20, scorePoints: 10, percentage: 100, passed: true });

    const withAlternative = session.filter((q) => alternativeOf(q) !== undefined).length;
    expect(withAlternative).toBeGreaterThan(0);
    const alt = verify(fixedAnswers(session, (q) => alternativeOf(q) ?? primaryOf(q)));
    expect(alt).toMatchObject({ supportedAlternativeAnswers: withAlternative, primaryAnswers: 10 - withAlternative, scoreUnits: 20 - withAlternative });

    const withZero = session.filter((q) => zeroOf(q) !== undefined).length;
    expect(withZero).toBeGreaterThan(0);
    const zero = verify(fixedAnswers(session, (q) => zeroOf(q) ?? primaryOf(q)));
    expect(zero).toMatchObject({ notInStrategyAnswers: withZero, scoreUnits: 2 * (10 - withZero) });
  });

  it("a known 8 / 1 / 1 mix on a real Quick Mix session → exactly 8.5 / 10 and 85% from the verifier", () => {
    let found: { attemptId: string; session: readonly Q[]; altIndex: number; zeroIndex: number } | null = null;
    for (let n = 0; n < 50 && !found; n += 1) {
      const attemptId = `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
      const session = mixSession(attemptId);
      const altIndex = session.findIndex((q) => alternativeOf(q) !== undefined);
      const zeroIndex = session.findIndex((q, i) => i !== altIndex && zeroOf(q) !== undefined);
      if (altIndex >= 0 && zeroIndex >= 0) found = { attemptId, session, altIndex, zeroIndex };
    }
    expect(found).not.toBeNull();
    const { attemptId, session, altIndex, zeroIndex } = found!;
    const choices = session.map((q, i) => (i === altIndex ? alternativeOf(q)! : i === zeroIndex ? zeroOf(q)! : primaryOf(q)));
    expect(choices.reduce((sum, code, i) => sum + oracleUnits(session[i], code), 0)).toBe(17);
    expect(verify(mixAnswers(session, (q) => choices[q.questionIndex]), attemptId)).toEqual({
      correctAnswers: 8, totalQuestions: 10, percentage: 85, passed: true, feedback: "Пройдено",
      scoring: "WEIGHTED_HALF_POINTS", scoreUnits: 17, maxScoreUnits: 20, scorePoints: 8.5,
      primaryAnswers: 8, supportedAlternativeAnswers: 1, notInStrategyAnswers: 1,
    });
  });

  it("fixed node and Quick Mix score every answer with the same oracle-matching rule", () => {
    const fixed = fixedSession();
    const mix = mixSession();
    for (const [session, answers] of [
      [fixed, fixedAnswers(fixed, (q) => alternativeOf(q) ?? zeroOf(q) ?? primaryOf(q))],
      [mix, mixAnswers(mix, (q) => alternativeOf(q) ?? zeroOf(q) ?? primaryOf(q))],
    ] as const) {
      const expectedUnits = answers.reduce((sum, answer, i) => sum + oracleUnits(session[i], answer.selectedAction), 0);
      expect(verify([...answers]).scoreUnits).toBe(expectedUnits);
    }
  });

  it("the randomizer never decides points: answers matching a NON-primary resolved action score 0.5, the primary scores 1", () => {
    const sessions = [fixedSession(), ...Array.from({ length: 20 }, (_, n) => mixSession(`22222222-2222-4222-8222-${String(n).padStart(12, "0")}`))];
    let checked = 0;
    for (const session of sessions) {
      for (const q of session) {
        if (freq(q, q.resolvedAction) >= maxFreq(q)) continue; // randomizer rolled a non-primary action
        checked += 1;
        const reveal = q.spot.nodeKey === NODE && q.spot.datasetId === DATASET_40 && session === sessions[0]
          ? revealAcademyPreflopTrainerAnswer(PLAYER_ID, { datasetId: DATASET_40, nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex: q.questionIndex, selectedAction: q.resolvedAction })
          : null;
        expect(classifyStrategyAnswer({ frequencies: q.frequencies, selectedAction: q.resolvedAction })).toBe("SUPPORTED_ALTERNATIVE");
        expect(classifyStrategyAnswer({ frequencies: q.frequencies, selectedAction: primaryOf(q) })).toBe("PRIMARY");
        if (reveal) expect(reveal).toMatchObject({ matchesResolvedAction: true, outcome: "SUPPORTED_ALTERNATIVE", points: 0.5 });
      }
    }
    expect(checked).toBeGreaterThan(0);
    // Whole-session proof through the verifier: always following the randomizer
    // is NOT a perfect score whenever it rolled a non-primary action.
    const session = sessions.slice(1).find((s) => s.some((q) => freq(q, q.resolvedAction) < maxFreq(q)))!;
    const attemptId = `22222222-2222-4222-8222-${String(sessions.indexOf(session) - 1).padStart(12, "0")}`;
    const nonPrimary = session.filter((q) => freq(q, q.resolvedAction) < maxFreq(q)).length;
    const followRandomizer = verify(mixAnswers(session, (q) => q.resolvedAction), attemptId);
    expect(followRandomizer.scoreUnits).toBe(20 - nonPrimary);
    expect(followRandomizer.supportedAlternativeAnswers).toBe(nonPrimary);
    expect(verify(mixAnswers(session, primaryOf), attemptId).scoreUnits).toBe(20);
  });

  it("persistence: a weighted 8.5 / 10 attempt is stored as the existing integer score_percent (85), no new fields", async () => {
    let found: { attemptId: string; session: readonly Q[]; altIndex: number; zeroIndex: number } | null = null;
    for (let n = 0; n < 50 && !found; n += 1) {
      const attemptId = `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
      const session = mixSession(attemptId);
      const altIndex = session.findIndex((q) => alternativeOf(q) !== undefined);
      const zeroIndex = session.findIndex((q, i) => i !== altIndex && zeroOf(q) !== undefined);
      if (altIndex >= 0 && zeroIndex >= 0) found = { attemptId, session, altIndex, zeroIndex };
    }
    const { attemptId, session, altIndex, zeroIndex } = found!;
    const recorded: Array<Record<string, unknown>> = [];
    const repository = {
      recordCompletedAttempt: async (row: Record<string, unknown>) => {
        recorded.push(row);
        return {
          lesson_code: row.lessonCode, attempts_count: 1, last_score_percent: row.scorePercent, best_score_percent: row.scorePercent,
          passed: row.passed, first_completed_at: null, last_attempt_at: "2026-10-12T00:00:00.000Z", is_new_attempt: true, first_pass: true, new_best: true,
        };
      },
    } as unknown as Parameters<typeof submitAcademyTrainingAttempt>[2];
    const questions = mixAnswers(session, (q) => (q.questionIndex === altIndex ? alternativeOf(q)! : q.questionIndex === zeroIndex ? zeroOf(q)! : primaryOf(q)));
    const submitted = await submitAcademyTrainingAttempt(PLAYER_ID, { attemptId, lessonCode: LESSON, questions }, repository);
    expect(submitted.result).toMatchObject({ scorePoints: 8.5, percentage: 85, passed: true });
    expect(recorded).toEqual([{ attemptId, playerId: PLAYER_ID, lessonCode: LESSON, scorePercent: 85, passed: true }]);
    expect(Number.isInteger(recorded[0].scorePercent)).toBe(true);
  });

  it("the client cannot inject outcome / points / correctness: only selectedAction is read", () => {
    const session = fixedSession();
    const answers = fixedAnswers(session, (q) => zeroOf(q) ?? primaryOf(q))
      .map((answer) => ({ ...answer, countsAsCorrect: true, outcome: "PRIMARY", points: 1, correct: true }));
    const zeros = session.filter((q) => zeroOf(q) !== undefined).length;
    expect(verify(answers)).toMatchObject({ notInStrategyAnswers: zeros, scoreUnits: 2 * (10 - zeros) });
  });
});

describe("(10) HRC 100bb Solver Lab keeps exact-randomizer scoring (unchanged)", () => {
  it("a mixed-hand action other than the resolved one is NOT counted there, and the result is the binary shape", () => {
    const lessonCode = "solver_rfi_9max_100bb_hj";
    const session = buildAcademySolverSessionForLesson({ playerId: PLAYER_ID, lessonCode, attemptId: ATTEMPT_ID });
    const answers = session.map((q, questionIndex) => {
      const other = q.actions.map((a) => a.code).find((code) => code !== q.resolvedAction && (q.frequencies[code] ?? 0) > 0);
      return { questionIndex, selectedAction: other ?? q.resolvedAction };
    });
    const validMixed = answers.filter((answer, index) => answer.selectedAction !== session[index].resolvedAction).length;
    expect(validMixed).toBeGreaterThan(0);
    const result = verifyAcademySolverAttempt({ attemptId: ATTEMPT_ID, lessonCode, questions: answers }, { playerId: PLAYER_ID });
    expect(result.correctAnswers).toBe(10 - validMixed);
    expect(result).not.toHaveProperty("scoring");
    expect(result).not.toHaveProperty("scorePoints");
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
        expect(JSON.stringify(question)).not.toMatch(/randomizer|resolvedAction|frequenc|primaryActions|points/);
      }
    }
  });

  it("(9) the reveal carries the server randomizer (explanation) plus the frequency-based outcome / points / primary actions", () => {
    const dataset = getAcademyStrategyDataset(DATASET_40);
    fixedSession().forEach((q, questionIndex) => {
      const choice = alternativeOf(q) ?? primaryOf(q);
      const reveal = revealAcademyPreflopTrainerAnswer(PLAYER_ID, { datasetId: DATASET_40, nodeKey: NODE, attemptId: ATTEMPT_ID, questionIndex, selectedAction: choice });
      expect(reveal.randomizerPercent).toBe(q.randomizerPercent);
      expect(Number.isInteger(reveal.randomizerPercent) && reveal.randomizerPercent >= 0 && reveal.randomizerPercent < 100).toBe(true);
      expect(reveal.resolvedAction).toBe(resolveAcademyStrategyNodeAction(dataset.nodes[NODE], reveal.hand, reveal.randomizerPercent));
      expect(reveal.outcome).toBe(oracleUnits(q, choice) === 2 ? "PRIMARY" : "SUPPORTED_ALTERNATIVE");
      expect(reveal.points).toBe(oracleUnits(q, choice) / 2);
      expect(reveal.primaryActions).toContain(primaryOf(q));
      expect(reveal.countsAsCorrect).toBe(true);
    });
    const mix = mixSession();
    const zeroIndex = mix.findIndex((q) => zeroOf(q) !== undefined);
    expect(zeroIndex).toBeGreaterThanOrEqual(0);
    const wrong = revealAcademyPreflopMixAnswer(PLAYER_ID, { attemptId: ATTEMPT_ID, questionIndex: zeroIndex, selectedAction: zeroOf(mix[zeroIndex])! });
    expect(wrong).toMatchObject({ outcome: "NOT_IN_STRATEGY", points: 0, countsAsCorrect: false, randomizerPercent: mix[zeroIndex].randomizerPercent });
  });
});

describe("plain-Russian weighted practice feedback", () => {
  const actions = [
    { code: "RAISE", label: "Raise", ru: { button: "3-бет", inline: "3-бет", short: "3-бет", always: "всегда делаем 3-бет" } },
    { code: "CALL", label: "Call", ru: { button: "Колл", inline: "колл", short: "колл", always: "всегда коллируем" } },
    { code: "FOLD", label: "Fold", ru: { button: "Фолд", inline: "фолд", short: "фолд", always: "всегда сбрасываем" } },
  ];
  const forbidden = /ошибк|неправильн|неверн|wrong/i;
  const fb = (frequencies: Record<string, number>, selectedAction: string, resolvedAction = selectedAction) => {
    const outcome = classifyStrategyAnswer({ frequencies, selectedAction });
    return buildPracticeAnswerFeedback({
      hand: "AJs", frequencies, randomizerPercent: 85, resolvedAction, selectedAction, outcome, primaryActions: primaryStrategyActions(frequencies), actions,
    });
  };

  it("95/5, pick the 5% action: 'Допустимое решение', the primary 95% named, randomizer only as a note (spec example)", () => {
    const feedback = fb({ FOLD: 0.95, CALL: 0.05, RAISE: 0 }, "CALL", "CALL");
    expect(feedback).toMatchObject({
      tone: "valid",
      title: "Допустимое решение",
      summary: "Колл встречается в стратегии в 5% случаев. Основное решение здесь — фолд (95%).",
      randomizerNote: "По рандомайзеру в этой раздаче выпал колл.",
    });
    expect(`${feedback.title} ${feedback.summary} ${feedback.randomizerNote}`).not.toMatch(forbidden);
    expect(feedback.detail).toContain("85");
    expect(feedback.detail).toContain("на очки не влияет");
  });

  it("95/5, pick the 95% action: 'Верно' even when the randomizer rolled the 5% action", () => {
    expect(fb({ FOLD: 0.95, CALL: 0.05, RAISE: 0 }, "FOLD", "CALL")).toMatchObject({
      tone: "correct",
      title: "Верно",
      summary: "Фолд — основное решение здесь: 95%.",
      randomizerNote: "По рандомайзеру в этой раздаче выпал колл.",
    });
  });

  it("ties: 'одно из основных решений'; an alternative names all tied primaries", () => {
    expect(fb({ RAISE: 0.5, CALL: 0.5, FOLD: 0 }, "CALL").summary).toBe("Колл — одно из основных решений здесь: 50%.");
    expect(fb({ RAISE: 0.4, CALL: 0.4, FOLD: 0.2 }, "FOLD").summary)
      .toBe("Фолд встречается в стратегии в 20% случаев. Основные решения здесь — 3-бет и колл (по 40%).");
  });

  it("0% choice: 'Не входит в стратегию', no randomizer note", () => {
    const wrong = fb({ RAISE: 0.77, CALL: 0.23, FOLD: 0 }, "FOLD", "RAISE");
    expect(wrong).toMatchObject({ tone: "incorrect", title: "Не входит в стратегию", randomizerNote: null });
    expect(wrong.summary).toBe("3-бет — 77%, колл — 23%. Фолд с этой рукой здесь не играют.");
    expect(formatPracticeFrequencyList({ RAISE: 0.004, CALL: 0.996, FOLD: 0 }, actions)).toBe("Колл — >99%, 3-бет — <1%");
  });

  it("pure hands: one short line, no randomizer", () => {
    expect(fb({ RAISE: 1, CALL: 0, FOLD: 0 }, "RAISE")).toMatchObject({
      tone: "correct", title: "Верно", summary: "С AJs здесь всегда делаем 3-бет.", randomizerNote: null,
    });
  });
});
