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
import { ACADEMY_PREFLOP_LESSONS } from "@/config/academy/lessons";
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

export const ACADEMY_BASE_MTT_COURSE_CODE = "base_mtt";
export const ACADEMY_PREFLOP_OPEN_RAISE_MODULE_CODE = "preflop_open_raise_100bb";
export const ACADEMY_SOLVER_LAB_COURSE_CODE = "solver_lab";
export const ACADEMY_SOLVER_RFI_MODULE_CODE = "preflop_rfi_9max_100bb";

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

export function getAcademyLessonByCode(lessonCode: string): AcademyLesson | null {
  return LESSON_CONTEXT_BY_CODE.get(lessonCode)?.lesson ?? null;
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
