import "server-only";

/**
 * Academy access TARGET builders — turn a page / session / reveal / attempt
 * request into policy targets (config/academy/access-policy.ts). Pure (no
 * I/O, no repositories): `features/academy-access.ts` enforces them.
 * Session, reveal AND attempt of the same trainer use the SAME builder, so
 * they can never drift apart. Targets are re-derived from server-validated
 * data (registry lookups / catalog) — client context such as
 * `?from=beginner` is never an input.
 */
import { getAcademyLessonByCode } from "@/config/academy/catalog";
import { academyAreaTarget, type AcademyAccessTarget } from "@/config/academy/access-policy";
import { ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE } from "@/config/academy/preflop-trainer";
import {
  AcademyPreflopTrainerSelectionError,
  requireAcademyPreflopTrainerSpot,
} from "@/lib/academy/preflop-trainer";

/**
 * A configurable-trainer fixed node, resolved through the trainer's own
 * fail-closed registry lookup (the same one the session uses). An unknown
 * dataset / node becomes the "unknown" area: denied for BEGINNER_ONLY,
 * while FULL continues to the trainer's existing validation (400).
 */
export function academyPreflopSpotTarget(datasetId: unknown, nodeKey: unknown): AcademyAccessTarget {
  try {
    const { spot } = requireAcademyPreflopTrainerSpot(datasetId, nodeKey);
    return { kind: "PREFLOP_SPOT", stackBb: spot.stackBb, nodeKey: spot.nodeKey };
  } catch (error) {
    if (error instanceof AcademyPreflopTrainerSelectionError) return academyAreaTarget("unknown");
    throw error;
  }
}

/** Preflop Quick Mix: the server picks nodes across all stacks → FULL only. */
export function academyPreflopQuickMixTarget(): AcademyAccessTarget {
  return academyAreaTarget("preflop-quick-mix");
}

/** Push/Fold (both modes, study and training) → FULL only. */
export function academyPushFoldTarget(): AcademyAccessTarget {
  return academyAreaTarget("push-fold");
}

/** A catalog lesson trained through its own lesson code (Solver Lab sessions, Шаг 1 attempts). */
export function academyCatalogLessonTarget(lessonCode: unknown): AcademyAccessTarget {
  return typeof lessonCode === "string" && lessonCode.length > 0
    ? { kind: "CATALOG_LESSON", lessonCode }
    : academyAreaTarget("unknown");
}

type RawAttemptAnswer = { readonly datasetId?: unknown; readonly nodeKey?: unknown; readonly mode?: unknown };

/**
 * Targets of an attempt submission, re-derived from the submitted payload
 * the same way the verifier reads it — never from a client "origin" marker:
 * - configurable preflop trainer (one stable lesson code for every node):
 *   any `mode` → Quick Mix; otherwise EVERY answer's own (datasetId,
 *   nodeKey) is resolved and must be allowed;
 * - Push/Fold lesson → Push/Fold;
 * - any other catalog lesson → that lesson code;
 * - unknown lesson / malformed answers → the "unknown" area.
 */
export function academyAttemptTargets(input: { readonly lessonCode: unknown; readonly questions: unknown }): readonly AcademyAccessTarget[] {
  const lesson = typeof input.lessonCode === "string" ? getAcademyLessonByCode(input.lessonCode) : null;
  if (!lesson) return [academyAreaTarget("unknown")];

  if (lesson.code === ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE) {
    const questions = input.questions;
    if (!Array.isArray(questions) || questions.length === 0) return [academyAreaTarget("unknown")];
    if (questions.some((answer) => !answer || typeof answer !== "object")) return [academyAreaTarget("unknown")];
    const answers = questions as readonly RawAttemptAnswer[];
    if (answers.some((answer) => answer.mode !== undefined)) return [academyPreflopQuickMixTarget()];
    return answers.map((answer) => academyPreflopSpotTarget(answer.datasetId, answer.nodeKey));
  }

  if (lesson.trainerKind === "PUSH_FOLD_PURE") return [academyPushFoldTarget()];
  return [academyCatalogLessonTarget(lesson.code)];
}
