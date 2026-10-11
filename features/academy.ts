import "server-only";

import {
  getAcademyCourse,
  getAcademyLessonByCode,
  getPrimaryAcademyCourse,
  listAcademyCourseLessonCodes,
  listAcademyCourseLessons,
  listAcademyCourses,
  listAllAcademyLessonCodes,
} from "@/config/academy/catalog";
import { getAcademyPreflopLessonByCode } from "@/config/academy/lessons";
import { getAcademyPreflopRange } from "@/config/academy/preflop-ranges";
import { ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE } from "@/config/academy/preflop-trainer";
import { getAcademySolverLessonBinding } from "@/config/academy/solver-lessons";
import { ACADEMY_TRAINING_QUESTION_COUNT } from "@/config/academy/training";
import {
  ACADEMY_SOLVER_QUESTION_COUNT,
  buildAcademySolverSessionForLesson,
  toPublicSolverQuestion,
  type AcademySolverSessionQuestion,
} from "@/lib/academy/solver-training";
import { getTeachingAction, isCanonicalStartingHand } from "@/lib/academy/preflop";
import {
  AcademyPreflopTrainerSelectionError,
  buildAcademyPreflopTrainerSession,
  toPublicPreflopTrainerQuestion,
  type AcademyPreflopTrainerSessionQuestion,
} from "@/lib/academy/preflop-trainer";
import {
  calculateAcademyCourseProgress,
  calculateAcademyModuleProgress,
  calculateAcademyProgressForLessons,
} from "@/lib/academy/progress";
import { scoreTrainingSession } from "@/lib/academy/training";
import {
  academyProgressRepository,
  type AcademyProgressRepository,
  type AcademyProgressRow,
} from "@/lib/repositories/academy-progress";
import type {
  AcademyAdminCourseProgress,
  AcademyAdminLessonProgress,
  AcademyCourseProgress,
  AcademyAdminProgressPayload,
  AcademyLesson,
  AcademyLessonCode,
  AcademyLessonProgress,
  AcademyModuleProgress,
  AcademyPreflopTrainerPublicQuestion,
  AcademyPreflopTrainerReveal,
  AcademySolverAction,
  AcademySolverPublicQuestion,
  AcademySolverQuestionReveal,
  AcademyTrainerKind,
  AcademyTrainingResult,
  PreflopAction,
} from "@/types/academy";

export {
  calculateAcademyCourseProgress,
  calculateAcademyModuleProgress,
  calculateAcademyProgressForLessons,
};

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
  /** Additive (catalog foundation): which catalog course `course` describes. */
  readonly courseCode: string;
  /** Additive (catalog foundation): per-module progress within the course. */
  readonly modules: readonly AcademyModuleProgress[];
};

/**
 * Additive response of `GET /api/academy/progress`: the original single-course
 * (База MTT) payload at the top level, plus `courses` with one payload per
 * catalog course. `courses` is optional for older consumers/fixtures.
 */
export type AcademyProgressResponse = AcademyProgressPayload & {
  readonly courses?: readonly AcademyProgressPayload[];
};

export type AcademyAllCoursesProgressPayload = {
  readonly courses: readonly AcademyProgressPayload[];
};

export type SubmitAcademyAttemptResult = {
  readonly result: AcademyTrainingResult;
  readonly progress: AcademyLessonProgress;
  readonly isNewAttempt: boolean;
  readonly firstPass: boolean;
  readonly newBest: boolean;
};

