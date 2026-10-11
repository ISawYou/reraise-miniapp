/**
 * Academy catalog — the single source of truth for COURSE → MODULE → LESSON.
 *
 * Layering (keep these separate):
 * - Catalog (this file): presentation and structure only — which courses,
 *   modules and lessons exist, their order, copy, routes, and which lesson /
 *   trainer kind each lesson uses. Progress math and admin counts derive lesson
 *   collections from here; no UI should re-count lessons on its own.
 * - Trainer (`AcademyTrainerKind`, verifiers registered in
 *   `features/academy.ts`): interaction and server-side answer validation for a
 *   lesson. A new trainer kind plugs in by adding a kind + verifier, without
 *   touching course/progress plumbing.
 * - Strategy dataset: the answer source for solver-backed trainers. Current
 *   (only) dataset: the frozen HRC-backed 9-max 100bb RFI reference in
 *   `config/academy/preflop-ranges.ts`. Future strategy datasets must be
 *   versioned and carry provenance (source, scenario, assumptions) the way
 *   `AcademyPreflopRange.source` does. Solver Lab's versioned dataset
 *   (`config/academy/solver-datasets.ts`) is derived from that same reference
 *   — no new external data.
 *
 * Lesson codes are persisted in `academy_lesson_progress` /
 * `academy_training_attempts`; a catalog lesson code must never be renamed.
 * The preflop lessons below are derived from `ACADEMY_PREFLOP_LESSONS` — the
 * one place their codes/copy physically live.
 */
import {
  ACADEMY_BASE_MTT_COURSE_CODE,
  ACADEMY_PREFLOP_OPEN_RAISE_MODULE_CODE,
  ACADEMY_SOLVER_LAB_COURSE_CODE,
  ACADEMY_SOLVER_RFI_MODULE_CODE,
} from "@/config/academy/catalog-codes";
import { ACADEMY_PREFLOP_LESSONS } from "@/config/academy/lessons";
import {
  ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE,
  ACADEMY_SOLVER_PREFLOP_TRAINER_ROUTE,
} from "@/config/academy/preflop-trainer";
import {
  ACADEMY_SOLVER_PUSH_FOLD_ROUTE,
  ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE,
} from "@/config/academy/push-fold-trainer";
import {
  ACADEMY_SOLVER_RFI_LESSONS,
  ACADEMY_SOLVER_RFI_MODULE_ROUTE,
} from "@/config/academy/solver-lessons";
import { ACADEMY_PREFLOP_POSITIONS } from "@/lib/academy/preflop";
import type {
  AcademyCourse,
  AcademyLesson,
  AcademyLessonCode,
  AcademyModule,
} from "@/types/academy";

// Codes live in a dependency-free module (light client imports); same values.
export {
  ACADEMY_BASE_MTT_COURSE_CODE,
  ACADEMY_PREFLOP_OPEN_RAISE_MODULE_CODE,
  ACADEMY_SOLVER_LAB_COURSE_CODE,
  ACADEMY_SOLVER_RFI_MODULE_CODE,
};

const PREFLOP_OPEN_RAISE_LESSONS: readonly AcademyLesson[] = Object.freeze(
  ACADEMY_PREFLOP_POSITIONS.map((position, index): AcademyLesson => {
    const lesson = ACADEMY_PREFLOP_LESSONS[position];
    return Object.freeze({
      code: lesson.code,
      title: lesson.displayLabel,
      subtitle: `${position !== lesson.displayLabel ? `${position} · ` : ""}${lesson.fullName}`,
      description: lesson.theory[0],
      order: index + 1,
      route: `/academy/preflop/${position.toLowerCase()}`,
      lessonKind: "PREFLOP_RFI",
      trainerKind: "PREFLOP_RFI_BINARY",
    });
  }),
);

// Solver Lab (Phase 2A): frequency-aware RFI lessons. New, never-reused codes
// (`solver_rfi_9max_100bb_*`) so База MTT progress is never affected.
const SOLVER_RFI_LESSONS: readonly AcademyLesson[] = Object.freeze(
  ACADEMY_PREFLOP_POSITIONS.map((position, index): AcademyLesson => {
    const copy = ACADEMY_PREFLOP_LESSONS[position];
    const solverLesson = ACADEMY_SOLVER_RFI_LESSONS[position];
    return Object.freeze({
      code: solverLesson.code,
      title: copy.displayLabel,
      subtitle: `${position !== copy.displayLabel ? `${position} · ` : ""}${copy.fullName}`,
      description:
        `Солверные частоты первого входа с ${copy.displayLabel}: какие руки рейзим всегда, ` +
        "какие всегда сбрасываем, а где стратегия смешанная.",
      order: index + 1,
      route: solverLesson.route,
      lessonKind: "PREFLOP_RFI",
      trainerKind: "PREFLOP_RFI_FREQUENCY",
    });
  }),
);

