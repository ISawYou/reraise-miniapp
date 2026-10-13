/**
 * Academy navigation routes (client-safe, tiny). Kept apart from
 * `config/academy/navigation.ts` (destination / trainer-entry copy) so that
 * trainer screens can link back without bundling the landing's content;
 * `navigation.ts` re-exports everything here.
 */
import { ACADEMY_SOLVER_PREFLOP_TRAINER_ROUTE } from "@/config/academy/preflop-trainer";
import { ACADEMY_SOLVER_PUSH_FOLD_ROUTE } from "@/config/academy/push-fold-trainer";

export const ACADEMY_HOME_ROUTE = "/academy";
export const ACADEMY_BEGINNER_ROUTE = "/academy/beginner";
/** "Новичкам · Шаг 2" section — where beginner-curriculum trainers and spot pages lead back to. */
export const ACADEMY_BEGINNER_STEP2_ROUTE = `${ACADEMY_BEGINNER_ROUTE}#step-2`;
export const ACADEMY_INTERMEDIATE_ROUTE = "/academy/intermediate";
export const ACADEMY_ADVANCED_ROUTE = "/academy/advanced";
export const ACADEMY_TRAINERS_ROUTE = "/academy/trainers";

/**
 * Manual spot pickers. The `#setup` fragment only scrolls to / opens the
 * picker section of the existing trainer home — same route, same component.
 */
export const ACADEMY_PREFLOP_SETUP_HASH = "setup";
export const ACADEMY_PREFLOP_SETUP_ROUTE = `${ACADEMY_SOLVER_PREFLOP_TRAINER_ROUTE}#${ACADEMY_PREFLOP_SETUP_HASH}`;
export const ACADEMY_PUSH_FOLD_SETUP_ROUTE = `${ACADEMY_SOLVER_PUSH_FOLD_ROUTE}#${ACADEMY_PREFLOP_SETUP_HASH}`;
