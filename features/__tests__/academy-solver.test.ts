import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACADEMY_BASE_MTT_COURSE_CODE,
  ACADEMY_SOLVER_LAB_COURSE_CODE,
  getAcademyLessonByCode,
  getPrimaryAcademyCourse,
} from "@/config/academy/catalog";
import { ACADEMY_PASS_THRESHOLD } from "@/config/academy/training";
import { CANONICAL_STARTING_HANDS } from "@/lib/academy/preflop";
import { buildAcademySolverSession } from "@/lib/academy/solver-training";
import { buildSolverAnswerFeedback } from "@/lib/academy/solver-feedback";
import { scoreTrainingSession } from "@/lib/academy/training";
import type {
  AcademyAdminProgressRow,
  AcademyProgressRepository,
  AcademyProgressRow,
  RecordAcademyAttemptInput,
  RecordAcademyAttemptResult,
} from "@/lib/repositories";
import type { AcademySolverAction } from "@/types/academy";

vi.mock("@/lib/repositories", () => ({ academyProgressRepository: {} }));
vi.mock("@/lib/repositories/academy-progress", () => ({ academyProgressRepository: {} }));

const {
  AcademyValidationError,
  getAcademyAdminProgress,
  getAcademyCourseProgress,
  getAllAcademyCoursesProgress,
  submitAcademyTrainingAttempt,
  verifyAcademyAttempt,
  verifyAcademySolverAttempt,
} = await import("@/features/academy");

const SECRET = "features-solver-secret";
const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PLAYER = "99999999-9999-4999-8999-999999999999";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const LESSON = "solver_rfi_9max_100bb_hj";

function session(attemptId = ATTEMPT_ID, playerId = PLAYER_ID, lessonCode = LESSON) {
  return buildAcademySolverSession({ playerId, lessonCode, attemptId, position: "HJ" });
}

function flip(action: AcademySolverAction): AcademySolverAction {
  return action === "RAISE_2_25BB" ? "FOLD" : "RAISE_2_25BB";
}

function perfectAnswers(attemptId = ATTEMPT_ID) {
  return session(attemptId).map((q) => ({ questionIndex: q.questionIndex, selectedAction: q.resolvedAction }));
}

function input(questions: readonly unknown[], overrides: Record<string, unknown> = {}) {
  return { attemptId: ATTEMPT_ID, lessonCode: LESSON, questions, ...overrides };
}

