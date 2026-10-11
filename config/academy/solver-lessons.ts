/**
 * Solver Lab lesson identities. These codes are persisted in
 * `academy_lesson_progress` / `academy_training_attempts` once a player trains,
 * so they must never be renamed. They are distinct from (and never reuse) the
 * База MTT `preflop_rfi_9max_100bb_*` codes.
 */
import { ACADEMY_HRC_SCENARIO_B_RFI_100BB_DATASET_ID } from "@/config/academy/solver-dataset-ids";
import { ACADEMY_PREFLOP_POSITIONS } from "@/lib/academy/preflop";
import type { AcademySolverLessonBinding, PreflopPosition } from "@/types/academy";

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

// ---------------------------------------------------------------------------
// Lesson → dataset → node bindings (canonical, explicit)
//
// The ONE source of truth for which strategy a Solver Lab lesson trains. The
// dataset and node are declared here explicitly — never inferred from the
// lesson code, route or URL text. Every binding must resolve in the dataset
// registry (enforced by tests and, at runtime, fail-closed lookups).
// ---------------------------------------------------------------------------

const HRC_RFI_100BB = ACADEMY_HRC_SCENARIO_B_RFI_100BB_DATASET_ID;

export const ACADEMY_SOLVER_LESSON_BINDINGS: readonly AcademySolverLessonBinding[] = Object.freeze([
  { lessonCode: "solver_rfi_9max_100bb_utg", datasetId: HRC_RFI_100BB, selector: { nodeKey: "UTG" }, primaryActionCode: "RAISE_2_25BB" },
  { lessonCode: "solver_rfi_9max_100bb_ep", datasetId: HRC_RFI_100BB, selector: { nodeKey: "EP" }, primaryActionCode: "RAISE_2_25BB" },
  { lessonCode: "solver_rfi_9max_100bb_mp1", datasetId: HRC_RFI_100BB, selector: { nodeKey: "MP1" }, primaryActionCode: "RAISE_2_25BB" },
  { lessonCode: "solver_rfi_9max_100bb_mp2", datasetId: HRC_RFI_100BB, selector: { nodeKey: "MP2" }, primaryActionCode: "RAISE_2_25BB" },
  { lessonCode: "solver_rfi_9max_100bb_hj", datasetId: HRC_RFI_100BB, selector: { nodeKey: "HJ" }, primaryActionCode: "RAISE_2_25BB" },
  { lessonCode: "solver_rfi_9max_100bb_co", datasetId: HRC_RFI_100BB, selector: { nodeKey: "CO" }, primaryActionCode: "RAISE_2_25BB" },
  { lessonCode: "solver_rfi_9max_100bb_btn", datasetId: HRC_RFI_100BB, selector: { nodeKey: "BTN" }, primaryActionCode: "RAISE_2_25BB" },
].map((binding) => Object.freeze({ ...binding, selector: Object.freeze(binding.selector) })));

export function getAcademySolverLessonBinding(lessonCode: string): AcademySolverLessonBinding | null {
  return ACADEMY_SOLVER_LESSON_BINDINGS.find((binding) => binding.lessonCode === lessonCode) ?? null;
}
