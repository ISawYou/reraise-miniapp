/**
 * Solver Lab "Push/Fold" trainer — identity, routes and dataset whitelist.
 * Dependency-free (no dataset payloads), so client components and the
 * catalog may import it.
 *
 * ONE stable lesson code covers the whole Push/Fold module (every stack /
 * seat / family, fixed-node and Quick): attempts record under
 * `ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE` in the existing
 * `academy_lesson_progress` / `academy_training_attempts` tables (text
 * lesson_code, no migration). Never rename this code.
 *
 * The whitelist below is DISJOINT from `ACADEMY_PREFLOP_TRAINER_DATASET_IDS`
 * (MTT preflop trainer) and never contains the HRC dataset.
 */
import { holdemMathPushFoldDatasetId } from "@/config/academy/solver-dataset-ids";

export const ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE = "solver_push_fold_trainer";

export const ACADEMY_SOLVER_PUSH_FOLD_ROUTE = "/academy/solver/push-fold";

/**
 * Player-facing stacks of this release. 20 BB is imported (internal
 * validation only) but intentionally NOT offered to players yet.
 */
export const ACADEMY_PUSH_FOLD_PLAYER_STACKS_BB = Object.freeze([4, 6, 8, 10, 12, 15] as const);

/**
 * The ONLY datasets the Push/Fold trainer may serve: the 0.1 BB ante
 * (`dataAnte10`) variant at the player-facing stacks. The no-ante variant and
 * 20 BB are registered but never reachable from a player route.
 */
export const ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS: readonly string[] = Object.freeze(
  ACADEMY_PUSH_FOLD_PLAYER_STACKS_BB.map((stackBb) => holdemMathPushFoldDatasetId(stackBb, "ante10")),
);

/** Marker carried by every answer of a "Быстрая Push/Fold тренировка" attempt. */
export const ACADEMY_PUSH_FOLD_QUICK_MODE = "PUSH_FOLD_QUICK" as const;

export const ACADEMY_PUSH_FOLD_QUICK_ROUTE = `${ACADEMY_SOLVER_PUSH_FOLD_ROUTE}/mix`;

/** Study page of one node: `/academy/solver/push-fold/<stack>/<node_key lower-case>`. */
export function pushFoldSpotRoute(stackBb: number, nodeKey: string): string {
  return `${ACADEMY_SOLVER_PUSH_FOLD_ROUTE}/${stackBb}/${nodeKey.toLowerCase()}`;
}

export function pushFoldTrainRoute(stackBb: number, nodeKey: string): string {
  return `${pushFoldSpotRoute(stackBb, nodeKey)}/train`;
}

/**
 * CC BY 4.0 attribution (license obligation). The LICENSE-DATA file's own
 * suggested attribution is "Data source: HoldemMath — https://holdemmath.com/";
 * the player-facing line below is its Russian rendering and always links to
 * `ACADEMY_PUSH_FOLD_ATTRIBUTION_URL`.
 */
export const ACADEMY_PUSH_FOLD_ATTRIBUTION_URL = "https://holdemmath.com/";
export const ACADEMY_PUSH_FOLD_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
export const ACADEMY_PUSH_FOLD_ATTRIBUTION_SOURCE_TEXT = "Data source: HoldemMath — https://holdemmath.com/";
