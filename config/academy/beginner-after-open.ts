/**
 * "Новичкам · Шаг 2 — Что делать после открытия": the second beginner preflop
 * block (client-safe, dependency-light — no dataset payloads).
 *
 * WHY THIS IS NOT IN `ACADEMY_CATALOG` (config/academy/catalog.ts)
 * - Course / module lesson lists drive persisted progress math ("X из 7").
 *   Appending these lessons to База MTT's module — or adding a module to the
 *   База MTT course — would change its total, so every player who completed
 *   the 7 opening lessons would silently drop from 7/7 to 7/12. Adding a third
 *   catalog course would change the frozen course list
 *   (features/__tests__/academy-solver-regression.test.ts pins
 *   `["base_mtt", "solver_lab"]`). So this block is its OWN unit, outside the
 *   catalog: it cannot touch any existing course / module / lesson count.
 * - Its lessons are study pages; practice deep-links into the EXISTING
 *   configurable preflop trainer route of the exact node
 *   (`/academy/solver/preflop/<stack>/<node>/train`), which records under the
 *   trainer's own stable practice code (`solver_preflop_trainer`). These
 *   lesson codes are therefore not persisted anywhere today, and the block
 *   shows no completion counter. If per-lesson completion is ever added, it
 *   must be a NEW catalog unit with these same, never-renamed codes — never an
 *   append to the 7 opening lessons.
 *
 * Every lesson is bound to REAL nodes of the registered MTT reference datasets
 * (docs/ACADEMY_MTT_REFERENCE_COVERAGE.md). The server resolves them through
 * the trainer's fail-closed lookup (lib/academy/beginner-after-open.ts) and a
 * test pins that each one exists with the actions the lesson copy relies on.
 */
import { ACADEMY_BEGINNER_ROUTE } from "@/config/academy/navigation-routes";

/** Stable identity of the block (not a catalog module code; never rename). */
export const ACADEMY_BEGINNER_AFTER_OPEN_MODULE_CODE = "beginner_preflop_after_open";

export const ACADEMY_BEGINNER_AFTER_OPEN_ROUTE = `${ACADEMY_BEGINNER_ROUTE}/after-open`;

export type AcademyBeginnerAfterOpenSlug =
  | "sb-first-in"
  | "bb-defence"
  | "sb-vs-open"
  | "three-bet"
  | "facing-three-bet";

/** One real node of a registered MTT reference dataset. */
export type AcademyBeginnerSpotRef = {
  readonly stackBb: number;
  readonly nodeKey: string;
};

export type AcademyBeginnerAfterOpenLesson = {
  /** Stable, never-reused code (not in the catalog; see the module comment). */
  readonly code: string;
  readonly slug: AcademyBeginnerAfterOpenSlug;
  readonly order: number;
  readonly title: string;
  /** One plain line for the lesson card. */
  readonly subtitle: string;
  /** The spot the table, range and "Потренироваться" are about. */
  readonly spot: AcademyBeginnerSpotRef;
  /** A second real spot the lesson compares against (optional). */
  readonly compareSpot?: AcademyBeginnerSpotRef;
};

export const ACADEMY_BEGINNER_AFTER_OPEN_LESSONS: readonly AcademyBeginnerAfterOpenLesson[] = Object.freeze([
  Object.freeze({
    code: "beginner_preflop_sb_first_in",
    slug: "sb-first-in",
    order: 1,
    title: "Малый блайнд",
    subtitle: "Все сбросили до тебя, остался только большой блайнд",
    spot: Object.freeze({ stackBb: 40, nodeKey: "RFI_SB" }),
  }),
  Object.freeze({
    code: "beginner_preflop_bb_defence",
    slug: "bb-defence",
    order: 2,
    title: "Защита большого блайнда",
    subtitle: "Соперник открылся — фолд, колл или 3-бет",
    spot: Object.freeze({ stackBb: 40, nodeKey: "FACING_OPEN_BB_VS_BTN" }),
    compareSpot: Object.freeze({ stackBb: 40, nodeKey: "FACING_OPEN_BB_VS_UTG" }),
  }),
  Object.freeze({
    code: "beginner_preflop_sb_vs_open",
    slug: "sb-vs-open",
    order: 3,
    title: "Малый блайнд против рейза",
    subtitle: "Ты на SB, кто-то открылся, а большой блайнд ещё впереди",
    spot: Object.freeze({ stackBb: 40, nodeKey: "FACING_OPEN_SB_VS_BTN" }),
    compareSpot: Object.freeze({ stackBb: 40, nodeKey: "FACING_OPEN_BB_VS_BTN" }),
  }),
  Object.freeze({
    code: "beginner_preflop_three_bet_basics",
    slug: "three-bet",
    order: 4,
    title: "Когда делать 3-бет",
    subtitle: "Повторный рейз: зачем он нужен и какого он размера",
    spot: Object.freeze({ stackBb: 40, nodeKey: "FACING_OPEN_BTN_VS_CO" }),
    compareSpot: Object.freeze({ stackBb: 40, nodeKey: "FACING_OPEN_BB_VS_BTN" }),
  }),
  Object.freeze({
    code: "beginner_preflop_facing_three_bet",
    slug: "facing-three-bet",
    order: 5,
    title: "Что делать против 3-бета",
    subtitle: "Ты открылся, а соперник ответил повторным рейзом",
    spot: Object.freeze({ stackBb: 40, nodeKey: "FACING_3BET_CO_VS_BTN" }),
  }),
] satisfies AcademyBeginnerAfterOpenLesson[]);

export function beginnerAfterOpenLessonRoute(slug: AcademyBeginnerAfterOpenSlug): string {
  return `${ACADEMY_BEGINNER_AFTER_OPEN_ROUTE}/${slug}`;
}

export function getBeginnerAfterOpenLesson(slug: string): AcademyBeginnerAfterOpenLesson | null {
  return ACADEMY_BEGINNER_AFTER_OPEN_LESSONS.find((lesson) => lesson.slug === slug) ?? null;
}

/** Short inline glossary entries (shown next to the lesson text, not as a separate screen). */
export const ACADEMY_BEGINNER_TERMS = Object.freeze({
  SB: "SB — малый блайнд: обязательная ставка 0.5 BB слева от баттона.",
  BB: "BB — большой блайнд: обязательная ставка 1 BB. Все размеры считаем в BB.",
  BTN: "BTN — баттон, последнее место перед блайндами.",
  CO: "CO — место прямо перед баттоном.",
  OPEN: "Открыться — первым сделать рейз, когда до тебя все сбросили.",
  LIMP: "Лимп — просто доплатить до большого блайнда, не повышая.",
  THREE_BET: "3-бет — повторное повышение после чужого рейза.",
  POSITION: "Играть в позиции — ходить после соперника на флопе, тёрне и ривере. Без позиции — ходить первым.",
  EFFECTIVE_STACK: "Эффективный стек — меньший из стеков игроков, которые разыгрывают банк.",
  ALL_IN: "Олл-ин — поставить все свои фишки.",
} as const);

export type AcademyBeginnerTermCode = keyof typeof ACADEMY_BEGINNER_TERMS;
