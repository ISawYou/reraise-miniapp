/**
 * Academy navigation — PRESENTATION ONLY (client-safe, no data).
 *
 * The player-facing Academy is organised around four plain destinations:
 * "Новичкам", "Продолжающим", "Продвинутым" and "Тренажёры". This file maps
 * those destinations onto content that already exists in the catalog
 * (`config/academy/catalog.ts`); it never creates courses, modules, lessons
 * or lesson codes, and it changes no existing route. Course / module / lesson
 * codes, progress plumbing and every historical URL stay exactly as they are:
 * - Новичкам      → База MTT · Open Raise module (`/academy/preflop/**`).
 * - Продолжающим  → Solver Lab · 100 BB RFI module (`/academy/solver/rfi/100bb/**`).
 * - Продвинутым   → range study of harder spots on the existing trainer spot
 *                   pages (`/academy/solver/preflop/[stack]/[node]`).
 * - Тренажёры     → the existing practice activities (preflop trainer; Push/Fold
 *                   as a non-scored reference), presented by goal.
 */
import {
  ACADEMY_BASE_MTT_COURSE_CODE,
  ACADEMY_PREFLOP_OPEN_RAISE_MODULE_CODE,
  ACADEMY_SOLVER_LAB_COURSE_CODE,
  ACADEMY_SOLVER_RFI_MODULE_CODE,
} from "@/config/academy/catalog-codes";
import {
  ACADEMY_ADVANCED_ROUTE,
  ACADEMY_BEGINNER_ROUTE,
  ACADEMY_HOME_ROUTE,
  ACADEMY_INTERMEDIATE_ROUTE,
  ACADEMY_PREFLOP_SETUP_HASH,
  ACADEMY_PREFLOP_SETUP_ROUTE,
  ACADEMY_PUSH_FOLD_SETUP_ROUTE,
  ACADEMY_TRAINERS_ROUTE,
} from "@/config/academy/navigation-routes";
import {
  ACADEMY_PREFLOP_QUICK_MIX_ROUTE,
  ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE,
} from "@/config/academy/preflop-trainer";
import {
  ACADEMY_SOLVER_PUSH_FOLD_ROUTE,
  ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE,
} from "@/config/academy/push-fold-trainer";

export {
  ACADEMY_ADVANCED_ROUTE,
  ACADEMY_BEGINNER_ROUTE,
  ACADEMY_HOME_ROUTE,
  ACADEMY_INTERMEDIATE_ROUTE,
  ACADEMY_PREFLOP_SETUP_HASH,
  ACADEMY_PREFLOP_SETUP_ROUTE,
  ACADEMY_PUSH_FOLD_SETUP_ROUTE,
  ACADEMY_TRAINERS_ROUTE,
};

export type AcademyDestinationCode = "beginner" | "intermediate" | "advanced" | "trainers";

export type AcademyDestination = {
  readonly code: AcademyDestinationCode;
  readonly title: string;
  readonly description: string;
  readonly route: string;
  /** "learn" destinations hold lessons; "practice" holds the trainers. */
  readonly kind: "learn" | "practice";
  /** Existing catalog course + module whose lessons this destination presents. */
  readonly courseCode?: string;
  readonly moduleCode?: string;
};

export const ACADEMY_DESTINATIONS: readonly AcademyDestination[] = Object.freeze([
  Object.freeze({
    code: "beginner",
    title: "Новичкам",
    description: "Освой позиции и базовую игру на префлопе",
    route: ACADEMY_BEGINNER_ROUTE,
    kind: "learn",
    courseCode: ACADEMY_BASE_MTT_COURSE_CODE,
    moduleCode: ACADEMY_PREFLOP_OPEN_RAISE_MODULE_CODE,
  }),
  Object.freeze({
    code: "intermediate",
    title: "Продолжающим",
    description: "Научись лучше понимать диапазоны и решения по позициям",
    route: ACADEMY_INTERMEDIATE_ROUTE,
    kind: "learn",
    courseCode: ACADEMY_SOLVER_LAB_COURSE_CODE,
    moduleCode: ACADEMY_SOLVER_RFI_MODULE_CODE,
  }),
  Object.freeze({
    code: "advanced",
    title: "Продвинутым",
    description: "Разбирай сложные ситуации и смешанные стратегии",
    route: ACADEMY_ADVANCED_ROUTE,
    kind: "learn",
  }),
  Object.freeze({
    code: "trainers",
    title: "Тренажёры",
    description: "Практикуй решения за столом",
    route: ACADEMY_TRAINERS_ROUTE,
    kind: "practice",
  }),
] satisfies AcademyDestination[]);

