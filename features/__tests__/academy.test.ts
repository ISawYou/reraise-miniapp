import { describe, expect, it, vi } from "vitest";
import { ACADEMY_PREFLOP_LESSONS } from "@/config/academy/lessons";
import { getAcademyPreflopRange } from "@/config/academy/preflop-ranges";
import { CANONICAL_STARTING_HANDS, getTeachingAction } from "@/lib/academy/preflop";
import { ACADEMY_PASS_THRESHOLD, ACADEMY_TRAINING_QUESTION_COUNT } from "@/config/academy/training";
import { ACADEMY_BASE_MTT_COURSE_CODE, getPrimaryAcademyCourse } from "@/config/academy/catalog";
import type {
  AcademyAdminProgressRow,
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
  ACADEMY_TRAINER_VERIFIERS,
  AcademyValidationError,
  getAcademyAdminProgress,
  getAcademyCourseProgress,
  getAcademyLessonProgress,
  submitAcademyTrainingAttempt,
  verifyAcademyAttempt,
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
  readonly progress = new Map<string, AcademyProgressRow>();
  private readonly attempts = new Map<string, RecordAcademyAttemptInput>();
  private readonly attemptFlags = new Map<string, { first_pass: boolean; new_best: boolean }>();
  private sequence = 0;

  async listAdminProgress(): Promise<AcademyAdminProgressRow[]> {
    return [];
  }

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

  it("rejects an unknown lesson before touching the repository", async () => {
    const repository = new MemoryAcademyProgressRepository();
    await expect(submitAcademyTrainingAttempt(
      PLAYER_ID,
      { ...input(8), lessonCode: "preflop_rfi_9max_100bb_sb" },
      repository,
    )).rejects.toThrow(AcademyValidationError);
    expect(repository.progress.size).toBe(0);
  });
});

describe("Academy frozen training contract", () => {
  it("keeps 10 questions and the 80% pass threshold", () => {
    expect(ACADEMY_TRAINING_QUESTION_COUNT).toBe(10);
    expect(ACADEMY_PASS_THRESHOLD).toBe(0.8);
    expect(verifyAcademyTrainingAttempt(input(7))).toMatchObject({ percentage: 70, passed: false });
    expect(verifyAcademyTrainingAttempt(input(8))).toMatchObject({ percentage: 80, passed: true });
  });
});

describe("Academy trainer registry", () => {
  it("has exactly one trainer kind, routed to the existing OPEN/FOLD verifier", () => {
    expect(Object.keys(ACADEMY_TRAINER_VERIFIERS)).toEqual(["PREFLOP_RFI_BINARY"]);
    expect(ACADEMY_TRAINER_VERIFIERS.PREFLOP_RFI_BINARY).toBe(verifyAcademyTrainingAttempt);
  });

  it("dispatches by the catalog lesson's trainer kind with identical scoring", () => {
    const lesson = getPrimaryAcademyCourse().modules[0].lessons[0];
    for (const correct of [0, 5, 8, 10]) {
      expect(verifyAcademyAttempt(lesson, input(correct))).toEqual(
        verifyAcademyTrainingAttempt(input(correct)),
      );
    }
  });

  it("rejects an attempt whose lessonCode does not match the dispatched lesson", () => {
    const btn = getPrimaryAcademyCourse().modules[0].lessons[6];
    expect(() => verifyAcademyAttempt(btn, input(8))).toThrow(AcademyValidationError);
  });

  it("rejects a lesson whose trainer kind has no registered verifier", () => {
    const lesson = {
      ...getPrimaryAcademyCourse().modules[0].lessons[0],
      trainerKind: "UNKNOWN" as unknown as "PREFLOP_RFI_BINARY",
    };
    expect(() => verifyAcademyAttempt(lesson, input(8))).toThrow(AcademyValidationError);
  });
});

function persistedRow(overrides: Partial<AcademyProgressRow> = {}): AcademyProgressRow {
  return {
    lesson_code: "preflop_rfi_9max_100bb_utg",
    attempts_count: 3,
    last_score_percent: 70,
    best_score_percent: 90,
    passed: true,
    first_completed_at: "2026-03-01T10:00:00.000Z",
    last_attempt_at: "2026-03-02T10:00:00.000Z",
    ...overrides,
  };
}

class SeededRepository extends MemoryAcademyProgressRepository {
  constructor(private readonly adminRows: AcademyAdminProgressRow[] = []) {
    super();
  }

  seed(playerId: string, row: AcademyProgressRow) {
    this.progress.set(`${playerId}:${row.lesson_code}`, row);
    return this;
  }

  override async listAdminProgress() {
    return this.adminRows;
  }
}

