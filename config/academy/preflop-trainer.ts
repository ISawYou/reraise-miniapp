/**
 * Configurable Solver Lab preflop trainer ("Префлоп-тренажёр") — identity
 * and dataset whitelist. Dependency-free (no dataset payloads), so client
 * components and the catalog may import it.
 *
 * ONE stable lesson code covers the whole configurable trainer: every
 * (stack, situation, hero, villain) selection records its attempts under
 * `ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE` in the existing
 * `academy_lesson_progress` / `academy_training_attempts` tables (text
 * lesson_code, no migration). The chosen node travels inside each submitted
 * answer and is re-validated server-side. Never rename this code.
 */
import {
  ACADEMY_EXTERNAL_MTT_PREFLOP_100BB_DATASET_ID,
  ACADEMY_EXTERNAL_MTT_PREFLOP_10BB_DATASET_ID,
  ACADEMY_EXTERNAL_MTT_PREFLOP_20BB_DATASET_ID,
  ACADEMY_EXTERNAL_MTT_PREFLOP_40BB_DATASET_ID,
  ACADEMY_EXTERNAL_MTT_PREFLOP_5BB_DATASET_ID,
} from "@/config/academy/solver-dataset-ids";

export const ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE = "solver_preflop_trainer";

export const ACADEMY_SOLVER_PREFLOP_TRAINER_ROUTE = "/academy/solver/preflop";

/**
 * The ONLY datasets the configurable trainer may serve. Any other dataset id
 * (including the HRC 100bb RFI dataset bound to the 7 Solver Lab lessons) is
 * rejected, fail closed.
 */
export const ACADEMY_PREFLOP_TRAINER_DATASET_IDS: readonly string[] = Object.freeze([
  ACADEMY_EXTERNAL_MTT_PREFLOP_5BB_DATASET_ID,
  ACADEMY_EXTERNAL_MTT_PREFLOP_10BB_DATASET_ID,
  ACADEMY_EXTERNAL_MTT_PREFLOP_20BB_DATASET_ID,
  ACADEMY_EXTERNAL_MTT_PREFLOP_40BB_DATASET_ID,
  ACADEMY_EXTERNAL_MTT_PREFLOP_100BB_DATASET_ID,
]);

/** Spot page route for one node: `/academy/solver/preflop/<stack>/<node_key lower-case>`. */
export function preflopTrainerSpotRoute(stackBb: number, nodeKey: string): string {
  return `${ACADEMY_SOLVER_PREFLOP_TRAINER_ROUTE}/${stackBb}/${nodeKey.toLowerCase()}`;
}

export function preflopTrainerTrainRoute(stackBb: number, nodeKey: string): string {
  return `${preflopTrainerSpotRoute(stackBb, nodeKey)}/train`;
}
