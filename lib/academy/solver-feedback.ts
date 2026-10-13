/**
 * Post-answer feedback copy (client-safe, pure).
 *
 * - `buildSolverAnswerFeedback`: the 100bb HRC Solver Lab trainer. Its
 *   verifier counts a question as correct only when the choice matches the
 *   session's resolved action (exact-randomizer training, unchanged). The
 *   copy never calls a mixed-hand disagreement "wrong".
 * - `buildPracticeAnswerFeedback`: normal practice (configurable trainer +
 *   Quick Mix). Weighted: the primary (highest-frequency) action is "Верно"
 *   (+1), another action the strategy plays is "Допустимое решение" (+0.5),
 *   a 0% action "Не входит в стратегию" (+0). Frequencies are primary, the
 *   randomizer is a secondary explanation that never affects points.
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
 * `correct` = the primary action (+1). `valid` = a supported alternative: the
 * strategy plays it, but it is not the primary action (+0.5) — a calm
 * neutral state, never styled as an error. `incorrect` = 0% (+0).
 */
export type AcademyPracticeFeedbackTone = "correct" | "valid" | "incorrect";

/**
 * Compact verdict about THE HAND (not about the trainer's internals). The
 * whole-range grid shown under it is the main explanation; nothing here is a
 * long paragraph.
 */
export type AcademyPracticeFeedback = {
  readonly tone: AcademyPracticeFeedbackTone;
  /** "Верно" / "Допустимое решение" / "Не входит в стратегию". */
  readonly title: string;
  readonly hand: StartingHandClass;
  /** "Фолд — 83% · Рейз — 17%": actions the strategy plays, most frequent first. */
  readonly frequencyLine: string;
  /** One or two short sentences, e.g. "Основное решение — фолд. Рейз здесь тоже входит в стратегию." */
  readonly summary: string;
  /** True when the strategy plays this hand with more than one action. */
  readonly mixed: boolean;
  /**
   * SECONDARY, mixed hands only (null for a pure hand): what the randomizer
   * picked in this deal. Rendered only inside the collapsed "Как считается
   * оценка?" disclosure — it never affects points.
   */
  readonly randomizerNote: string | null;
};

export type AcademyPracticeFeedbackInput = {
  readonly hand: StartingHandClass;
  readonly frequencies: AcademyStrategyHandFrequencies;
  readonly randomizerPercent: number;
  readonly resolvedAction: AcademySolverAction;
  readonly selectedAction: AcademySolverAction;
  /** Server-computed outcome from the reveal — the copy never re-derives scoring. */
  readonly outcome: AcademyStrategyAnswerOutcome;
  /** Server-computed highest-frequency action(s) of the hand (from the reveal). */
  readonly primaryActions: readonly AcademySolverAction[];
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
 * One hand's played actions as a compact line, each label capitalized and
 * zero-frequency actions omitted: "Рейз — 17% · Фолд — 83%".
 * `order: "strategy"` keeps the node's own action order (range inspector);
 * `"frequency"` lists the most frequent first (answer verdict).
 */
export function formatStrategyHandFrequencyLine(
  frequencies: AcademyStrategyHandFrequencies,
  actions: readonly AcademySolverActionCopySource[],
  order: "strategy" | "frequency" = "strategy",
): string {
  const entries = actions
    .map((action, index) => ({ action, index, frequency: frequencies[action.code] ?? 0 }))
    .filter((entry) => entry.frequency > 0);
  if (order === "frequency") entries.sort((a, b) => b.frequency - a.frequency || a.index - b.index);
  return entries
    .map((entry) => `${capitalize(solverActionShortLabel(entry.action))} — ${formatSolverFrequencyPercent(entry.frequency)}`)
    .join(" · ");
}

/** "фолд", "3-бет и колл" — a short Russian list of action names. */
function joinActionNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} и ${names[names.length - 1]}`;
}

/**
 * Scoring rules of normal practice, shown only inside the collapsed "Как
 * считается оценка?" disclosure (never inline after every answer). Mirrors
 * `classifyStrategyAnswer` / `strategyAnswerPoints` — copy only.
 */
export const ACADEMY_PRACTICE_SCORING_HELP: readonly string[] = Object.freeze([
  "Основное действие: +1",
  "Другое действие с частотой больше 0%: +0.5",
  "Действие с частотой 0%: 0",
]);

/** Added to the scoring help for mixed hands only. */
export const ACADEMY_PRACTICE_RANDOMIZER_HELP =
  "Рандомайзер показывает один вариант смешанной стратегии и на очки не влияет.";

/**
 * Compact three-state weighted verdict for normal practice (configurable
 * trainer + Quick Mix). Every action name comes from the node's own action
 * definitions — nothing is hard-coded to raise / fold. Examples (55: фолд 83%
 * / рейз 17%):
 *   pick фолд → "Верно"              "Основное решение — фолд."
 *   pick рейз → "Допустимое решение" "Основное решение — фолд. Рейз здесь тоже входит в стратегию."
 * A pure hand ("AA: Рейз — 100%") gets only "Основное решение — рейз." and no
 * mixed-strategy / randomizer framing at all. The randomizer is a secondary
 * note for mixed hands and never affects points.
 */
export function buildPracticeAnswerFeedback({
  hand,
  frequencies,
  randomizerPercent,
  resolvedAction,
  selectedAction,
  outcome,
  primaryActions,
  actions,
}: AcademyPracticeFeedbackInput): AcademyPracticeFeedback {
  const selectedShort = solverActionShortLabel(findAction(actions, selectedAction));
  const played = actions.filter((action) => (frequencies[action.code] ?? 0) > 0);
  const mixed = played.length > 1;
  const primaryNames = primaryActions.map((code) => solverActionShortLabel(findAction(actions, code)));
  const main = primaryNames.length > 1
    ? `Основные решения — ${joinActionNames(primaryNames)}.`
    : `Основное решение — ${primaryNames[0] ?? ""}.`;
  const frequencyLine = formatStrategyHandFrequencyLine(frequencies, actions, "frequency");
  const randomizerNote = mixed
    ? `Рандомайзер ${randomizerPercent} — в этой раздаче выпал ${solverActionShortLabel(findAction(actions, resolvedAction))}.`
    : null;
  const base = { hand, frequencyLine, mixed, randomizerNote } as const;

  if (outcome === "NOT_IN_STRATEGY") {
    return {
      ...base,
      tone: "incorrect",
      title: "Не входит в стратегию",
      summary: `${main} Выбранное действие здесь не используется.`,
    };
  }
  if (outcome === "SUPPORTED_ALTERNATIVE") {
    return {
      ...base,
      tone: "valid",
      title: "Допустимое решение",
      summary: `${main} ${capitalize(selectedShort)} здесь тоже входит в стратегию.`,
    };
  }
  return { ...base, tone: "correct", title: "Верно", summary: main };
}