describe("Academy catalog-driven progress (backward compatibility)", () => {
  it("maps an existing persisted row to the same catalog lesson with no backfill", async () => {
    // Literal pre-refactor row exactly as stored in academy_lesson_progress.
    const repository = new SeededRepository().seed(PLAYER_ID, persistedRow());
    const payload = await getAcademyCourseProgress(PLAYER_ID, repository);

    expect(payload.lessons).toEqual([{
      lessonCode: "preflop_rfi_9max_100bb_utg",
      attemptsCount: 3,
      lastScorePercent: 70,
      bestScorePercent: 90,
      passed: true,
      firstCompletedAt: "2026-03-01T10:00:00.000Z",
      lastAttemptAt: "2026-03-02T10:00:00.000Z",
    }]);
    expect(payload.course).toEqual({ passedLessons: 1, totalLessons: 7, progressPercent: 14 });
    expect(payload.courseCode).toBe(ACADEMY_BASE_MTT_COURSE_CODE);
    expect(await getAcademyLessonProgress(PLAYER_ID, "preflop_rfi_9max_100bb_utg", repository))
      .toMatchObject({ passed: true, bestScorePercent: 90, attemptsCount: 3 });
  });

  it("queries exactly the catalog course's lesson codes and reports per-module progress", async () => {
    const repository = new SeededRepository()
      .seed(PLAYER_ID, persistedRow())
      .seed(PLAYER_ID, persistedRow({ lesson_code: "preflop_rfi_9max_100bb_btn", passed: false }));
    const spy = vi.spyOn(repository, "listCourseProgress");
    const payload = await getAcademyCourseProgress(PLAYER_ID, repository);
    const course = getPrimaryAcademyCourse();

    expect(spy).toHaveBeenCalledWith(PLAYER_ID, course.modules[0].lessons.map((l) => l.code));
    expect(payload.modules).toEqual([{
      moduleCode: course.modules[0].code,
      passedLessons: 1,
      totalLessons: 7,
      progressPercent: 14,
    }]);
  });

  it("fails closed when a persisted lesson code is not in the catalog", async () => {
    const repository = new SeededRepository();
    vi.spyOn(repository, "listCourseProgress").mockResolvedValue([
      persistedRow({ lesson_code: "legacy_corrupt_code" }),
    ]);
    await expect(getAcademyCourseProgress(PLAYER_ID, repository))
      .rejects.toThrow("Unknown persisted Academy lesson: legacy_corrupt_code");

    vi.spyOn(repository, "getLessonProgress").mockResolvedValue(
      persistedRow({ lesson_code: "legacy_corrupt_code" }),
    );
    await expect(getAcademyLessonProgress(PLAYER_ID, "legacy_corrupt_code", repository))
      .rejects.toThrow(/Unknown persisted Academy lesson/);
  });

  it("rejects an unknown course code instead of returning empty progress", async () => {
    await expect(getAcademyCourseProgress(PLAYER_ID, new SeededRepository(), "missing_course"))
      .rejects.toThrow(/Unknown Academy course/);
  });
});

function adminRow(playerId: string, overrides: Partial<AcademyProgressRow> = {}): AcademyAdminProgressRow {
  return {
    ...persistedRow(overrides),
    player_id: playerId,
    player_display_name: `Player ${playerId.slice(0, 4)}`,
    player_username: "nick",
    player_avatar_url: "https://example.test/a.png",
  };
}

describe("Academy admin progress", () => {
  const OTHER_PLAYER = "99999999-9999-4999-8999-999999999999";

  it("takes titles, grouping and counts from the catalog and keeps last-activity sorting", async () => {
    const repository = new SeededRepository([
      adminRow(PLAYER_ID, { lesson_code: "preflop_rfi_9max_100bb_ep", last_attempt_at: "2026-03-05T00:00:00.000Z" }),
      adminRow(PLAYER_ID),
      adminRow(OTHER_PLAYER, { passed: false, last_attempt_at: "2026-03-01T00:00:00.000Z" }),
    ]);
    const payload = await getAcademyAdminProgress(repository);
    const course = getPrimaryAcademyCourse();
    const catalogLessons = course.modules[0].lessons;

    expect(payload.summary).toEqual({ startedPlayers: 2, passedPlayers: 1 });
    expect(payload.players.map((p) => p.player.id)).toEqual([PLAYER_ID, OTHER_PLAYER]);

    const [first] = payload.players;
    expect(first.player).toEqual({
      id: PLAYER_ID,
      displayName: "Player 1111",
      username: "nick",
      avatarUrl: "https://example.test/a.png",
    });
    expect(first.lastActivityAt).toBe("2026-03-05T00:00:00.000Z");
    expect(first.passedLessons).toBe(2);
    expect(first.totalLessons).toBe(catalogLessons.length);
    expect(first.lessons.map((l) => l.lessonCode)).toEqual(catalogLessons.map((l) => l.code));
    expect(first.lessons.map((l) => l.title)).toEqual(
      catalogLessons.map((l) => `${l.title} · ${l.subtitle}`),
    );
    expect(first.lessons[0].title).toBe("UTG · Under the Gun");
    expect(first.lessons[1].title).toBe("UTG+1 · EP · Early Position");

    expect(first.courses).toHaveLength(1);
    expect(first.courses[0]).toMatchObject({
      courseCode: course.code,
      title: course.title,
      passedLessons: 2,
      totalLessons: 7,
    });
    expect(first.courses[0].modules).toHaveLength(1);
    expect(first.courses[0].modules[0]).toMatchObject({
      moduleCode: course.modules[0].code,
      title: "Open Raise · 100 BB",
      passedLessons: 2,
      totalLessons: 7,
    });
    expect(first.courses[0].modules[0].lessons).toEqual(first.lessons);
  });

  it("fails closed when an admin row has a lesson code outside the catalog", async () => {
    const repository = new SeededRepository([
      adminRow(PLAYER_ID),
      adminRow(PLAYER_ID, { lesson_code: "legacy_corrupt_code" }),
    ]);
    await expect(getAcademyAdminProgress(repository))
      .rejects.toThrow("Unknown persisted Academy lesson: legacy_corrupt_code");
  });
});