export function requireAcademyDestination(code: AcademyDestinationCode): AcademyDestination {
  const destination = ACADEMY_DESTINATIONS.find((entry) => entry.code === code);
  if (!destination) throw new Error(`Unknown Academy destination: ${code}`);
  return destination;
}

/** One goal-based way to practise, linking to an existing trainer route. */
export type AcademyTrainerEntry = {
  readonly code: "quick-mix" | "setup" | "push-fold-reference";
  readonly title: string;
  /** One short line — the difference between modes at a glance. */
  readonly description: string;
  readonly route: string;
  readonly cta: string;
  /** "scored" = the route starts/configures a scored session; "reference" = study only, nothing is scored. */
  readonly kind: "scored" | "reference";
  /** The existing practice activity (catalog lesson code) the trainer records under. */
  readonly practiceLessonCode: string;
};

/**
 * "Тренажёры" entries. "Быстрая тренировка" links straight to the running
 * Preflop Quick Mix session (no intermediate page). "Короткий стек" is a
 * NON-SCORED reference while the HoldemMath multiway data is unvalidated
 * (docs/ACADEMY_PUSH_FOLD_AUDIT.md) — its copy must not promise scored training.
 */
export const ACADEMY_TRAINER_ENTRIES: readonly AcademyTrainerEntry[] = Object.freeze([
  Object.freeze({
    code: "quick-mix",
    title: "Быстрая тренировка",
    description: "Разные префлоп-ситуации, 10 раздач",
    route: ACADEMY_PREFLOP_QUICK_MIX_ROUTE,
    cta: "Начать",
    kind: "scored",
    practiceLessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE,
  }),
  Object.freeze({
    code: "setup",
    title: "Выбрать ситуацию",
    description: "Стек, позиция и действие соперника",
    route: ACADEMY_PREFLOP_SETUP_ROUTE,
    cta: "Настроить",
    kind: "scored",
    practiceLessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE,
  }),
  Object.freeze({
    code: "push-fold-reference",
    title: "Короткий стек",
    description: "Push/Fold 4–15 BB — справочник диапазонов, без оценки",
    route: ACADEMY_SOLVER_PUSH_FOLD_ROUTE,
    cta: "Смотреть диапазоны",
    kind: "reference",
    practiceLessonCode: ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE,
  }),
] satisfies AcademyTrainerEntry[]);

export function requireAcademyTrainerEntry(code: AcademyTrainerEntry["code"]): AcademyTrainerEntry {
  const entry = ACADEMY_TRAINER_ENTRIES.find((candidate) => candidate.code === code);
  if (!entry) throw new Error(`Unknown Academy trainer entry: ${code}`);
  return entry;
}

/**
 * "Продвинутым": hand-picked REAL nodes of the registered MTT reference
 * datasets whose strategies are mixed / multi-action. Each is just a link to
 * the node's existing study page (range grid + table); the advanced page
 * resolves them on the server and drops any that do not exist, and a test
 * pins that all of them resolve.
 */
export const ACADEMY_ADVANCED_STUDY_SPOTS: ReadonlyArray<{ readonly stackBb: number; readonly nodeKey: string; readonly topic: string }> =
  Object.freeze([
    { stackBb: 40, nodeKey: "FACING_OPEN_BB_VS_BTN", topic: "Защита большого блайнда: 3-бет, колл или фолд" },
    { stackBb: 40, nodeKey: "FACING_3BET_UTG_VS_SB", topic: "Ты открылся с UTG, а малый блайнд сделал 3-бет" },
    { stackBb: 20, nodeKey: "FACING_3BET_CO_VS_BTN", topic: "20 BB: ответ на 3-бет баттона" },
    { stackBb: 100, nodeKey: "FACING_4BET_BTN_VS_CO", topic: "Глубокий стек: ты сделал 3-бет, соперник ответил 4-бетом" },
  ]);
