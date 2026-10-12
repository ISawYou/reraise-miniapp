/**
 * "Готовые тренировки" — ready-made practice presets (client-safe, tiny, no
 * dataset payloads).
 *
 * A preset is NOT a trainer: it is a named shortcut to ONE real node of an
 * EXISTING trainer, opened through that trainer's existing route:
 * - `PREFLOP_TRAINER` → the configurable preflop trainer's fixed-node session
 *   `/academy/solver/preflop/<stack>/<node>/train` (server-derived session,
 *   same verifier, same `solver_preflop_trainer` lesson code). The optional
 *   `?preset=` query only changes the session's header ("eyebrow") and its
 *   back link; the train page ignores it unless it names THIS node.
 * - `PUSH_FOLD_STUDY` → the existing NON-SCORED Push/Fold study page of the
 *   node (scored Push/Fold stays disabled: docs/ACADEMY_PUSH_FOLD_AUDIT.md).
 *
 * Every (stack, node) below is resolved by a test through the trainers' own
 * fail-closed lookups (`requireAcademyPreflopTrainerSpotByStack`,
 * `requireAcademyPushFoldSpotByStack`), and the trainers landing drops a preset
 * whose node does not resolve — nothing here can point at an invented spot.
 */
import type { AcademyBeginnerAfterOpenSlug } from "@/config/academy/beginner-after-open";
import { preflopTrainerTrainRoute } from "@/config/academy/preflop-trainer";
import { pushFoldSpotRoute } from "@/config/academy/push-fold-trainer";

export type AcademyTrainingPresetId =
  | "open-raise"
  | "bb-defence"
  | "sb-vs-open"
  | "blind-vs-blind"
  | "three-bet"
  | "facing-three-bet"
  | "push-fold";

export type AcademyTrainingPresetEngine = "PREFLOP_TRAINER" | "PUSH_FOLD_STUDY";

export type AcademyTrainingPreset = {
  readonly id: AcademyTrainingPresetId;
  /** Plain-Russian card title (no jargon in the title itself). */
  readonly title: string;
  /** One short line: what makes this training different. */
  readonly description: string;
  readonly engine: AcademyTrainingPresetEngine;
  /** One real node of the engine's registered datasets. */
  readonly stackBb: number;
  readonly nodeKey: string;
  /** The "Новичкам · Шаг 2" lesson whose "Потренироваться" opens this preset. */
  readonly lessonSlug?: AcademyBeginnerAfterOpenSlug;
};

/** Query parameter the preflop train route reads to show a preset's header. */
export const ACADEMY_TRAINING_PRESET_QUERY = "preset";
/** `?from=` origins that change only the session's back link. */
export type AcademyTrainingSessionOrigin = "lesson" | "advanced";

export const ACADEMY_TRAINING_PRESETS: readonly AcademyTrainingPreset[] = Object.freeze([
  Object.freeze({
    id: "open-raise",
    title: "Первый рейз",
    description: "Все сбросили до тебя — открываться или нет",
    engine: "PREFLOP_TRAINER",
    stackBb: 40,
    nodeKey: "RFI_CO",
  }),
  Object.freeze({
    id: "bb-defence",
    title: "Защита большого блайнда",
    description: "Соперник открылся — фолд, колл или повторный рейз",
    engine: "PREFLOP_TRAINER",
    stackBb: 40,
    nodeKey: "FACING_OPEN_BB_VS_BTN",
    lessonSlug: "bb-defence",
  }),
  Object.freeze({
    id: "sb-vs-open",
    title: "Малый блайнд против рейза",
    description: "Кто-то открылся, а большой блайнд ещё впереди",
    engine: "PREFLOP_TRAINER",
    stackBb: 40,
    nodeKey: "FACING_OPEN_SB_VS_BTN",
    lessonSlug: "sb-vs-open",
  }),
  Object.freeze({
    id: "blind-vs-blind",
    title: "Блайнд против блайнда",
    description: "Все сбросили — ты на малом блайнде против большого",
    engine: "PREFLOP_TRAINER",
    stackBb: 40,
    nodeKey: "RFI_SB",
    lessonSlug: "sb-first-in",
  }),
  Object.freeze({
    id: "three-bet",
    title: "Повторный рейз",
    description: "Соперник открылся — когда повышать ещё раз",
    engine: "PREFLOP_TRAINER",
    stackBb: 40,
    nodeKey: "FACING_OPEN_BTN_VS_CO",
    lessonSlug: "three-bet",
  }),
  Object.freeze({
    id: "facing-three-bet",
    title: "Ответ на повторный рейз",
    description: "Ты открылся, а соперник повысил ещё раз",
    engine: "PREFLOP_TRAINER",
    stackBb: 40,
    nodeKey: "FACING_3BET_CO_VS_BTN",
    lessonSlug: "facing-three-bet",
  }),
  Object.freeze({
    id: "push-fold",
    title: "Короткий стек",
    description: "Олл-ин или фолд, когда фишек мало",
    engine: "PUSH_FOLD_STUDY",
    stackBb: 10,
    nodeKey: "FIRST_IN_SHOVE_BTN",
  }),
] satisfies AcademyTrainingPreset[]);

export function getAcademyTrainingPreset(id: unknown): AcademyTrainingPreset | null {
  if (typeof id !== "string") return null;
  return ACADEMY_TRAINING_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** True only for a SCORED preset (the preflop trainer); Push/Fold is study only. */
export function isAcademyTrainingPresetScored(preset: AcademyTrainingPreset): boolean {
  return preset.engine === "PREFLOP_TRAINER";
}

/**
 * Entry route of a preset: the EXISTING route of its node. For the preflop
 * trainer the preset id (and optionally the origin) ride along as query
 * params that affect only the header and back link.
 */
export function academyTrainingPresetRoute(preset: AcademyTrainingPreset, from?: Extract<AcademyTrainingSessionOrigin, "lesson">): string {
  if (preset.engine === "PUSH_FOLD_STUDY") return pushFoldSpotRoute(preset.stackBb, preset.nodeKey);
  const query = new URLSearchParams({ [ACADEMY_TRAINING_PRESET_QUERY]: preset.id });
  if (from) query.set("from", from);
  return `${preflopTrainerTrainRoute(preset.stackBb, preset.nodeKey)}?${query.toString()}`;
}

/** The preset a "Новичкам · Шаг 2" lesson practises (one per lesson). */
export function academyTrainingPresetForLesson(slug: AcademyBeginnerAfterOpenSlug): AcademyTrainingPreset | null {
  return ACADEMY_TRAINING_PRESETS.find((preset) => preset.lessonSlug === slug) ?? null;
}
