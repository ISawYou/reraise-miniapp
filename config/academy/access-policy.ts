/**
 * Academy access POLICY — the one place that decides what a tier may open.
 * Pure and synchronous (no I/O): `features/academy-access.ts` resolves the
 * player's tier from canonical facts and calls `isAcademyAccessAllowed` for
 * every page, session, reveal and attempt. Nothing else may re-implement it.
 *
 * `FULL` may open everything. `BEGINNER_ONLY` may open exactly the
 * "Новичкам" curriculum:
 * - the catalog lessons of the "Новичкам" destination's module (Шаг 1 —
 *   База MTT open-raise lessons and their trainer), DERIVED from
 *   `ACADEMY_DESTINATIONS`;
 * - the fixed preflop-trainer spots (study page, session, reveal, attempt)
 *   that Шаг 2 teaches — main + compare spot of every lesson, DERIVED from
 *   `ACADEMY_BEGINNER_AFTER_OPEN_LESSONS`. If the beginner curriculum
 *   changes, this set follows automatically; never hand-copy it.
 * Everything else (the locked "areas", every other catalog lesson / spot,
 * and anything unrecognised) is denied — fail closed.
 */
import { ACADEMY_BEGINNER_AFTER_OPEN_LESSONS } from "@/config/academy/beginner-after-open";
import { getAcademyModule } from "@/config/academy/catalog";
import { requireAcademyDestination } from "@/config/academy/navigation";
import type { AcademyAccessTier } from "@/config/academy/access-copy";

/** Content areas that only FULL may open (pages and their APIs). */
export type AcademyLockedArea =
  | "intermediate"
  | "advanced"
  | "trainers"
  | "preflop-setup"
  | "preflop-quick-mix"
  | "push-fold"
  | "solver-rfi"
  /** A request that names nothing recognisable (fails closed for BEGINNER_ONLY). */
  | "unknown";

export type AcademyAccessTarget =
  | { readonly kind: "AREA"; readonly area: AcademyLockedArea }
  | { readonly kind: "CATALOG_LESSON"; readonly lessonCode: string }
  | { readonly kind: "PREFLOP_SPOT"; readonly stackBb: number; readonly nodeKey: string };

export type AcademyBeginnerSpotKey = { readonly stackBb: number; readonly nodeKey: string };

function spotKey(spot: AcademyBeginnerSpotKey): string {
  return `${spot.stackBb}:${spot.nodeKey}`;
}

/** Every spot the "Новичкам · Шаг 2" lessons use (main + compare), de-duplicated, in curriculum order. */
export function deriveAcademyBeginnerSpots(
  lessons: typeof ACADEMY_BEGINNER_AFTER_OPEN_LESSONS = ACADEMY_BEGINNER_AFTER_OPEN_LESSONS,
): readonly AcademyBeginnerSpotKey[] {
  const seen = new Map<string, AcademyBeginnerSpotKey>();
  for (const lesson of lessons) {
    for (const spot of lesson.compareSpot ? [lesson.spot, lesson.compareSpot] : [lesson.spot]) {
      if (!seen.has(spotKey(spot))) seen.set(spotKey(spot), Object.freeze({ stackBb: spot.stackBb, nodeKey: spot.nodeKey }));
    }
  }
  return Object.freeze([...seen.values()]);
}

export const ACADEMY_BEGINNER_SPOTS: readonly AcademyBeginnerSpotKey[] = deriveAcademyBeginnerSpots();

const BEGINNER_SPOT_KEYS: ReadonlySet<string> = new Set(ACADEMY_BEGINNER_SPOTS.map(spotKey));

/** Catalog lesson codes of the "Новичкам" destination's module (Шаг 1). */
function deriveAcademyBeginnerLessonCodes(): readonly string[] {
  const destination = requireAcademyDestination("beginner");
  const courseModule = destination.moduleCode ? getAcademyModule(destination.moduleCode) : null;
  if (!courseModule) throw new Error("Academy catalog is missing the beginner module");
  return Object.freeze(courseModule.lessons.map((lesson) => lesson.code));
}

export const ACADEMY_BEGINNER_LESSON_CODES: readonly string[] = deriveAcademyBeginnerLessonCodes();

const BEGINNER_LESSON_CODES: ReadonlySet<string> = new Set(ACADEMY_BEGINNER_LESSON_CODES);

export function isAcademyBeginnerSpot(spot: { readonly stackBb: unknown; readonly nodeKey: unknown }): boolean {
  return typeof spot.stackBb === "number" && typeof spot.nodeKey === "string"
    && BEGINNER_SPOT_KEYS.has(spotKey({ stackBb: spot.stackBb, nodeKey: spot.nodeKey }));
}

/** THE policy. FULL: everything. BEGINNER_ONLY: only the beginner curriculum. Anything else: nothing. */
export function isAcademyAccessAllowed(tier: AcademyAccessTier, target: AcademyAccessTarget): boolean {
  if (tier === "FULL") return true;
  if (tier !== "BEGINNER_ONLY") return false;
  switch (target.kind) {
    case "CATALOG_LESSON":
      return BEGINNER_LESSON_CODES.has(target.lessonCode);
    case "PREFLOP_SPOT":
      return isAcademyBeginnerSpot(target);
    case "AREA":
    default:
      return false;
  }
}

export function academyAreaTarget(area: AcademyLockedArea): AcademyAccessTarget {
  return { kind: "AREA", area };
}
