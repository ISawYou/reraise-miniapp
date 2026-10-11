/**
 * Post-answer feedback copy for the Solver Lab trainer (client-safe, pure).
 *
 * Scoring and copy are separate concerns: the verifier counts a question as
 * correct only when the choice matches the session's resolved action. The
 * copy, however, never calls a mixed-hand disagreement "wrong" — both actions
 * are part of a mixed strategy; the randomizer just picked one for this deal.
 */
import type {
  AcademySolverAction,
  AcademySolverPublicAction,
  AcademyStrategyHandFrequencies,
  StartingHandClass,
} from "@/types/academy";

export type AcademySolverFeedbackTone = "correct" | "incorrect" | "mixed";

export type AcademySolverFeedback = {
  readonly tone: AcademySolverFeedbackTone;
  readonly title: string;
  readonly summary: string;
  readonly detail: string;
};

/** Display source of an action: its canonical label plus optional Russian copy. */
export type AcademySolverActionCopySource = Pick<AcademySolverPublicAction, "code" | "label" | "ru">;

export type AcademySolverFeedbackInput = {
  readonly hand: StartingHandClass;
  readonly frequencies: AcademyStrategyHandFrequencies;
  readonly randomizerPercent: number;
  readonly resolvedAction: AcademySolverAction;
  readonly selectedAction: AcademySolverAction;
  /** The node's action definitions, in resolver order (labels come from here). */
  readonly actions: readonly AcademySolverActionCopySource[];
};

/**
 * Wording knobs (presentation only). Defaults reproduce the original 100bb
 * Solver Lab copy exactly; the configurable trainer passes neutral wording.
 */
export type AcademySolverFeedbackWording = {
  /** Subject of the mixed-hand summary, default "Солверная частота". */
  readonly frequencySubject?: string;
  /** Lead-in of the pure-hand detail, default "С этой позиции". */
  readonly spotLead?: string;
};

/** Neutral wording for trainers whose data is not presented as solver output. */
export const ACADEMY_NEUTRAL_FEEDBACK_WORDING: AcademySolverFeedbackWording = Object.freeze({
  frequencySubject: "Частота стратегии",
  spotLead: "В этом споте",
});

export function formatSolverFrequencyPercent(frequency: number): string {
  const percent = frequency * 100;
  if (percent > 0 && percent < 1) return "<1%";
  if (percent < 100 && percent > 99) return ">99%";
  return `${Math.round(percent)}%`;
}

/** Button text: localized copy when present, else the canonical label. */
export function solverActionButtonLabel(action: AcademySolverActionCopySource): string {
  return action.ru?.button ?? action.label;
}

/** In-sentence text, e.g. "рейз 2.25 BB". */
export function solverActionInlineLabel(action: AcademySolverActionCopySource): string {
  return action.ru?.inline ?? action.label;
}

/** Short name for frequency splits, e.g. "рейз". */
export function solverActionShortLabel(action: AcademySolverActionCopySource): string {
  return action.ru?.short ?? action.label;
}

function findAction(
  actions: readonly AcademySolverActionCopySource[],
  code: AcademySolverAction,
): AcademySolverActionCopySource {
  return actions.find((action) => action.code === code) ?? { code, label: code };
}

/** "рейз 41% / фолд 59%" — one entry per node action, in resolver order. */
export function formatSolverFrequencySplit(
  frequencies: AcademyStrategyHandFrequencies,
  actions: readonly AcademySolverActionCopySource[],
): string {
  return actions
    .map((action) => `${solverActionShortLabel(action)} ${formatSolverFrequencyPercent(frequencies[action.code] ?? 0)}`)
    .join(" / ");
}

/**
 * Feedback copy for any number of actions. Tones:
 * - pure hand: "correct" / "incorrect";
 * - mixed hand, matched the randomizer: "correct";
 * - mixed hand, chose another action the strategy also plays (> 0%):
 *   "mixed" — non-judgmental, never "wrong";
 * - mixed hand, chose an action the strategy never plays here (0%, only
 *   possible with 3+ actions): "incorrect", stated plainly.
 */
export function buildSolverAnswerFeedback({
  hand,
  frequencies,
  randomizerPercent,
  resolvedAction,
  selectedAction,
  actions,
}: AcademySolverFeedbackInput, wording: AcademySolverFeedbackWording = {}): AcademySolverFeedback {
  const frequencySubject = wording.frequencySubject ?? "Солверная частота";
  const spotLead = wording.spotLead ?? "С этой позиции";
  const split = formatSolverFrequencySplit(frequencies, actions);
  const matches = selectedAction === resolvedAction;
  const resolved = findAction(actions, resolvedAction);
  const pureAction = actions.find((action) => (frequencies[action.code] ?? 0) >= 1);

  if (!pureAction) {
    const outcome = `Рандомайзер ${randomizerPercent} → в этой раздаче выпал ${solverActionShortLabel(resolved)}.`;
    if (!matches && (frequencies[selectedAction] ?? 0) <= 0) {
      return {
        tone: "incorrect",
        title: "Не совсем",
        summary: `${frequencySubject} для ${hand}: ${split}.`,
        detail:
          `${outcome} Действие «${solverActionShortLabel(findAction(actions, selectedAction))}» ` +
          "в этой руке стратегия не играет совсем.",
      };
    }
    if (matches) {
      return {
        tone: "correct",
        title: "Совпало с рандомайзером",
        summary: `Смешанная рука: ${split}.`,
        detail: `${outcome} Ты сыграл ровно ту часть стратегии, которая выпала.`,
      };
    }
    return {
      tone: "mixed",
      title: "Смешанная рука",
      summary: `${frequencySubject} для ${hand} смешанная: ${split}.`,
      detail:
        `${outcome} Но ${solverActionShortLabel(findAction(actions, selectedAction))} здесь тоже часть стратегии — ` +
        "просто с другой частотой. В зачёт тренировки идёт действие, выпавшее на рандомайзере.",
    };
  }

  const always = pureAction.ru?.always ?? `всегда играем: ${solverActionInlineLabel(pureAction)}`;
  const pureDetail = `${spotLead} ${hand} ${always} (${split}).`;
  const summary = `Действие: ${solverActionInlineLabel(resolved)}.`;
  return matches
    ? { tone: "correct", title: "Верно", summary, detail: pureDetail }
    : { tone: "incorrect", title: "Не совсем", summary, detail: pureDetail };
}