function row(lessonCode: string, overrides: Partial<AcademyProgressRow> = {}): AcademyProgressRow {
  return {
    lesson_code: lessonCode,
    attempts_count: 1,
    last_score_percent: 90,
    best_score_percent: 90,
    passed: true,
    first_completed_at: "2026-01-01T00:00:00.000Z",
    last_attempt_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

class MemoryRepository implements AcademyProgressRepository {
  readonly progress = new Map<string, AcademyProgressRow>();
  readonly attempts = new Map<string, RecordAcademyAttemptInput>();
  adminRows: AcademyAdminProgressRow[] = [];

  seed(playerId: string, progress: AcademyProgressRow) {
    this.progress.set(`${playerId}:${progress.lesson_code}`, progress);
  }

  async getLessonProgress(playerId: string, lessonCode: string) {
    return this.progress.get(`${playerId}:${lessonCode}`) ?? null;
  }

  async listCourseProgress(playerId: string, lessonCodes: readonly string[]) {
    return lessonCodes.flatMap((code) => {
      const found = this.progress.get(`${playerId}:${code}`);
      return found ? [found] : [];
    });
  }

  async listAdminProgress() {
    return this.adminRows;
  }

  async recordCompletedAttempt(attempt: RecordAcademyAttemptInput): Promise<RecordAcademyAttemptResult> {
    const key = `${attempt.playerId}:${attempt.lessonCode}`;
    const existing = this.progress.get(key);
    if (this.attempts.has(attempt.attemptId)) {
      if (JSON.stringify(this.attempts.get(attempt.attemptId)) !== JSON.stringify(attempt)) {
        throw new Error("attempt conflict");
      }
      return { ...existing!, is_new_attempt: false, first_pass: false, new_best: false };
    }
    this.attempts.set(attempt.attemptId, attempt);
    const next: AcademyProgressRow = {
      lesson_code: attempt.lessonCode,
      attempts_count: (existing?.attempts_count ?? 0) + 1,
      last_score_percent: attempt.scorePercent,
      best_score_percent: Math.max(existing?.best_score_percent ?? 0, attempt.scorePercent),
      passed: Boolean(existing?.passed || attempt.passed),
      first_completed_at: existing?.first_completed_at ?? (attempt.passed ? "2026-02-01T00:00:00.000Z" : null),
      last_attempt_at: "2026-02-01T00:00:00.000Z",
    };
    this.progress.set(key, next);
    return { ...next, is_new_attempt: true, first_pass: attempt.passed && !existing?.passed, new_best: true };
  }
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verifyAcademySolverAttempt", () => {
  const context = { playerId: PLAYER_ID };

  it("(25) scores 100% when every answer matches the resolved outcome", () => {
    expect(verifyAcademySolverAttempt(input(perfectAnswers()), context)).toEqual({
      correctAnswers: 10,
      totalQuestions: 10,
      percentage: 100,
      passed: true,
      feedback: "Отлично",
    });
  });

  it("(26) counts a mixed-hand choice against the resolved outcome as incorrect for scoring, while copy stays non-judgmental", () => {
    const questions = session();
    const mixedIndexes = questions.filter((q) => q.bucket === "MIXED").map((q) => q.questionIndex);
    expect(mixedIndexes).toHaveLength(4);

    const answers = perfectAnswers().map((answer) => mixedIndexes.includes(answer.questionIndex)
      ? { ...answer, selectedAction: flip(answer.selectedAction) }
      : answer);
    // 4 mixed hands answered against the randomizer: exactly 4 misses, no double penalty.
    expect(verifyAcademySolverAttempt(input(answers), context)).toMatchObject({
      correctAnswers: 6,
      percentage: 60,
      passed: false,
    });

    const oneMixedMiss = perfectAnswers().map((answer) => answer.questionIndex === mixedIndexes[0]
      ? { ...answer, selectedAction: flip(answer.selectedAction) }
      : answer);
    expect(verifyAcademySolverAttempt(input(oneMixedMiss), context)).toMatchObject({
      correctAnswers: 9,
      percentage: 90,
      passed: true,
    });

    const mixed = questions[mixedIndexes[0]];
    const feedback = buildSolverAnswerFeedback({
      hand: mixed.hand,
      frequencies: mixed.frequencies,
      randomizerPercent: mixed.randomizerPercent,
      resolvedAction: mixed.resolvedAction,
      selectedAction: flip(mixed.resolvedAction),
    });
    expect(feedback.tone).toBe("mixed");

    const pure = questions.find((q) => q.bucket !== "MIXED")!;
    expect(buildSolverAnswerFeedback({
      hand: pure.hand,
      frequencies: pure.frequencies,
      randomizerPercent: pure.randomizerPercent,
      resolvedAction: pure.resolvedAction,
      selectedAction: flip(pure.resolvedAction),
    }).tone).toBe("incorrect");
  });

  it("(27) ignores tampered client hand/frequency/correctAction/randomizer/score fields", () => {
    const questions = session();
    const otherHands = CANONICAL_STARTING_HANDS.filter((hand) => !questions.some((q) => q.hand === hand));
    const payload = questions.map((q, index) => ({
      questionIndex: index,
      selectedAction: flip(q.resolvedAction),
      hand: otherHands[index],
      frequencies: { RAISE_2_25BB: q.resolvedAction === "RAISE_2_25BB" ? 0 : 1, FOLD: 0 },
      correctAction: flip(q.resolvedAction),
      resolvedAction: flip(q.resolvedAction),
      randomizerPercent: 0,
      score: 100,
    }));

    const result = verifyAcademySolverAttempt(
      input(payload, { percentage: 100, passed: true, correctAnswers: 10 }),
      context,
    );
    expect(result).toMatchObject({ correctAnswers: 0, percentage: 0, passed: false });
  });

  it("(28) rejects unknown or non-Solver lesson codes", () => {
    for (const lessonCode of ["nope", "preflop_rfi_9max_100bb_hj", "SOLVER_RFI_9MAX_100BB_HJ", ""]) {
      expect(() => verifyAcademySolverAttempt(input(perfectAnswers(), { lessonCode }), context))
        .toThrow(AcademyValidationError);
    }
  });

  it("(29) rejects a wrong question count", () => {
    expect(() => verifyAcademySolverAttempt(input(perfectAnswers().slice(0, 9)), context))
      .toThrow(AcademyValidationError);
    expect(() => verifyAcademySolverAttempt(input([...perfectAnswers(), perfectAnswers()[0]]), context))
      .toThrow(AcademyValidationError);
  });

  it("(30) rejects duplicate hands in a submitted session", () => {
    const answers = perfectAnswers().map((answer) => ({ ...answer, hand: "AA" }));
    expect(() => verifyAcademySolverAttempt(input(answers), context)).toThrow(AcademyValidationError);
  });

  it.each([
    ["invalid action", (a: ReturnType<typeof perfectAnswers>) => [{ ...a[0], selectedAction: "OPEN" }, ...a.slice(1)]],
    ["out-of-order index", (a: ReturnType<typeof perfectAnswers>) => [a[1], a[0], ...a.slice(2)]],
    ["non-object answer", (a: ReturnType<typeof perfectAnswers>) => [null, ...a.slice(1)]],
    ["invalid hand", (a: ReturnType<typeof perfectAnswers>) => [{ ...a[0], hand: "AX" }, ...a.slice(1)]],
  ])("rejects %s", (_name, mutate) => {
    expect(() => verifyAcademySolverAttempt(input(mutate(perfectAnswers())), context))
      .toThrow(AcademyValidationError);
  });

  it("rejects a malformed attempt id and a missing server-side player id", () => {
    expect(() => verifyAcademySolverAttempt(input(perfectAnswers(), { attemptId: "x" }), context))
      .toThrow(AcademyValidationError);
    expect(() => verifyAcademySolverAttempt(input(perfectAnswers()))).toThrow(AcademyValidationError);
  });

  it("scores another player's answer key as their own derivation, not ours", () => {
    const result = verifyAcademySolverAttempt(input(perfectAnswers()), { playerId: OTHER_PLAYER });
    expect(result.correctAnswers).toBeLessThan(10);
  });

  it("(31) uses the shared ACADEMY_PASS_THRESHOLD (0.8) via scoreTrainingSession", () => {
    expect(ACADEMY_PASS_THRESHOLD).toBe(0.8);
    const base = perfectAnswers();
    for (const misses of [0, 1, 2, 3, 4, 10]) {
      const answers = base.map((answer, index) => index < misses
        ? { ...answer, selectedAction: flip(answer.selectedAction) }
        : answer);
      const result = verifyAcademySolverAttempt(input(answers), context);
      expect(result).toEqual(scoreTrainingSession(10 - misses, 10));
      expect(result.passed).toBe((10 - misses) / 10 >= ACADEMY_PASS_THRESHOLD);
    }
  });

  it("is dispatched through the generic registry by trainer kind", () => {
    const lesson = getAcademyLessonByCode(LESSON)!;
    expect(lesson.trainerKind).toBe("PREFLOP_RFI_FREQUENCY");
    expect(verifyAcademyAttempt(lesson, input(perfectAnswers()), { playerId: PLAYER_ID }).percentage).toBe(100);
  });
});

describe("submitAcademyTrainingAttempt for Solver Lab", () => {
  it("records under the Solver Lab lesson code and reuses attempt idempotency", async () => {
    const repository = new MemoryRepository();
    const first = await submitAcademyTrainingAttempt(PLAYER_ID, input(perfectAnswers()), repository);
    expect(first).toMatchObject({ isNewAttempt: true, result: { percentage: 100, passed: true } });
    expect(first.progress.lessonCode).toBe(LESSON);

    const replay = await submitAcademyTrainingAttempt(PLAYER_ID, input(perfectAnswers()), repository);
    expect(replay.isNewAttempt).toBe(false);
    expect(replay.progress.attemptsCount).toBe(1);
  });
});

describe("course progress isolation", () => {
  it("(35) getPrimaryAcademyCourse() still returns База MTT", () => {
    expect(getPrimaryAcademyCourse().code).toBe(ACADEMY_BASE_MTT_COURSE_CODE);
    expect(getPrimaryAcademyCourse().code).toBe("base_mtt");
  });

  it("(32)(33)(34) keeps base_mtt and solver_lab progress separate", async () => {
    const repository = new MemoryRepository();
    repository.seed(PLAYER_ID, row("preflop_rfi_9max_100bb_utg"));
    repository.seed(PLAYER_ID, row("preflop_rfi_9max_100bb_ep"));
    repository.seed(PLAYER_ID, row("preflop_rfi_9max_100bb_mp1", { passed: false, first_completed_at: null }));

    const before = await getAcademyCourseProgress(PLAYER_ID, repository);
    const allBefore = await getAllAcademyCoursesProgress(PLAYER_ID, repository);
    // (34) zero Solver Lab attempts → 0/7 while База MTT shows its real 2/7.
    expect(allBefore.courses.map((c) => c.courseCode)).toEqual([ACADEMY_BASE_MTT_COURSE_CODE, ACADEMY_SOLVER_LAB_COURSE_CODE]);
    expect(allBefore.courses[0]).toEqual(before);
    expect(before.course).toEqual({ passedLessons: 2, totalLessons: 7, progressPercent: 29 });
    expect(allBefore.courses[1].course).toEqual({ passedLessons: 0, totalLessons: 7, progressPercent: 0 });
    expect(allBefore.courses[1].lessons).toEqual([]);

    await submitAcademyTrainingAttempt(PLAYER_ID, input(perfectAnswers()), repository);
    repository.seed(PLAYER_ID, row("solver_rfi_9max_100bb_btn", { passed: false, first_completed_at: null }));

    // (32) База MTT numbers are byte-identical after Solver Lab attempts.
    const after = await getAcademyCourseProgress(PLAYER_ID, repository);
    expect(after).toEqual(before);

    // (33) Solver Lab reflects only its own 7 lessons.
    const allAfter = await getAllAcademyCoursesProgress(PLAYER_ID, repository);
    expect(allAfter.courses[0]).toEqual(before);
    expect(allAfter.courses[1].course).toEqual({ passedLessons: 1, totalLessons: 7, progressPercent: 14 });
    expect(allAfter.courses[1].lessons.map((l) => l.lessonCode).sort())
      .toEqual(["solver_rfi_9max_100bb_btn", LESSON].sort());
    expect(allAfter.courses[1].modules).toEqual([{
      moduleCode: "preflop_rfi_9max_100bb", passedLessons: 1, totalLessons: 7, progressPercent: 14,
    }]);
    expect(allAfter.courses[0].lessons.every((l) => l.lessonCode.startsWith("preflop_rfi_"))).toBe(true);
  });
});

describe("admin progress with Solver Lab", () => {
  function adminRow(playerId: string, lessonCode: string, overrides: Partial<AcademyProgressRow> = {}): AcademyAdminProgressRow {
    return {
      ...row(lessonCode, overrides),
      player_id: playerId,
      player_display_name: `Player ${playerId.slice(0, 4)}`,
      player_username: null,
      player_avatar_url: null,
    };
  }

  it("(40) includes a solver_lab entry per player", async () => {
    const repository = new MemoryRepository();
    repository.adminRows = [
      adminRow(PLAYER_ID, "preflop_rfi_9max_100bb_utg"),
      adminRow(PLAYER_ID, "solver_rfi_9max_100bb_co"),
      adminRow(OTHER_PLAYER, "preflop_rfi_9max_100bb_btn", { passed: false, first_completed_at: null }),
    ];
    const payload = await getAcademyAdminProgress(repository);

    for (const player of payload.players) {
      expect(player.courses.map((c) => c.courseCode)).toEqual(["base_mtt", "solver_lab"]);
    }
    const first = payload.players.find((p) => p.player.id === PLAYER_ID)!;
    expect(first.courses[0]).toMatchObject({ title: "База MTT", passedLessons: 1, totalLessons: 7 });
    expect(first.courses[1]).toMatchObject({ title: "Solver Lab", passedLessons: 1, totalLessons: 7 });
    expect(first.courses[1].modules[0].lessons.find((l) => l.lessonCode === "solver_rfi_9max_100bb_co")?.progress)
      .toMatchObject({ passed: true });
    expect(first.passedLessons).toBe(2);
    expect(first.totalLessons).toBe(14);

    const other = payload.players.find((p) => p.player.id === OTHER_PLAYER)!;
    expect(other.courses[1]).toMatchObject({ passedLessons: 0, totalLessons: 7 });
  });
});
