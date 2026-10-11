/**
 * Stable catalog course / module codes, in a dependency-free module so that
 * light client code (e.g. `config/academy/navigation.ts`, imported by the
 * trainer screens) can name a course without bundling the whole catalog and
 * its lesson copy. `config/academy/catalog.ts` re-exports these unchanged.
 * Persisted / referenced values — never rename.
 */
export const ACADEMY_BASE_MTT_COURSE_CODE = "base_mtt";
export const ACADEMY_PREFLOP_OPEN_RAISE_MODULE_CODE = "preflop_open_raise_100bb";
export const ACADEMY_SOLVER_LAB_COURSE_CODE = "solver_lab";
export const ACADEMY_SOLVER_RFI_MODULE_CODE = "preflop_rfi_9max_100bb";
