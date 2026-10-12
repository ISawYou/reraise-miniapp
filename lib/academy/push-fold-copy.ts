/**
 * Russian, answer-free presentation copy for the Push/Fold trainer
 * (client-safe, pure). Composed from the spot's own fields; never claims
 * exact GTO / exact multi-way Nash — the source's 9-max charts are a
 * documented single-caller approximation.
 */
import { ACADEMY_PUSH_FOLD_SEAT_ORDER } from "@/lib/academy/push-fold-selection";
import type { AcademyPushFoldSituation, AcademyPushFoldSpot, AcademyPushFoldSpotCopy } from "@/types/academy";

export const ACADEMY_PUSH_FOLD_SITUATION_LABELS: Readonly<Record<AcademyPushFoldSituation, string>> = Object.freeze({
  FIRST_IN_SHOVE: "Пушить первым",
  CALL_VS_SHOVE: "Коллировать пуш",
});

/** One-line hint under each family on the home page. */
export const ACADEMY_PUSH_FOLD_SITUATION_HINTS: Readonly<Record<AcademyPushFoldSituation, string>> = Object.freeze({
  FIRST_IN_SHOVE: "До тебя все сбросили: олл-ин или фолд",
  CALL_VS_SHOVE: "Соперник пошёл олл-ин: колл или фолд",
});

/** Neutral module name for headings ("Учебная Push/Fold стратегия"). */
export const ACADEMY_PUSH_FOLD_STRATEGY_NAME = "Учебная Push/Fold стратегия";

/** Short, honest model note shown on study pages (mirrors the source README). */
export const ACADEMY_PUSH_FOLD_MODEL_NOTE =
  "Чипы (chip EV), анте 0.1 BB, без ICM и рейка. Для стола 9-max это приближение: " +
  "каждый пуш считается против одного коллирующего соперника.";

/** Banner title of every Push/Fold screen while scored training is paused. */
export const ACADEMY_PUSH_FOLD_REFERENCE_TITLE = "Справочник · без оценки";

/** Why these ranges are reference-only (docs/ACADEMY_PUSH_FOLD_AUDIT.md), in plain Russian. */
export const ACADEMY_PUSH_FOLD_REFERENCE_NOTE =
  "Это приблизительный ориентир, а не проверенный точный ответ для турнира. " +
  "С ранних позиций диапазоны здесь заметно шире реальных, поэтому за них мы не ставим оценку.";

/** Shown on the scored Push/Fold routes while scored training is paused. */
export const ACADEMY_PUSH_FOLD_TRAINING_PAUSED_NOTE =
  "Мы проверяем данные Push/Fold: для стола 9-max они приблизительные, и оценивать по ним твои решения было бы нечестно. " +
  "Диапазоны можно смотреть в справочнике.";

/**
 * Bottom "what next" of a reference range page while scored training is
 * paused. No self-check is offered: the trainer engine is scored-only, and a
 * second engine or an unscored bypass of the scored gate is not acceptable.
 */
export const ACADEMY_PUSH_FOLD_NEXT_STEP_NOTE =
  "Тренировка Push/Fold с оценкой на паузе: для стола 9-max эти диапазоны приблизительные. " +
  "Можно посмотреть другой спот или потренировать префлоп с оценкой.";

function seatIndex(seat: string): number {
  return (ACADEMY_PUSH_FOLD_SEAT_ORDER as readonly string[]).indexOf(seat);
}

/**
 * - first-in: "BTN · пуш первым" / "До тебя все сбросили — ты на BTN"
 * - call:     "BB против пуша CO" / "CO пошёл олл-ин, до тебя все сбросили — ты на BB"
 *             (no fold clause when nobody sits between, e.g. BB vs SB)
 */
export function describePushFoldSpot(
  spot: Pick<AcademyPushFoldSpot, "situation" | "heroPosition" | "villainPosition">,
): AcademyPushFoldSpotCopy {
  const hero = spot.heroPosition;
  const situationLabel = ACADEMY_PUSH_FOLD_SITUATION_LABELS[spot.situation];
  if (spot.situation === "FIRST_IN_SHOVE") {
    return { title: `${hero} · пуш первым`, history: `До тебя все сбросили — ты на ${hero}`, situationLabel };
  }
  const villain = spot.villainPosition ?? "";
  const between = seatIndex(hero) - seatIndex(villain) > 1;
  return {
    title: `${hero} против пуша ${villain}`,
    history: between
      ? `${villain} пошёл олл-ин, до тебя все сбросили — ты на ${hero}`
      : `${villain} пошёл олл-ин — ты на ${hero}`,
    situationLabel,
  };
}

export type AcademyPushFoldFeedback = {
  readonly tone: "correct" | "incorrect";
  readonly title: string;
  readonly summary: string;
  readonly detail: string;
};

type FeedbackInput = {
  readonly hand: string;
  readonly resolvedAction: string;
  readonly selectedAction: string;
  readonly actions: ReadonlyArray<{ readonly code: string; readonly label: string; readonly ru?: { readonly inline: string } }>;
  readonly spot: Pick<AcademyPushFoldSpot, "situation" | "heroPosition" | "villainPosition" | "stackBb">;
};

/**
 * Post-answer copy. Push/fold ranges are pure, so the answer is either the
 * range's action or a fold — never "mixed".
 */
export function buildPushFoldFeedback(input: FeedbackInput): AcademyPushFoldFeedback {
  const resolved = input.actions.find((action) => action.code === input.resolvedAction);
  const inline = resolved?.ru?.inline ?? resolved?.label ?? input.resolvedAction;
  const inRange = input.resolvedAction !== "FOLD";
  const { situation, heroPosition, villainPosition, stackBb } = input.spot;
  const range = situation === "FIRST_IN_SHOVE"
    ? `диапазон пуша с ${heroPosition} на ${stackBb} BB`
    : `диапазон колла с ${heroPosition} против пуша ${villainPosition} на ${stackBb} BB`;
  const detail = inRange ? `${input.hand} входит в ${range}.` : `${input.hand} не входит в ${range} — это фолд.`;
  const matches = input.selectedAction === input.resolvedAction;
  return {
    tone: matches ? "correct" : "incorrect",
    title: matches ? "Верно" : "Не входит в стратегию",
    summary: `Правильно: ${inline}.`,
    detail,
  };
}
