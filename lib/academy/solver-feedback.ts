/**
 * Post-answer feedback copy (client-safe, pure).
 *
 * - `buildSolverAnswerFeedback`: the 100bb HRC Solver Lab trainer. Its
 *   verifier counts a question as correct only when the choice matches the
 *   session's resolved action (exact-randomizer training, unchanged). The
 *   copy never calls a mixed-hand disagreement "wrong".
 * - `buildPracticeAnswerFeedback`: normal practice (configurable trainer +
 *   Quick Mix). Any action the strategy plays counts as correct; frequencies
 *   are primary, the randomizer is a secondary explanation.
 */
import type {
  AcademySolverAction,
  AcademySolverPublicAction,
  AcademyStrategyAnswerOutcome,
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

// ---------------------------------------------------------------------------
// Normal practice (configurable preflop trainer + Quick Mix) — NOT the 100bb
// HRC trainer, which keeps `buildSolverAnswerFeedback` and its exact-randomizer
// philosophy unchanged.
// ---------------------------------------------------------------------------

/**
 * `valid` = a mixed-strategy action that differs from the randomizer but is
 * part of the strategy: counted as correct and never styled as an error.
 */
export type AcademyPracticeFeedbackTone = "correct" | "valid" | "incorrect";

export type AcademyPracticeFeedback = {
  readonly tone: AcademyPracticeFeedbackTone;
  /** "Верно" / "Допустимое решение" / "Не входит в стратегию". */
  readonly title: string;
  /** PRIMARY feedback, at most ~2 short lines: frequencies + one plain verdict sentence. */
  readonly summary: string;
  /** SECONDARY, mixed hands only: what the randomizer picked in this deal, in plain Russian. */
  readonly randomizerNote: string | null;
  /** Longer explanation, rendered behind "Подробнее" (collapsed by default). */
  readonly detail: string;
};

export type AcademyPracticeFeedbackInput = {
  readonly hand: StartingHandClass;
  readonly frequencies: AcademyStrategyHandFrequencies;
  readonly randomizerPercent: number;
  readonly resolvedAction: AcademySolverAction;
  readonly selectedAction: AcademySolverAction;
  /** Server-computed outcome from the reveal — the copy never re-derives scoring. */
  readonly outcome: AcademyStrategyAnswerOutcome;
  readonly actions: readonly AcademySolverActionCopySource[];
};

function capitalize(text: string): string {
  return text.length === 0 ? text : `${text[0].toLocaleUpperCase("ru")}${text.slice(1)}`;
}

/** "3-бет — 77%, колл — 23%" — only actions the strategy plays, most frequent first. */
export function formatPracticeFrequencyList(
  frequencies: AcademyStrategyHandFrequencies,
  actions: readonly AcademySolverActionCopySource[],
): string {
  return capitalize(actions
    .map((action, index) => ({ action, index, frequency: frequencies[action.code] ?? 0 }))
    .filter((entry) => entry.frequency > 0)
    .sort((a, b) => b.frequency - a.frequency || a.index - b.index)
    .map((entry) => `${solverActionShortLabel(entry.action)} — ${formatSolverFrequencyPercent(entry.frequency)}`)
    .join(", "));
}

/**
 * Plain-Russian, three-state feedback for normal practice. Frequencies are the
 * primary information; the randomizer is a secondary note that explains what
 * this particular deal "rolled". A valid mixed choice is never called a mistake.
 * Example (3-бет 77% / колл 23%, player 3-bets, randomizer picked колл):
 *   title          "Допустимое решение"
 *   summary        "3-бет — 77%, колл — 23%. Твой 3-бет входит в стратегию."
 *   randomizerNote "По рандомайзеру в этой раздаче выпал колл."
 */
export function buildPracticeAnswerFeedback({
  hand,
  frequencies,
  randomizerPercent,
  resolvedAction,
  selectedAction,
  outcome,
  actions,
}: AcademyPracticeFeedbackInput): AcademyPracticeFeedback {
  const selected = findAction(actions, selectedAction);
  const resolved = findAction(actions, resolvedAction);
  const pureAction = actions.find((action) => (frequencies[action.code] ?? 0) >= 1);
  const selectedShort = solverActionShortLabel(selected);

  if (pureAction) {
    const always = pureAction.ru?.always ?? `всегда играем: ${solverActionInlineLabel(pureAction)}`;
    const line = `С ${hand} здесь ${always}.`;
    const detail = "Эта рука не смешанная: стратегия всегда выбирает одно действие, рандомайзер на неё не влияет.";
    return outcome === "NOT_IN_STRATEGY"
      ? {
        tone: "incorrect",
        title: "Не входит в стратегию",
        summary: `${line} ${capitalize(selectedShort)} здесь не играют.`,
        randomizerNote: null,
        detail,
      }
      : { tone: "correct", title: "Верно", summary: line, randomizerNote: null, detail };
  }

  const list = `${formatPracticeFrequencyList(frequencies, actions)}.`;
  const mixedDetail =
    "Это смешанная рука: стратегия играет её разными действиями с разной частотой. " +
    "В зачёт идёт любое действие, которое входит в стратегию (частота больше 0%). " +
    `Рандомайзер — число от 0 до 99 (здесь ${randomizerPercent}) — лишь показывает, какое из действий ` +
    "выпало бы в этой конкретной раздаче.";
  if (outcome === "NOT_IN_STRATEGY") {
    return {
      tone: "incorrect",
      title: "Не входит в стратегию",
      summary: `${list} ${capitalize(selectedShort)} с этой рукой здесь не играют.`,
      randomizerNote: null,
      detail: `${mixedDetail} Действие с частотой 0% стратегия здесь не выбирает никогда — поэтому оно не засчитано.`,
    };
  }
  const verdict = `Твой ${selectedShort} входит в стратегию.`;
  if (outcome === "VALID_MIXED") {
    return {
      tone: "valid",
      title: "Допустимое решение",
      summary: `${list} ${verdict}`,
      randomizerNote: `По рандомайзеру в этой раздаче выпал ${solverActionShortLabel(resolved)}.`,
      detail: `${mixedDetail} Твой выбор засчитан как верный.`,
    };
  }
  return {
    tone: "correct",
    title: "Верно",
    summary: `${list} ${verdict}`,
    randomizerNote: `По рандомайзеру в этой раздаче тоже выпал ${solverActionShortLabel(resolved)}.`,
    detail: mixedDetail,
  };
}
