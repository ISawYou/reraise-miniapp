/**
 * Per-spot practice progress (client-safe, tiny, no dataset payloads).
 *
 * WHY THIS EXISTS — "Продвинутым" (and "Новичкам · Шаг 2") had no progress:
 * their content lives OUTSIDE `ACADEMY_CATALOG` on purpose (adding lessons to a
 * catalog course would change its totals — every 7/7 player would silently
 * drop — and the course list itself is pinned). Practice for these spots runs
 * in the EXISTING configurable preflop trainer, whose attempts all record under
 * ONE lesson code (`solver_preflop_trainer`); the attempts table stores no
 * node, so per-spot progress cannot be derived from existing rows.
 *
 * Solution (no migration, no catalog change): a fixed allow-list of tracked
 * spots, each with a stable derived code. When a FIXED-NODE attempt of the
 * preflop trainer is submitted for a tracked spot, the server — after the
 * unchanged verifier has scored it — ALSO records the same score under the
 * spot's code in the existing `academy_lesson_progress` / `academy_training_attempts`
 * tables (`lesson_code` is unconstrained text; same SQL function). Nothing else
 * changes: the trainer's own row, the catalog, every course / module total and
 * the admin view (spot rows are filtered out there) stay exactly as before.
 * Quick Mix and Push/Fold attempts never write spot rows.
 *
 * Honest limitation: practice done BEFORE this release carries no node
 * information, so it cannot be credited retroactively; spot progress starts
 * from the first tracked training after release.
 *
 * Codes are `spot_practice_<stack>bb_<node key lower-case>` — never rename.
 */
import { ACADEMY_BEGINNER_AFTER_OPEN_LESSONS } from "@/config/academy/beginner-after-open";
import { ACADEMY_ADVANCED_STUDY_SPOTS } from "@/config/academy/navigation";
import { ACADEMY_TRAINING_PRESETS } from "@/config/academy/training-presets";

export const ACADEMY_SPOT_PROGRESS_CODE_PREFIX = "spot_practice_";

export type AcademySpotRef = { readonly stackBb: number; readonly nodeKey: string };

export type AcademySpotProgressUnit = AcademySpotRef & { readonly code: string };

export function academySpotProgressCode(spot: AcademySpotRef): string {
  return `${ACADEMY_SPOT_PROGRESS_CODE_PREFIX}${spot.stackBb}bb_${spot.nodeKey.toLowerCase()}`;
}

function unique(spots: readonly AcademySpotRef[]): AcademySpotProgressUnit[] {
  const seen = new Map<string, AcademySpotProgressUnit>();
  for (const spot of spots) {
    const code = academySpotProgressCode(spot);
    if (!seen.has(code)) seen.set(code, Object.freeze({ stackBb: spot.stackBb, nodeKey: spot.nodeKey, code }));
  }
  return [...seen.values()];
}

/** Every tracked spot: advanced study spots, Шаг 2 lesson spots, preflop presets. */
export const ACADEMY_SPOT_PROGRESS_UNITS: readonly AcademySpotProgressUnit[] = Object.freeze(unique([
  ...ACADEMY_ADVANCED_STUDY_SPOTS,
  ...ACADEMY_BEGINNER_AFTER_OPEN_LESSONS.map((lesson) => lesson.spot),
  ...ACADEMY_TRAINING_PRESETS.filter((preset) => preset.engine === "PREFLOP_TRAINER"),
]));

const UNIT_BY_CODE: ReadonlyMap<string, AcademySpotProgressUnit> = new Map(
  ACADEMY_SPOT_PROGRESS_UNITS.map((unit) => [unit.code, unit]),
);

export function getAcademySpotProgressUnit(spot: AcademySpotRef): AcademySpotProgressUnit | null {
  return UNIT_BY_CODE.get(academySpotProgressCode(spot)) ?? null;
}

/** True for any spot-progress row code (tracked or not): never a catalog lesson. */
export function isAcademySpotProgressCode(code: string): boolean {
  return code.startsWith(ACADEMY_SPOT_PROGRESS_CODE_PREFIX);
}

export function listAcademySpotProgressCodes(): readonly string[] {
  return ACADEMY_SPOT_PROGRESS_UNITS.map((unit) => unit.code);
}
