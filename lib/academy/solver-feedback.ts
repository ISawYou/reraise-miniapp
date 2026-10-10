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

export type AcademySolverFeedbackInput = {
  readonly hand: StartingHandClass;
  readonly frequencies: AcademyStrategyHandFrequencies;
  readonly randomizerPercent: number;
  readonly resolvedAction: AcademySolverAction;
  readonly selectedAction: AcademySolverAction;
};

export function formatSolverFrequencyPercent(frequency: number): string {
  const percent = frequency * 100;
  if (percent > 0 && percent < 1) return "<1%";
  if (percent < 100 && percent > 99) return ">99%";
  return `${Math.round(percent)}%`;
}

export function solverActionLabel(action: AcademySolverAction): string {
  return action === "RAISE_2_25BB" ? "рейз 2.25 BB" : "фолд";
}

function solverActionShortLabel(action: AcademySolverAction): string {
  return action === "RAISE_2_25BB" ? "рейз" : "фолд";
}

export function buildSolverAnswerFeedback({
  hand,
  frequencies,
  randomizerPercent,
  resolvedAction,
  selectedAction,
}: AcademySolverFeedbackInput): AcademySolverFeedback {
  const raise = frequencies.RAISE_2_25BB ?? 0;
  const fold = frequencies.FOLD ?? 0;
  const split = `рейз ${formatSolverFrequencyPercent(raise)} / фолд ${formatSolverFrequencyPercent(fold)}`;
  const matches = selectedAction === resolvedAction;

  if (raise > 0 && raise < 1) {
    const outcome = `Рандомайзер ${randomizerPercent} → в этой раздаче выпал ${solverActionShortLabel(resolvedAction)}.`;
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
      summary: `Солверная частота для ${hand} смешанная: ${split}.`,
      detail:
        `${outcome} Но ${solverActionShortLabel(selectedAction)} здесь тоже часть стратегии — ` +
        "просто с другой частотой. В зачёт тренировки идёт действие, выпавшее на рандомайзере.",
    };
  }

  const pureAction: AcademySolverAction = raise >= 1 ? "RAISE_2_25BB" : "FOLD";
  const pureDetail = pureAction === "RAISE_2_25BB"
    ? `С этой позиции ${hand} всегда открываем рейзом (${split}).`
    : `С этой позиции ${hand} всегда сбрасываем (${split}).`;
  return matches
    ? { tone: "correct", title: "Верно", summary: `Действие: ${solverActionLabel(resolvedAction)}.`, detail: pureDetail }
    : { tone: "incorrect", title: "Не совсем", summary: `Действие: ${solverActionLabel(resolvedAction)}.`, detail: pureDetail };
}
