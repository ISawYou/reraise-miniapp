/**
 * Current 100bb Solver Lab behaviour proofs for the dataset-platform refactor.
 *
 * `solver-session-regression.pre-refactor.json` was captured by running the
 * UNCHANGED origin/main (bb74517) code — before any refactor edits — with a
 * fixed SESSION_SECRET. The refactored code must reproduce it exactly.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACADEMY_BASE_MTT_COURSE_CODE,
  ACADEMY_SOLVER_LAB_COURSE_CODE,
  getAcademyCourse,
  getPrimaryAcademyCourse,
  listAcademyCourseLessons,
  listAcademyCourses,
} from "@/config/academy/catalog";
import { ACADEMY_SOLVER_RFI_LESSONS } from "@/config/academy/solver-lessons";
import { ACADEMY_PREFLOP_POSITIONS } from "@/lib/academy/preflop";
import { calculateAcademyCourseProgress } from "@/lib/academy/progress";
import { buildAcademySolverSessionForLesson, toPublicSolverQuestion } from "@/lib/academy/solver-training";
import captured from "@/lib/academy/__tests__/fixtures/solver-session-regression.pre-refactor.json";

vi.mock("@/lib/repositories", () => ({ academyProgressRepository: {} }));
vi.mock("@/lib/repositories/academy-progress", () => ({ academyProgressRepository: {} }));

const { getAcademySolverQuestion, revealAcademySolverAnswer, verifyAcademySolverAttempt } =
  await import("@/features/academy");

type CapturedQuestion = (typeof captured.sessions)[number]["questions"][number];
const OLD_QUESTION_KEYS = ["bucket", "frequencies", "hand", "questionIndex", "randomizerPercent", "renderedCards", "resolvedAction"];

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", captured.sessionSecret);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("(24) pre-refactor concrete sessions reproduce identically", () => {
  it.each(captured.sessions.map((entry) => [entry.key.lessonCode, entry] as const))(
    "%s: every question (hand, bucket, cards, randomizer, frequencies, resolved action) is unchanged",
    (_lessonCode, entry) => {
      const { playerId, lessonCode, attemptId } = entry.key;
      const session = buildAcademySolverSessionForLesson({ playerId, lessonCode, attemptId });
      expect(entry.questions).toHaveLength(10);
      expect(session).toHaveLength(10);
      session.forEach((question, index) => {
        const before: CapturedQuestion = entry.questions[index];
        expect(Object.keys(before).sort()).toEqual(OLD_QUESTION_KEYS);
        // The only added field is the answer-free action display metadata.
        expect(Object.keys(question).sort()).toEqual([...OLD_QUESTION_KEYS, "actions"].sort());
        const after = Object.fromEntries(OLD_QUESTION_KEYS.map((key) => [key, question[key as keyof typeof question]]));
        expect(after).toEqual(before);
      });
    },
  );

  it("the public question endpoint logic serves the same hand/cards/randomizer per index", () => {
    for (const entry of captured.sessions) {
      const { playerId, lessonCode, attemptId } = entry.key;
      entry.questions.forEach((before, questionIndex) => {
        const served = getAcademySolverQuestion(playerId, { lessonCode, attemptId, questionIndex });
        expect({ hand: served.hand, renderedCards: served.renderedCards, randomizerPercent: served.randomizerPercent })
          .toEqual({ hand: before.hand, renderedCards: before.renderedCards, randomizerPercent: before.randomizerPercent });
        const reveal = revealAcademySolverAnswer(playerId, { lessonCode, attemptId, questionIndex, selectedAction: "FOLD" });
        expect(reveal.resolvedAction).toBe(before.resolvedAction);
        expect(reveal.frequencies).toEqual(before.frequencies);
        expect(reveal.matchesResolvedAction).toBe(before.resolvedAction === "FOLD");
      });
    }
  });

  it("the same submitted answer sets produce the same scores as before", () => {
    for (const entry of captured.sessions) {
      const { playerId, lessonCode, attemptId } = entry.key;
      const score = (answers: readonly string[]) => verifyAcademySolverAttempt({
        attemptId,
        lessonCode,
        questions: answers.map((selectedAction, questionIndex) => ({ questionIndex, selectedAction })),
      }, { playerId });
      expect(score(entry.scores.allRaise.answers)).toEqual(entry.scores.allRaise.result);
      expect(score(entry.scores.allFold.answers)).toEqual(entry.scores.allFold.result);
      expect(score(entry.questions.map((question) => question.resolvedAction))).toEqual(entry.scores.perfect);
    }
  });

  it("still rejects actions outside the bound node with the same message", () => {
    const { playerId, lessonCode, attemptId } = captured.sessions[0].key;
    expect(() => revealAcademySolverAnswer(playerId, { lessonCode, attemptId, questionIndex: 0, selectedAction: "CALL" }))
      .toThrow("Допустимые действия: RAISE_2_25BB или FOLD");
    expect(() => verifyAcademySolverAttempt({
      attemptId, lessonCode, questions: Array.from({ length: 10 }, () => ({ selectedAction: "OPEN" })),
    }, { playerId })).toThrow("Допустимые действия: RAISE_2_25BB или FOLD");
  });
});

describe("(20) current 100bb public payload", () => {
  it("exposes only hand/renderedCards/randomizerPercent + the two safe action definitions", () => {
    for (const entry of captured.sessions) {
      const { playerId, lessonCode, attemptId } = entry.key;
      for (const question of buildAcademySolverSessionForLesson({ playerId, lessonCode, attemptId })) {
        const publicQuestion = toPublicSolverQuestion(question);
        expect(Object.keys(publicQuestion).sort()).toEqual(["actions", "hand", "randomizerPercent", "renderedCards"]);
        expect(publicQuestion.actions.map((action) => Object.keys(action).sort())).toEqual([
          ["amountBb", "code", "kind", "label", "ru"],
          ["code", "kind", "label", "ru"],
        ]);
        expect(publicQuestion.actions.map((action) => [action.code, action.label, action.ru?.button])).toEqual([
          ["RAISE_2_25BB", "Raise 2.25 BB", "Рейз 2.25 BB"],
          ["FOLD", "Fold", "Фолд"],
        ]);
        const raw = JSON.stringify(publicQuestion);
        for (const leak of ["frequencies", "frequency", "resolvedAction", "correctAction", "bucket", "evBb", captured.sessionSecret]) {
          expect(raw).not.toContain(leak);
        }
      }
    }
  });
});

describe("(14) catalog, progress and routes unchanged", () => {
  it("base_mtt is untouched and stays the primary course", () => {
    expect(getPrimaryAcademyCourse().code).toBe(ACADEMY_BASE_MTT_COURSE_CODE);
    const base = getAcademyCourse(ACADEMY_BASE_MTT_COURSE_CODE)!;
    const lessons = listAcademyCourseLessons(base);
    expect(lessons.map((lesson) => lesson.code)).toEqual(
      ACADEMY_PREFLOP_POSITIONS.map((position) => `preflop_rfi_9max_100bb_${position.toLowerCase()}`));
    expect(lessons.every((lesson) => lesson.trainerKind === "PREFLOP_RFI_BINARY")).toBe(true);
    expect(lessons.map((lesson) => lesson.route)).toEqual(
      ACADEMY_PREFLOP_POSITIONS.map((position) => `/academy/preflop/${position.toLowerCase()}`));
  });

  it("solver_lab still has exactly its 7 lessons, routes and progress math", () => {
    expect(listAcademyCourses().map((course) => course.code)).toEqual(["base_mtt", "solver_lab"]);
    const solver = getAcademyCourse(ACADEMY_SOLVER_LAB_COURSE_CODE)!;
    const lessons = listAcademyCourseLessons(solver);
    expect(lessons.map((lesson) => lesson.code)).toEqual(
      ACADEMY_PREFLOP_POSITIONS.map((position) => `solver_rfi_9max_100bb_${position.toLowerCase()}`));
    expect(lessons.map((lesson) => lesson.route)).toEqual(
      ACADEMY_PREFLOP_POSITIONS.map((position) => `/academy/solver/rfi/100bb/${position.toLowerCase()}`));
    expect(ACADEMY_PREFLOP_POSITIONS.map((position) => ACADEMY_SOLVER_RFI_LESSONS[position].trainRoute)).toEqual(
      ACADEMY_PREFLOP_POSITIONS.map((position) => `/academy/solver/rfi/100bb/${position.toLowerCase()}/train`));

    const progress = (codes: string[]) => calculateAcademyCourseProgress(codes.map((lessonCode) => ({
      lessonCode, attemptsCount: 1, lastScorePercent: 90, bestScorePercent: 90, passed: true,
      firstCompletedAt: "2026-01-01T00:00:00.000Z", lastAttemptAt: "2026-01-01T00:00:00.000Z",
    })), solver);
    expect(progress([])).toEqual({ passedLessons: 0, totalLessons: 7, progressPercent: 0 });
    expect(progress(["solver_rfi_9max_100bb_co"])).toEqual({ passedLessons: 1, totalLessons: 7, progressPercent: 14 });
    expect(progress(["solver_rfi_9max_100bb_co", "preflop_rfi_9max_100bb_co"]))
      .toEqual({ passedLessons: 1, totalLessons: 7, progressPercent: 14 });
  });

  it("the page and API route files are still in place", () => {
    for (const file of [
      "app/academy/solver/rfi/100bb/page.tsx",
      "app/academy/solver/rfi/100bb/[position]/page.tsx",
      "app/academy/solver/rfi/100bb/[position]/train/page.tsx",
      "app/api/academy/solver/session/route.ts",
      "app/api/academy/solver/reveal/route.ts",
    ]) {
      expect(existsSync(path.resolve(process.cwd(), file))).toBe(true);
    }
  });
});
