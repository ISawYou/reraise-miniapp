import "server-only";

import {
  ACADEMY_PREFLOP_LESSON_CODES,
  getAcademyPreflopLessonByCode,
} from "@/config/academy/lessons";
import { getAcademyPreflopRange } from "@/config/academy/preflop-ranges";
import { ACADEMY_TRAINING_QUESTION_COUNT } from "@/config/academy/training";
import { getTeachingAction, isCanonicalStartingHand } from "@/lib/academy/preflop";
import { scoreTrainingSession } from "@/lib/academy/training";
import {
  academyProgressRepository,
  type AcademyProgressRepository,
  type AcademyProgressRow,
} from "@/lib/repositories/academy-progress";
import type {
  AcademyCourseProgress,
  AcademyLessonCode,
  AcademyLessonProgress,
  AcademyTrainingResult,
  PreflopAction,
} from "@/types/academy";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AcademyValidationError extends Error {}

export type SubmitAcademyAttemptInput = {
  readonly attemptId: string;
  readonly lessonCode: string;
  readonly questions: readonly unknown[];
};

export type AcademyProgressPayload = {
  readonly lessons: readonly AcademyLessonProgress[];
  readonly course: AcademyCourseProgress;
};

export type SubmitAcademyAttemptResult = {
  readonly result: AcademyTrainingResult;
  readonly progress: AcademyLessonProgress;
  readonly isNewAttempt: boolean;
  readonly firstPass: boolean;
  readonly newBest: boolean;
};

function mapProgress(row: AcademyProgressRow): AcademyLessonProgress {
  const lesson = getAcademyPreflopLessonByCode(row.lesson_code);
  if (!lesson) throw new Error(`Unknown persisted Academy lesson: ${row.lesson_code}`);

  return {
    lessonCode: lesson.code,
    attemptsCount: row.attempts_count,
    lastScorePercent: row.last_score_percent,
    bestScorePercent: row.best_score_percent,
    passed: row.passed,
    firstCompletedAt: row.first_completed_at,
    lastAttemptAt: row.last_attempt_at,
  };
}

export function calculateAcademyCourseProgress(
  lessons: readonly Pick<AcademyLessonProgress, "passed">[],
  totalLessons = ACADEMY_PREFLOP_LESSON_CODES.length,
): AcademyCourseProgress {
  const passedLessons = lessons.filter((lesson) => lesson.passed).length;
  return {
    passedLessons,
    totalLessons,
    progressPercent: totalLessons === 0 ? 0 : Math.round((passedLessons / totalLessons) * 100),
  };
}

export async function getAcademyCourseProgress(
  playerId: string,
  repository: AcademyProgressRepository = academyProgressRepository,
): Promise<AcademyProgressPayload> {
  const rows = await repository.listCourseProgress(playerId, ACADEMY_PREFLOP_LESSON_CODES);
  const lessons = rows.map(mapProgress);
  return {
    lessons,
    course: calculateAcademyCourseProgress(lessons),
  };
}

export async function getAcademyLessonProgress(
  playerId: string,
  lessonCode: AcademyLessonCode,
  repository: AcademyProgressRepository = academyProgressRepository,
): Promise<AcademyLessonProgress | null> {
  const row = await repository.getLessonProgress(playerId, lessonCode);
  return row ? mapProgress(row) : null;
}

function validateAction(action: unknown): action is PreflopAction {
  return action === "OPEN" || action === "FOLD";
}

export function verifyAcademyTrainingAttempt(
  input: SubmitAcademyAttemptInput,
): AcademyTrainingResult {
  const lesson = getAcademyPreflopLessonByCode(input.lessonCode);
  if (!lesson) throw new AcademyValidationError("Неизвестный урок Academy");
  if (!UUID_PATTERN.test(input.attemptId)) {
    throw new AcademyValidationError("Некорректный идентификатор попытки");
  }
  if (!Array.isArray(input.questions) || input.questions.length !== ACADEMY_TRAINING_QUESTION_COUNT) {
    throw new AcademyValidationError(
      `Завершённая тренировка должна содержать ${ACADEMY_TRAINING_QUESTION_COUNT} ответов`,
    );
  }

  const uniqueHands = new Set<string>();
  const strategy = getAcademyPreflopRange(lesson.position).referenceStrategy;
  let correctAnswers = 0;

  for (const rawQuestion of input.questions) {
    if (!rawQuestion || typeof rawQuestion !== "object") {
      throw new AcademyValidationError("Попытка содержит некорректный ответ");
    }
    const question = rawQuestion as { hand?: unknown; selectedAction?: unknown };
    if (typeof question.hand !== "string" || !isCanonicalStartingHand(question.hand)) {
      throw new AcademyValidationError("Попытка содержит некорректную стартовую руку");
    }
    if (!validateAction(question.selectedAction)) {
      throw new AcademyValidationError("Допустимые действия: OPEN или FOLD");
    }
    if (uniqueHands.has(question.hand)) {
      throw new AcademyValidationError("Стартовые руки в попытке не должны повторяться");
    }

    uniqueHands.add(question.hand);
    const correctAction = getTeachingAction(strategy[question.hand] ?? 0);
    if (question.selectedAction === correctAction) correctAnswers += 1;
  }

  return scoreTrainingSession(correctAnswers, input.questions.length);
}

export async function submitAcademyTrainingAttempt(
  playerId: string,
  input: SubmitAcademyAttemptInput,
  repository: AcademyProgressRepository = academyProgressRepository,
): Promise<SubmitAcademyAttemptResult> {
  const lesson = getAcademyPreflopLessonByCode(input.lessonCode);
  if (!lesson) throw new AcademyValidationError("Неизвестный урок Academy");

  const result = verifyAcademyTrainingAttempt(input);
  const stored = await repository.recordCompletedAttempt({
    attemptId: input.attemptId,
    playerId,
    lessonCode: lesson.code,
    scorePercent: result.percentage,
    passed: result.passed,
  });

  return {
    result,
    progress: mapProgress(stored),
    isNewAttempt: stored.is_new_attempt,
    firstPass: stored.first_pass,
    newBest: stored.new_best,
  };
}
