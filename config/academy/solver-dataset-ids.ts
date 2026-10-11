/**
 * Registered strategy dataset ids, kept in a dependency-free module so that
 * lesson bindings (and client components that import them) never pull the
 * dataset payloads into a bundle. Ids are immutable versions: never rename.
 */
export const ACADEMY_HRC_SCENARIO_B_RFI_100BB_DATASET_ID = "hrc_scenario_b_rfi_9max_100bb_v1";

/**
 * External MTT preflop reference datasets (EXTERNAL_REFERENCE_UNVERIFIED,
 * third-party data — see data/academy/reference/mtt-preflop/MANIFEST.json).
 * Registry-only: intentionally NOT bound to any lesson.
 */
export const ACADEMY_EXTERNAL_MTT_PREFLOP_5BB_DATASET_ID = "external_mtt_preflop_9max_5bb_v1";
export const ACADEMY_EXTERNAL_MTT_PREFLOP_10BB_DATASET_ID = "external_mtt_preflop_9max_10bb_v1";
export const ACADEMY_EXTERNAL_MTT_PREFLOP_20BB_DATASET_ID = "external_mtt_preflop_9max_20bb_v1";
export const ACADEMY_EXTERNAL_MTT_PREFLOP_40BB_DATASET_ID = "external_mtt_preflop_9max_40bb_v1";
export const ACADEMY_EXTERNAL_MTT_PREFLOP_100BB_DATASET_ID = "external_mtt_preflop_9max_100bb_v1";

/**
 * HoldemMath push/fold datasets (EXTERNAL_REFERENCE_LICENSED, CC BY 4.0 —
 * see data/academy/reference/holdemmath-pushfold/MANIFEST.json). One dataset
 * per (9-max depth, ante variant). Registered in their OWN registry
 * (`config/academy/push-fold-datasets.ts`), never in `ACADEMY_STRATEGY_DATASETS`.
 */
export const ACADEMY_HOLDEMMATH_PUSH_FOLD_DEPTHS_BB = Object.freeze([4, 6, 8, 10, 12, 15, 20] as const);
export type AcademyHoldemMathPushFoldDepthBb = (typeof ACADEMY_HOLDEMMATH_PUSH_FOLD_DEPTHS_BB)[number];

/** `ante10` = upstream `dataAnte10` (0.1 BB per player), `noante` = upstream `data`. */
export type AcademyHoldemMathPushFoldAnteVariant = "ante10" | "noante";

/** e.g. `holdemmath_pushfold_9max_10bb_ante10_v1`. Immutable once shipped. */
export function holdemMathPushFoldDatasetId(
  depthBb: AcademyHoldemMathPushFoldDepthBb,
  variant: AcademyHoldemMathPushFoldAnteVariant,
): string {
  return `holdemmath_pushfold_9max_${depthBb}bb_${variant}_v1`;
}
