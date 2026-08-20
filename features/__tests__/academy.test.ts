import { describe, expect, it, vi } from "vitest";
import { ACADEMY_PREFLOP_LESSONS } from "@/config/academy/lessons";
import { getAcademyPreflopRange } from "@/config/academy/preflop-ranges";
import { CANONICAL_STARTING_HANDS, getTeachingAction } from "@/lib/academy/preflop";
import type {
  AcademyProgressRepository,
  AcademyProgressRow,
  RecordAcademyAttemptInput,
  RecordAcademyAttemptResult,
} from "@/lib/repositories";
import type { AcademyTrainingAnswer, PreflopPosition } from "@/types/academy";

vi.mock("@/lib/repositories", () => ({
  academyProgressRepository: {},
}));

const {
  AcademyValidationError,
  calculateAcademyCourseProgress,
  submitAcademyTrainingAttempt,
  verifyAcademyTrainingAttempt,
} = await import("@/features/academy");

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";

function answersFor(position: PreflopPosition, correctCount: number): AcademyTrainingAnswer[] {
  const strategy = getAcademyPreflopRange(position).referenceStrategy;
  return CANONICAL_STARTING_HANDS.slice(0, 10).map((hand, index) => {
    const correctAction = getTeachingAction(strategy[hand] ?? 0);
    return {
      hand,
      selectedAction: index < correctCount
        ? correctAction
        : correctAction === "OPEN" ? "FOLD" : "OPEN",
    };
  });
}

class MemoryAcademyProgressRepository implements AcademyProgressRepository {
  private readonly progress = new Map<string, AcademyProgressRow>();
  private readonly attempts = new Map<string, RecordAcademyAttemptInput>();
  private readonly attemptFlags = new Map<string, { first_pass: boolean; new_best: boolean }>();
  private sequence = 0;

  async getLessonProgress(playerId: string, lessonCode: string) {
    return this.progress.get(`${playerId}:${lessonCode}`) ?? null;
  }

  async listCourseProgress(playerId: string, lessonCodes: readonly string[]) {
    return lessonCodes.flatMap((lessonCode) => {
      const row = this.progress.get(`${playerId}:${lessonCode}`);
      return row ? [row] : [];
    });
  }

  async recordCompletedAttempt(input: RecordAcademyAttemptInput): Promise<RecordAcademyAttemptResult> {
    const existingAttempt = this.attempts.get(input.attemptId);
    const key = `${input.playerId}:${input.lessonCode}`;
    const existing = this.progress.get(key);
    if (existingAttempt) {
      if (JSON.stringify(existingAttempt) !== JSON.stringify(input)) throw new Error("attempt conflict");
      const storedFlags = this.attemptFlags.get(input.attemptId)!;
      return { ...existing!, is_new_attempt: false, ...storedFlags };
    }

    this.attempts.set(input.attemptId, input);
    this.sequence += 1;
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, this.sequence)).toISOString();
    const firstPass = input.passed && !existing?.passed;
    const newBest = !existing || input.scorePercent > existing.best_score_percent;
    const row: AcademyProgressRow = {
      lesson_code: input.lessonCode,
      attempts_count: (existing?.attempts_count ?? 0) + 1,
      last_score_percent: input.scorePercent,
      best_score_percent: Math.max(existing?.best_score_percent ?? 0, input.scorePercent),
      passed: Boolean(existing?.passed || input.passed),
      first_completed_at: existing?.first_completed_at ?? (firstPass ? timestamp : null),
      last_attempt_at: timestamp,
    };
    this.progress.set(key, row);
    this.attemptFlags.set(input.attemptId, { first_pass: firstPass, new_best: newBest });
    return { ...row, is_new_attempt: true, first_pass: firstPass, new_best: newBest };
  }
}

function input(correctCount: number, attemptId = ATTEMPT_ID, position: PreflopPosition = "UTG") {
  return {
    attemptId,
    lessonCode: ACADEMY_PREFLOP_LESSONS[position].code,
    questions: answersFor(position, correctCount),
  };
}