export const ACADEMY_CATALOG: readonly AcademyCourse[] = Object.freeze([
  Object.freeze({
    code: ACADEMY_BASE_MTT_COURSE_CODE,
    title: "База MTT",
    description:
      "Базовые навыки турнирного покера: позиции, префлоп и фундамент принятия решений.",
    order: 1,
    modules: Object.freeze([
      Object.freeze({
        code: ACADEMY_PREFLOP_OPEN_RAISE_MODULE_CODE,
        title: "Open Raise · 100 BB",
        description: "Диапазоны первого входа в банк с разных позиций за полным столом.",
        order: 1,
        route: "/academy/preflop",
        lessons: PREFLOP_OPEN_RAISE_LESSONS,
      }),
    ]),
  }),
  Object.freeze({
    code: ACADEMY_SOLVER_LAB_COURSE_CODE,
    title: "Solver Lab",
    description:
      "Частотная стратегия по солверным данным: смешанные решения, рандомайзер и баланс диапазона.",
    order: 2,
    modules: Object.freeze([
      Object.freeze({
        code: ACADEMY_SOLVER_RFI_MODULE_CODE,
        title: "RFI · 9-max · 100 BB",
        description: "Частоты первого входа в банк по данным HRC Scenario B: рейз 2.25 BB или фолд.",
        order: 1,
        route: ACADEMY_SOLVER_RFI_MODULE_ROUTE,
        lessons: SOLVER_RFI_LESSONS,
      }),
    ]),
  }),
]);

/**
 * Practice activities: lessons attached to a course that are trained and
 * recorded like any lesson (same tables, same verifier registry) but are NOT
 * part of the course's module lesson list, so they never change a course's
 * lesson count / progress percent. Solver Lab's configurable preflop trainer
 * is one such activity: ONE stable lesson code for every spot it can train.
 */
export type AcademyPracticeActivity = {
  readonly courseCode: string;
  readonly lesson: AcademyLesson;
};

export const ACADEMY_PRACTICE_ACTIVITIES: readonly AcademyPracticeActivity[] = Object.freeze([
  Object.freeze({
    courseCode: ACADEMY_SOLVER_LAB_COURSE_CODE,
    lesson: Object.freeze({
      code: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE,
      title: "Префлоп-тренажёр",
      subtitle: "5–100 BB · первый вход, защита блайндов, 3-бет и дальше",
      description:
        "Выбери стек, ситуацию и позиции — и тренируй частоты стратегии именно в этом споте.",
      order: 1,
      route: ACADEMY_SOLVER_PREFLOP_TRAINER_ROUTE,
      lessonKind: "PREFLOP_TRAINER",
      trainerKind: "PREFLOP_CONFIGURABLE_FREQUENCY",
    } satisfies AcademyLesson),
  }),
]);

/** Practice activities of one course, in order. */
export function listAcademyCoursePracticeActivities(courseCode: string): readonly AcademyLesson[] {
  return ACADEMY_PRACTICE_ACTIVITIES
    .filter((activity) => activity.courseCode === courseCode)
    .map((activity) => activity.lesson);
}

/**
 * Additional practice activities: exactly the same kind of entry as
 * `ACADEMY_PRACTICE_ACTIVITIES` (recorded under one stable lesson code,
 * resolvable via `getAcademyLessonByCode`, verified through the practice
 * verifier registry, never counted in a course's lesson totals), kept in a
 * second list so that the established contract of
 * `listAcademyCoursePracticeActivities` (Solver Lab → the preflop trainer
 * only) is unchanged. "Тренажёры" (/academy/trainers, config/academy/navigation.ts)
 * presents both lists' activities.
 *
 * Solver Lab "Push/Fold": ONE stable lesson code for every stack / seat /
 * family and both modes (HoldemMath push/fold charts, CC BY 4.0).
 */
