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