describe("Academy server verification", () => {
  it("calculates a valid 10-answer score on the server", () => {
    expect(verifyAcademyTrainingAttempt(input(8))).toMatchObject({
      correctAnswers: 8,
      totalQuestions: 10,
      percentage: 80,
      passed: true,
    });
  });

  it("derives correctness from canonical strategy instead of client score fields", () => {
    const attempt = { ...input(6), percentage: 100, passed: true };
    expect(verifyAcademyTrainingAttempt(attempt)).toMatchObject({ percentage: 60, passed: false });
  });

  it.each([
    ["duplicate hand", () => ({ ...input(8), questions: [...input(8).questions.slice(0, 9), input(8).questions[0]] })],
    ["invalid hand", () => ({ ...input(8), questions: [{ hand: "AX", selectedAction: "OPEN" }, ...input(8).questions.slice(1)] })],
    ["invalid action", () => ({ ...input(8), questions: [{ hand: "AA", selectedAction: "CALL" }, ...input(8).questions.slice(1)] })],
    ["unknown lesson", () => ({ ...input(8), lessonCode: "whatever-user-sent" })],
    ["wrong question count", () => ({ ...input(8), questions: input(8).questions.slice(0, 9) })],
  ])("rejects %s", (_name, createInvalidInput) => {
    expect(() => verifyAcademyTrainingAttempt(
      createInvalidInput() as Parameters<typeof verifyAcademyTrainingAttempt>[0],
    )).toThrow(AcademyValidationError);
  });
});

describe("Academy progress semantics", () => {
  it("keeps attempts, best, monotonic pass and immutable first completion", async () => {
    const repository = new MemoryAcademyProgressRepository();
    const failed = await submitAcademyTrainingAttempt(PLAYER_ID, input(7), repository);
    const passed = await submitAcademyTrainingAttempt(
      PLAYER_ID,
      input(8, "33333333-3333-4333-8333-333333333333"),
      repository,
    );
    const firstCompletedAt = passed.progress.firstCompletedAt;
    const improved = await submitAcademyTrainingAttempt(
      PLAYER_ID,
      input(10, "44444444-4444-4444-8444-444444444444"),
      repository,
    );
    const regressed = await submitAcademyTrainingAttempt(
      PLAYER_ID,
      input(5, "55555555-5555-4555-8555-555555555555"),
      repository,
    );
    const equalBest = await submitAcademyTrainingAttempt(
      PLAYER_ID,
      input(10, "77777777-7777-4777-8777-777777777777"),
      repository,
    );

    expect(failed.progress).toMatchObject({ attemptsCount: 1, lastScorePercent: 70, bestScorePercent: 70, passed: false, firstCompletedAt: null });
    expect(passed).toMatchObject({ firstPass: true, newBest: true });
    expect(passed.progress).toMatchObject({ attemptsCount: 2, lastScorePercent: 80, bestScorePercent: 80, passed: true, firstCompletedAt });
    expect(improved.progress).toMatchObject({ attemptsCount: 3, lastScorePercent: 100, bestScorePercent: 100, passed: true, firstCompletedAt });
    expect(regressed.progress).toMatchObject({ attemptsCount: 4, lastScorePercent: 50, bestScorePercent: 100, passed: true, firstCompletedAt });
    expect(equalBest).toMatchObject({ newBest: false });
    expect(equalBest.progress).toMatchObject({ attemptsCount: 5, bestScorePercent: 100, firstCompletedAt });
  });

  it("does not count the same attemptId twice", async () => {
    const repository = new MemoryAcademyProgressRepository();
    const first = await submitAcademyTrainingAttempt(PLAYER_ID, input(8), repository);
    const retry = await submitAcademyTrainingAttempt(PLAYER_ID, input(8), repository);

    expect(first.isNewAttempt).toBe(true);
    expect(retry.isNewAttempt).toBe(false);
    expect(retry.progress.attemptsCount).toBe(1);
    expect(retry.firstPass).toBe(first.firstPass);
    expect(retry.newBest).toBe(first.newBest);
  });

  it("keeps progress for multiple lessons independent", async () => {
    const repository = new MemoryAcademyProgressRepository();
    await submitAcademyTrainingAttempt(PLAYER_ID, input(8), repository);
    await submitAcademyTrainingAttempt(
      PLAYER_ID,
      input(6, "66666666-6666-4666-8666-666666666666", "BTN"),
      repository,
    );

    expect((await repository.getLessonProgress(PLAYER_ID, ACADEMY_PREFLOP_LESSONS.UTG.code))?.best_score_percent).toBe(80);
    expect((await repository.getLessonProgress(PLAYER_ID, ACADEMY_PREFLOP_LESSONS.BTN.code))?.best_score_percent).toBe(60);
  });

  it.each([[0, 0], [1, 14], [4, 57], [7, 100]])(
    "calculates %i/7 as %i%%",
    (passedLessons, expectedPercent) => {
      const lessons = Array.from({ length: 7 }, (_, index) => ({ passed: index < passedLessons }));
      expect(calculateAcademyCourseProgress(lessons)).toEqual({
        passedLessons,
        totalLessons: 7,
        progressPercent: expectedPercent,
      });
    },
  );
});