function mapProgress(row: AcademyProgressRow): AcademyLessonProgress {
  // Fail closed: a persisted code that is not in the catalog is corrupt data,
  // never silently dropped or rendered as a default state.
  const lesson = getAcademyLessonByCode(row.lesson_code);
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

export async function getAcademyCourseProgress(
  playerId: string,
  repository: AcademyProgressRepository = academyProgressRepository,
  courseCode: string = getPrimaryAcademyCourse().code,
): Promise<AcademyProgressPayload> {
  const course = getAcademyCourse(courseCode);
  if (!course) throw new Error(`Unknown Academy course: ${courseCode}`);

  const rows = await repository.listCourseProgress(playerId, listAcademyCourseLessonCodes(course));
  const lessons = rows.map(mapProgress);
  return {
    lessons,
    course: calculateAcademyCourseProgress(lessons, course),
    courseCode: course.code,
    modules: course.modules.map((courseModule) =>
      calculateAcademyModuleProgress(lessons, courseModule)),
  };
}

/**
 * Progress for every catalog course (База MTT, Solver Lab, ...), each computed
 * strictly over its own catalog lessons — no cross-course contamination.
 * Additive: `getAcademyCourseProgress` keeps its signature and default.
 */
export async function getAllAcademyCoursesProgress(
  playerId: string,
  repository: AcademyProgressRepository = academyProgressRepository,
): Promise<AcademyAllCoursesProgressPayload> {
  const rows = await repository.listCourseProgress(playerId, listAllAcademyLessonCodes());
  const allLessons = rows.map(mapProgress);

  return {
    courses: listAcademyCourses().map((course) => {
      const courseLessonCodes = new Set(listAcademyCourseLessonCodes(course));
      const lessons = allLessons.filter((lesson) => courseLessonCodes.has(lesson.lessonCode));
      return {
        lessons,
        course: calculateAcademyCourseProgress(lessons, course),
        courseCode: course.code,
        modules: course.modules.map((courseModule) =>
          calculateAcademyModuleProgress(lessons, courseModule)),
      };
    }),
  };
}

export async function getAcademyAdminProgress(
  repository: AcademyProgressRepository = academyProgressRepository,
): Promise<AcademyAdminProgressPayload> {
  const rows = await repository.listAdminProgress();
  const grouped = new Map<string, typeof rows>();

  for (const row of rows) {
    const playerRows = grouped.get(row.player_id) ?? [];
    playerRows.push(row);
    grouped.set(row.player_id, playerRows);
  }

  const catalog = listAcademyCourses();
  const players = Array.from(grouped.values()).map((playerRows) => {
    const first = playerRows[0];
    // mapProgress fails closed on any row whose lesson_code is not in the catalog.
    const progressByLesson = new Map(
      playerRows.map((row) => {
        const progress = mapProgress(row);
        return [progress.lessonCode, progress] as const;
      }),
    );
    const toAdminLesson = (lesson: AcademyLesson): AcademyAdminLessonProgress => ({
      lessonCode: lesson.code,
      title: `${lesson.title} · ${lesson.subtitle}`,
      progress: progressByLesson.get(lesson.code) ?? null,
    });
    const courses: AcademyAdminCourseProgress[] = catalog.map((course) => {
      const courseProgress = calculateAcademyCourseProgress(
        Array.from(progressByLesson.values()),
        course,
      );
      return {
        courseCode: course.code,
        title: course.title,
        passedLessons: courseProgress.passedLessons,
        totalLessons: courseProgress.totalLessons,
        modules: course.modules.map((courseModule) => {
          const moduleProgress = calculateAcademyModuleProgress(
            Array.from(progressByLesson.values()),
            courseModule,
          );
          return {
            moduleCode: courseModule.code,
            title: courseModule.title,
            passedLessons: moduleProgress.passedLessons,
            totalLessons: moduleProgress.totalLessons,
            lessons: courseModule.lessons.map(toAdminLesson),
          };
        }),
      };
    });
    const catalogLessons = catalog.flatMap((course) => listAcademyCourseLessons(course));
    const lessons = catalogLessons.map(toAdminLesson);
    const overall = calculateAcademyProgressForLessons(
      Array.from(progressByLesson.values()),
      catalogLessons.map((lesson) => lesson.code),
    );

    return {
      player: {
        id: first.player_id,
        displayName: first.player_display_name,
        username: first.player_username,
        avatarUrl: first.player_avatar_url,
      },
      passedLessons: overall.passedLessons,
      totalLessons: overall.totalLessons,
      lastActivityAt: playerRows.reduce(
        (latest, row) => row.last_attempt_at > latest ? row.last_attempt_at : latest,
        first.last_attempt_at,
      ),
      lessons,
      courses,
    };
  }).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

  return {
    summary: {
      startedPlayers: players.length,
      passedPlayers: players.filter((player) => player.passedLessons > 0).length,
    },
    players,
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

/** Server-side facts a verifier may need beyond the client payload. */
export type AcademyAttemptVerificationContext = {
  /** Authenticated player id (from the session), never from the client body. */
  readonly playerId?: string;
};

// ---------------------------------------------------------------------------
// Solver Lab (PREFLOP_RFI_FREQUENCY)
// ---------------------------------------------------------------------------

export type AcademySolverQuestionInput = {
  readonly lessonCode: string;
  readonly attemptId: string;
  readonly questionIndex: unknown;
};

export type AcademySolverRevealInput = AcademySolverQuestionInput & {
  readonly selectedAction: unknown;
};

/** Valid answers are exactly the bound node's action codes (any count). */
function sessionActionCodes(session: readonly AcademySolverSessionQuestion[]): readonly string[] {
  return session[0].actions.map((action) => action.code);
}

function isSolverAction(action: unknown, actionCodes: readonly string[]): action is AcademySolverAction {
  return typeof action === "string" && actionCodes.includes(action);
}

/** "Допустимые действия: A или B" / "A, B или C" — generated from the node. */
function invalidSolverActionError(actionCodes: readonly string[]): AcademyValidationError {
  const list = actionCodes.length <= 2
    ? actionCodes.join(" или ")
    : `${actionCodes.slice(0, -1).join(", ")} или ${actionCodes[actionCodes.length - 1]}`;
  return new AcademyValidationError(`Допустимые действия: ${list}`);
}

function requireSolverSession(
  playerId: string | undefined,
  lessonCode: string,
  attemptId: string,
): readonly AcademySolverSessionQuestion[] {
  // The lesson → dataset → node binding is the only source of which strategy
  // a lesson trains; the catalog must agree that it is a frequency lesson.
  const binding = getAcademySolverLessonBinding(lessonCode);
  const catalogLesson = getAcademyLessonByCode(lessonCode);
  if (!binding || catalogLesson?.trainerKind !== "PREFLOP_RFI_FREQUENCY") {
    throw new AcademyValidationError("Неизвестный урок Solver Lab");
  }
  if (!UUID_PATTERN.test(attemptId)) {
    throw new AcademyValidationError("Некорректный идентификатор попытки");
  }
  if (typeof playerId !== "string" || playerId.length === 0) {
    throw new AcademyValidationError("Попытка Solver Lab требует авторизованного игрока");
  }
  return buildAcademySolverSessionForLesson({
    playerId,
    lessonCode: binding.lessonCode,
    attemptId,
  });
}

function requireQuestionIndex(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= ACADEMY_SOLVER_QUESTION_COUNT) {
    throw new AcademyValidationError(
      `Номер вопроса должен быть от 0 до ${ACADEMY_SOLVER_QUESTION_COUNT - 1}`,
    );
  }
  return value;
}

/**
 * One Solver Lab question, regenerated deterministically server-side. Returns
 * only `{hand, renderedCards, randomizerPercent, actions}` (actions = safe
 * display metadata of the node's actions) — never the frequencies or the
 * resolved action. Idempotent for the same (player, lesson, attempt, index).
 */
export function getAcademySolverQuestion(
  playerId: string,
  input: AcademySolverQuestionInput,
): AcademySolverPublicQuestion {
  const session = requireSolverSession(playerId, input.lessonCode, input.attemptId);
  return toPublicSolverQuestion(session[requireQuestionIndex(input.questionIndex)]);
}

/**
 * Post-answer reveal for one question: frequencies, resolved action and
 * whether the player's choice matched it. Purely informational — the score is
 * always recomputed from scratch by `verifyAcademySolverAttempt`.
 */
export function revealAcademySolverAnswer(
  playerId: string,
  input: AcademySolverRevealInput,
): AcademySolverQuestionReveal {
  const session = requireSolverSession(playerId, input.lessonCode, input.attemptId);
  const question = session[requireQuestionIndex(input.questionIndex)];
  const actionCodes = sessionActionCodes(session);
  if (!isSolverAction(input.selectedAction, actionCodes)) throw invalidSolverActionError(actionCodes);
  return {
    ...toPublicSolverQuestion(question),
    questionIndex: question.questionIndex,
    frequencies: question.frequencies,
    resolvedAction: question.resolvedAction,
    selectedAction: input.selectedAction,
    bucket: question.bucket,
    matchesResolvedAction: input.selectedAction === question.resolvedAction,
  };
}

/**
 * Server verifier for the Solver Lab frequency trainer.
 *
 * Trust model: the ONLY client input used is `selectedAction` per question
 * (answers[i] answers question i). The server re-derives, from
 * (playerId, lessonCode, attemptId) + SESSION_SECRET, which 10 hands were
 * shown, in which order, each hand's randomizer and resolved action. Any
 * client-sent hand/frequencies/correctAction/randomizerPercent/score is
 * ignored (a malformed or duplicated `hand` field is still rejected).
 *
 * Scoring: a question is correct iff `selectedAction` equals the resolved
 * action for that hand in this session — also for mixed hands, because the
 * randomizer outcome is the ground truth for that specific deal. Feedback copy
 * for mixed hands is non-judgmental (see lib/academy/solver-feedback.ts), but
 * that is presentation only. Pass/fail uses the shared ACADEMY_PASS_THRESHOLD
 * through `scoreTrainingSession`.
 */
export function verifyAcademySolverAttempt(
  input: SubmitAcademyAttemptInput,
  context: AcademyAttemptVerificationContext = {},
): AcademyTrainingResult {
  if (!getAcademySolverLessonBinding(input.lessonCode)) {
    throw new AcademyValidationError("Неизвестный урок Solver Lab");
  }
  if (!UUID_PATTERN.test(input.attemptId)) {
    throw new AcademyValidationError("Некорректный идентификатор попытки");
  }
  if (!Array.isArray(input.questions) || input.questions.length !== ACADEMY_SOLVER_QUESTION_COUNT) {
    throw new AcademyValidationError(
      `Завершённая тренировка должна содержать ${ACADEMY_SOLVER_QUESTION_COUNT} ответов`,
    );
  }

  const session = requireSolverSession(context.playerId, input.lessonCode, input.attemptId);
  if (new Set(session.map((question) => question.hand)).size !== session.length) {
    throw new Error("Solver Lab session invariant violated: duplicate hands");
  }

  const actionCodes = sessionActionCodes(session);
  const submittedHands = new Set<string>();
  let correctAnswers = 0;

  input.questions.forEach((rawAnswer, index) => {
    if (!rawAnswer || typeof rawAnswer !== "object") {
      throw new AcademyValidationError("Попытка содержит некорректный ответ");
    }
    const answer = rawAnswer as { questionIndex?: unknown; selectedAction?: unknown; hand?: unknown };
    if (answer.questionIndex !== undefined && answer.questionIndex !== index) {
      throw new AcademyValidationError("Ответы должны идти в порядке вопросов");
    }
    if (!isSolverAction(answer.selectedAction, actionCodes)) throw invalidSolverActionError(actionCodes);
    if (answer.hand !== undefined) {
      if (typeof answer.hand !== "string" || !isCanonicalStartingHand(answer.hand)) {
        throw new AcademyValidationError("Попытка содержит некорректную стартовую руку");
      }
      if (submittedHands.has(answer.hand)) {
        throw new AcademyValidationError("Стартовые руки в попытке не должны повторяться");
      }
      submittedHands.add(answer.hand);
    }

    if (answer.selectedAction === session[index].resolvedAction) correctAnswers += 1;
  });

  return scoreTrainingSession(correctAnswers, ACADEMY_SOLVER_QUESTION_COUNT);
}

// ---------------------------------------------------------------------------
// Configurable preflop trainer (PREFLOP_CONFIGURABLE_FREQUENCY)
//
// One lesson code for every spot. The selection (datasetId + nodeKey) is
// client-supplied, so it is validated against the real registry before any
// use (fail closed, never defaulted), and it is an HMAC input of the session
// so each node has its own deterministic session.
// ---------------------------------------------------------------------------

export type AcademyPreflopTrainerQuestionInput = {
  readonly datasetId: unknown;
  readonly nodeKey: unknown;
  readonly attemptId: string;
  readonly questionIndex: unknown;
};

export type AcademyPreflopTrainerRevealInput = AcademyPreflopTrainerQuestionInput & {
  readonly selectedAction: unknown;
};

function requirePreflopTrainerSession(
  playerId: string | undefined,
  datasetId: unknown,
  nodeKey: unknown,
  attemptId: string,
): readonly AcademyPreflopTrainerSessionQuestion[] {
  if (getAcademyLessonByCode(ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE)?.trainerKind !== "PREFLOP_CONFIGURABLE_FREQUENCY") {
    throw new Error("Academy catalog is missing the configurable preflop trainer");
  }
  if (!UUID_PATTERN.test(attemptId)) {
    throw new AcademyValidationError("Некорректный идентификатор попытки");
  }
  if (typeof playerId !== "string" || playerId.length === 0) {
    throw new AcademyValidationError("Попытка тренажёра требует авторизованного игрока");
  }
  try {
    return buildAcademyPreflopTrainerSession({
      playerId,
      attemptId,
      datasetId: datasetId as string,
      nodeKey: nodeKey as string,
    });
  } catch (error) {
    if (error instanceof AcademyPreflopTrainerSelectionError) throw new AcademyValidationError(error.message);
    throw error;
  }
}

/** One configurable-trainer question (answer-free), regenerated server-side. */
export function getAcademyPreflopTrainerQuestion(
  playerId: string,
  input: AcademyPreflopTrainerQuestionInput,
): AcademyPreflopTrainerPublicQuestion {
  const session = requirePreflopTrainerSession(playerId, input.datasetId, input.nodeKey, input.attemptId);
  return toPublicPreflopTrainerQuestion(session[requireQuestionIndex(input.questionIndex)]);
}

/** Post-answer reveal: exact node frequencies, resolved action, match flag. */
export function revealAcademyPreflopTrainerAnswer(
  playerId: string,
  input: AcademyPreflopTrainerRevealInput,
): AcademyPreflopTrainerReveal {
  const session = requirePreflopTrainerSession(playerId, input.datasetId, input.nodeKey, input.attemptId);
  const question = session[requireQuestionIndex(input.questionIndex)];
  const actionCodes = question.actions.map((action) => action.code);
  if (!isSolverAction(input.selectedAction, actionCodes)) throw invalidSolverActionError(actionCodes);
  return {
    ...toPublicPreflopTrainerQuestion(question),
    questionIndex: question.questionIndex,
    frequencies: question.frequencies,
    resolvedAction: question.resolvedAction,
    selectedAction: input.selectedAction,
    bucket: question.bucket,
    matchesResolvedAction: input.selectedAction === question.resolvedAction,
  };
}

/**
 * Server verifier for the configurable preflop trainer. Every answer carries
 * the same `{datasetId, nodeKey}` selection (validated against the registry;
 * mixed or forged selections are rejected) plus `selectedAction`, the only
 * scored input. The session is re-derived from (playerId, attemptId,
 * datasetId, nodeKey) + SESSION_SECRET; scoring is identical to the 100bb
 * Solver Lab trainer (match against the resolved action).
 */
export function verifyAcademyPreflopTrainerAttempt(
  input: SubmitAcademyAttemptInput,
  context: AcademyAttemptVerificationContext = {},
): AcademyTrainingResult {
  if (input.lessonCode !== ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE) {
    throw new AcademyValidationError("Неизвестный урок тренажёра");
  }
  if (!UUID_PATTERN.test(input.attemptId)) {
    throw new AcademyValidationError("Некорректный идентификатор попытки");
  }
  if (!Array.isArray(input.questions) || input.questions.length !== ACADEMY_SOLVER_QUESTION_COUNT) {
    throw new AcademyValidationError(
      `Завершённая тренировка должна содержать ${ACADEMY_SOLVER_QUESTION_COUNT} ответов`,
    );
  }
  const answers = input.questions.map((rawAnswer) => {
    if (!rawAnswer || typeof rawAnswer !== "object") {
      throw new AcademyValidationError("Попытка содержит некорректный ответ");
    }
    return rawAnswer as { questionIndex?: unknown; selectedAction?: unknown; datasetId?: unknown; nodeKey?: unknown };
  });
  const { datasetId, nodeKey } = answers[0];
  if (answers.some((answer) => answer.datasetId !== datasetId || answer.nodeKey !== nodeKey)) {
    throw new AcademyValidationError("Все ответы попытки должны относиться к одной ситуации");
  }

  const session = requirePreflopTrainerSession(context.playerId, datasetId, nodeKey, input.attemptId);
  if (new Set(session.map((question) => question.hand)).size !== session.length) {
    throw new Error("Preflop trainer session invariant violated: duplicate hands");
  }
  const actionCodes = session[0].actions.map((action) => action.code);
  let correctAnswers = 0;
  answers.forEach((answer, index) => {
    if (answer.questionIndex !== undefined && answer.questionIndex !== index) {
      throw new AcademyValidationError("Ответы должны идти в порядке вопросов");
    }
    if (!isSolverAction(answer.selectedAction, actionCodes)) throw invalidSolverActionError(actionCodes);
    if (answer.selectedAction === session[index].resolvedAction) correctAnswers += 1;
  });
  return scoreTrainingSession(correctAnswers, ACADEMY_SOLVER_QUESTION_COUNT);
}

export type AcademyAttemptVerifier = (
  input: SubmitAcademyAttemptInput,
  context?: AcademyAttemptVerificationContext,
) => AcademyTrainingResult;

/** Trainer kinds of practice activities (see `ACADEMY_PRACTICE_ACTIVITIES`). */
type AcademyPracticeTrainerKind = "PREFLOP_CONFIGURABLE_FREQUENCY";

/**
 * Trainer registry: one server-authoritative verifier per trainer kind of the
 * catalog's module lessons.
 */
export const ACADEMY_TRAINER_VERIFIERS: Readonly<Record<Exclude<AcademyTrainerKind, AcademyPracticeTrainerKind>, AcademyAttemptVerifier>> =
  Object.freeze({
    PREFLOP_RFI_BINARY: verifyAcademyTrainingAttempt,
    PREFLOP_RFI_FREQUENCY: verifyAcademySolverAttempt,
  });

/** Verifiers of practice-activity trainer kinds (same contract, separate registry). */
export const ACADEMY_PRACTICE_TRAINER_VERIFIERS: Readonly<Record<AcademyPracticeTrainerKind, AcademyAttemptVerifier>> =
  Object.freeze({
    PREFLOP_CONFIGURABLE_FREQUENCY: verifyAcademyPreflopTrainerAttempt,
  });

function lookupAcademyAttemptVerifier(trainerKind: string): AcademyAttemptVerifier | undefined {
  for (const registry of [ACADEMY_TRAINER_VERIFIERS, ACADEMY_PRACTICE_TRAINER_VERIFIERS] as const) {
    if (Object.prototype.hasOwnProperty.call(registry, trainerKind)) {
      return (registry as Readonly<Record<string, AcademyAttemptVerifier>>)[trainerKind];
    }
  }
  return undefined;
}

/** Dispatches attempt verification by the catalog lesson's trainer kind. */
export function verifyAcademyAttempt(
  lesson: AcademyLesson,
  input: SubmitAcademyAttemptInput,
  context: AcademyAttemptVerificationContext = {},
): AcademyTrainingResult {
  if (input.lessonCode !== lesson.code) {
    throw new AcademyValidationError("Попытка не относится к этому уроку Academy");
  }
  const verifier = lookupAcademyAttemptVerifier(lesson.trainerKind);
  if (!verifier) throw new AcademyValidationError("Неподдерживаемый тип тренажёра Academy");
  return verifier(input, context);
}

export async function submitAcademyTrainingAttempt(
  playerId: string,
  input: SubmitAcademyAttemptInput,
  repository: AcademyProgressRepository = academyProgressRepository,
): Promise<SubmitAcademyAttemptResult> {
  const lesson = getAcademyLessonByCode(input.lessonCode);
  if (!lesson) throw new AcademyValidationError("Неизвестный урок Academy");

  const result = verifyAcademyAttempt(lesson, input, { playerId });
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
