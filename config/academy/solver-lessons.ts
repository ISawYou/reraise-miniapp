/**
 * Solver Lab lesson identities. These codes are persisted in
 * `academy_lesson_progress` / `academy_training_attempts` once a player trains,
 * so they must never be renamed. They are distinct from (and never reuse) the
 * База MTT `preflop_rfi_9max_100bb_*` codes.
 */
import { ACADEMY_PREFLOP_POSITIONS } from "@/lib/academy/preflop";
import type { PreflopPosition } from "@/types/academy";

export type AcademySolverRfiLessonCode = `solver_rfi_9max_100bb_${Lowercase<PreflopPosition>}`;

export type AcademySolverRfiLesson = {
  readonly code: AcademySolverRfiLessonCode;
  readonly position: PreflopPosition;
  readonly route: string;
  readonly trainRoute: string;
};

export const ACADEMY_SOLVER_RFI_MODULE_ROUTE = "/academy/solver/rfi/100bb";

export const ACADEMY_SOLVER_RFI_LESSONS: Readonly<Record<PreflopPosition, AcademySolverRfiLesson>> =
  Object.freeze(Object.fromEntries(ACADEMY_PREFLOP_POSITIONS.map((position) => {
    const slug = position.toLowerCase() as Lowercase<PreflopPosition>;
    const route = `${ACADEMY_SOLVER_RFI_MODULE_ROUTE}/${slug}`;
    return [position, Object.freeze({
      code: `solver_rfi_9max_100bb_${slug}` as AcademySolverRfiLessonCode,
      position,
      route,
      trainRoute: `${route}/train`,
    })];
  })) as Record<PreflopPosition, AcademySolverRfiLesson>);

export function getAcademySolverRfiLesson(position: PreflopPosition): AcademySolverRfiLesson {
  return ACADEMY_SOLVER_RFI_LESSONS[position];
}

export function getAcademySolverRfiLessonByCode(lessonCode: string): AcademySolverRfiLesson | null {
  return ACADEMY_PREFLOP_POSITIONS
    .map((position) => ACADEMY_SOLVER_RFI_LESSONS[position])
    .find((lesson) => lesson.code === lessonCode) ?? null;
}