export const ACADEMY_ADDITIONAL_PRACTICE_ACTIVITIES: readonly AcademyPracticeActivity[] = Object.freeze([
  Object.freeze({
    courseCode: ACADEMY_SOLVER_LAB_COURSE_CODE,
    lesson: Object.freeze({
      code: ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE,
      title: "Push/Fold",
      subtitle: "4–15 BB · пуш первым и колл олл-ина",
      description:
        "Короткий стек: когда идти олл-ин первым и когда коллировать чужой пуш — по таблицам Push/Fold.",
      order: 2,
      route: ACADEMY_SOLVER_PUSH_FOLD_ROUTE,
      lessonKind: "PUSH_FOLD_TRAINER",
      trainerKind: "PUSH_FOLD_PURE",
    } satisfies AcademyLesson),
  }),
]);

/** Additional practice activities of one course, in order. */
export function listAcademyCourseAdditionalPracticeActivities(courseCode: string): readonly AcademyLesson[] {
  return ACADEMY_ADDITIONAL_PRACTICE_ACTIVITIES
    .filter((activity) => activity.courseCode === courseCode)
    .map((activity) => activity.lesson);
}

const PRACTICE_LESSON_BY_CODE: ReadonlyMap<AcademyLessonCode, AcademyLesson> = new Map(
  [...ACADEMY_PRACTICE_ACTIVITIES, ...ACADEMY_ADDITIONAL_PRACTICE_ACTIVITIES]
    .map((activity) => [activity.lesson.code, activity.lesson] as const),
);

export type AcademyLessonContext = {
  readonly course: AcademyCourse;
  readonly module: AcademyModule;
  readonly lesson: AcademyLesson;
};

const LESSON_CONTEXT_BY_CODE: ReadonlyMap<AcademyLessonCode, AcademyLessonContext> = new Map(
  ACADEMY_CATALOG.flatMap((course) =>
    course.modules.flatMap((courseModule) =>
      courseModule.lessons.map((lesson) => [lesson.code, { course, module: courseModule, lesson }] as const),
    ),
  ),
);

export class AcademyUnknownLessonError extends Error {
  constructor(readonly lessonCode: string) {
    super(`Unknown Academy lesson code: ${lessonCode}`);
    this.name = "AcademyUnknownLessonError";
  }
}

export function listAcademyCourses(): readonly AcademyCourse[] {
  return ACADEMY_CATALOG;
}

export function getAcademyCourse(courseCode: string): AcademyCourse | null {
  return ACADEMY_CATALOG.find((course) => course.code === courseCode) ?? null;
}

export function getAcademyModule(moduleCode: string): AcademyModule | null {
  for (const course of ACADEMY_CATALOG) {
    const courseModule = course.modules.find((candidate) => candidate.code === moduleCode);
    if (courseModule) return courseModule;
  }
  return null;
}

export function getAcademyLessonContext(lessonCode: string): AcademyLessonContext | null {
  return LESSON_CONTEXT_BY_CODE.get(lessonCode) ?? null;
}

/**
 * Any recordable lesson: a module lesson of the catalog or a practice
 * activity. Unknown codes → null (callers fail closed).
 */
export function getAcademyLessonByCode(lessonCode: string): AcademyLesson | null {
  return LESSON_CONTEXT_BY_CODE.get(lessonCode)?.lesson ?? PRACTICE_LESSON_BY_CODE.get(lessonCode) ?? null;
}

/** Fail-closed lookup: throws for any code not present in the catalog. */
export function requireAcademyLesson(lessonCode: string): AcademyLesson {
  const lesson = getAcademyLessonByCode(lessonCode);
  if (!lesson) throw new AcademyUnknownLessonError(lessonCode);
  return lesson;
}

export function listAcademyCourseLessons(course: AcademyCourse): readonly AcademyLesson[] {
  return course.modules.flatMap((courseModule) => courseModule.lessons);
}

export function listAcademyModuleLessonCodes(courseModule: AcademyModule): readonly AcademyLessonCode[] {
  return courseModule.lessons.map((lesson) => lesson.code);
}

export function listAcademyCourseLessonCodes(course: AcademyCourse): readonly AcademyLessonCode[] {
  return listAcademyCourseLessons(course).map((lesson) => lesson.code);
}

export function listAllAcademyLessonCodes(): readonly AcademyLessonCode[] {
  return Array.from(LESSON_CONTEXT_BY_CODE.keys());
}

/**
 * The course whose single-course payload `GET /api/academy/progress` has always
 * returned at its top level. Must stay База MTT (backward compatibility).
 */
export function getPrimaryAcademyCourse(): AcademyCourse {
  return ACADEMY_CATALOG[0];
}
