/**
 * Weighted answer scoring for the NORMAL practice trainers (configurable
 * preflop trainer, Preflop Quick Mix, and the — currently disabled — scored
 * Push/Fold path). Pure and client-safe, but the outcome a client renders
 * always comes from the SERVER reveal / verifier — a client-computed flag is
 * never trusted.
 *
 * The outcome depends on the hand's strategy FREQUENCIES only. The
 * randomizer is not an input here (it is post-answer explanation only), so
 * it can never decide points:
 *
 *   PRIMARY                selected action has the highest frequency      2 units = 1 point
 *                          (every action tied for the highest is primary)
 *   SUPPORTED_ALTERNATIVE  frequency > 0 but not a highest-frequency one  1 unit  = 0.5 point
 *   NOT_IN_STRATEGY        frequency 0 / missing / non-finite             0 units = 0 points
 *
 * Sessions are scored in integer half-point UNITS (no floating-point
 * ambiguity): percentage = round(units * 100 / maxUnits). With 10 questions
 * maxUnits = 20 and units is an integer in [0, 20], so percentage = 5 * units
 * — always a whole multiple of 5 that fits the existing integer
 * `score_percent` column (no migration).
 *
 * This is a NARROW scorer parallel to `scoreTrainingSession`
 * (lib/academy/training.ts), whose contract is unchanged: the old basic
 * binary trainer and the 100bb HRC Solver Lab trainer
 * (`verifyAcademySolverAttempt`, exact-randomizer scoring) keep using it and
 * never use this module.
 */
import { ACADEMY_PASS_THRESHOLD } from "@/config/academy/training";
import type {
  AcademySolverAction,
  AcademyStrategyAnswerOutcome,
  AcademyStrategyAnswerPoints,
  AcademyStrategyHandFrequencies,
  AcademyTrainingResult,
  AcademyWeightedTrainingResult,
} from "@/types/academy";

export type { AcademyStrategyAnswerOutcome, AcademyWeightedTrainingResult };

export const ACADEMY_STRATEGY_ANSWER_OUTCOMES = Object.freeze([
  "PRIMARY",
  "SUPPORTED_ALTERNATIVE",
  "NOT_IN_STRATEGY",
] as const satisfies readonly AcademyStrategyAnswerOutcome[]);

/** Half-point units per outcome (2 units = 1 point). */
export const ACADEMY_STRATEGY_ANSWER_UNITS: Readonly<Record<AcademyStrategyAnswerOutcome, 0 | 1 | 2>> = Object.freeze({
  PRIMARY: 2,
  SUPPORTED_ALTERNATIVE: 1,
  NOT_IN_STRATEGY: 0,
});

/** Max units of one answer. */
export const ACADEMY_STRATEGY_ANSWER_MAX_UNITS = ACADEMY_STRATEGY_ANSWER_UNITS.PRIMARY;

/**
 * Tolerance for "tied for the highest frequency": dataset frequencies are
 * decimal fractions, so two actions shown as 50% / 50% may differ by float
 * noise. Far below any real strategic difference (0.0001%).
 */
const TIE_EPSILON = 1e-6;

function playedFrequency(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The highest-frequency action(s) of a hand, in the frequency map's key order
 * (several on a tie). Non-finite / non-positive entries are ignored; an empty
 * result means the map has no playable action.
 */
export function primaryStrategyActions(frequencies: AcademyStrategyHandFrequencies): AcademySolverAction[] {
  const played = Object.keys(frequencies)
    .map((code) => ({ code, frequency: playedFrequency(frequencies[code]) }))
    .filter((entry): entry is { code: string; frequency: number } => entry.frequency !== null);
  if (played.length === 0) return [];
  const max = Math.max(...played.map((entry) => entry.frequency));
  return played.filter((entry) => max - entry.frequency <= TIE_EPSILON).map((entry) => entry.code);
}

/** Frequency-only outcome of one answer (see the module comment). Never throws. */
export function classifyStrategyAnswer({
  frequencies,
  selectedAction,
}: {
  readonly frequencies: AcademyStrategyHandFrequencies;
  readonly selectedAction: AcademySolverAction;
}): AcademyStrategyAnswerOutcome {
  const own = Object.prototype.hasOwnProperty.call(frequencies, selectedAction) ? frequencies[selectedAction] : undefined;
  if (playedFrequency(own) === null) return "NOT_IN_STRATEGY";
  return primaryStrategyActions(frequencies).includes(selectedAction) ? "PRIMARY" : "SUPPORTED_ALTERNATIVE";
}

/** Points of an outcome: 1 / 0.5 / 0. */
export function strategyAnswerPoints(outcome: AcademyStrategyAnswerOutcome): AcademyStrategyAnswerPoints {
  return outcome === "PRIMARY" ? 1 : outcome === "SUPPORTED_ALTERNATIVE" ? 0.5 : 0;
}

/** True iff the answer earns points (anything the strategy plays, > 0%). */
export function strategyAnswerCountsAsCorrect(outcome: AcademyStrategyAnswerOutcome): boolean {
  return outcome !== "NOT_IN_STRATEGY";
}

/** True iff the answer belongs in "Разобрать ошибки" (only 0-point answers). */
export function strategyAnswerIsMistake(outcome: AcademyStrategyAnswerOutcome): boolean {
  return outcome === "NOT_IN_STRATEGY";
}

function trainingFeedback(ratio: number, passed: boolean): AcademyTrainingResult["feedback"] {
  return ratio >= 0.9 ? "Отлично" : passed ? "Пройдено" : "Стоит повторить диапазон";
}

/**
 * Weighted session score from the per-question outcomes (server-computed by
 * the verifier). Uses the unchanged shared pass threshold
 * (`ACADEMY_PASS_THRESHOLD`) against the weighted percentage.
 */
export function scoreWeightedPracticeSession(
  outcomes: readonly AcademyStrategyAnswerOutcome[],
  totalQuestions: number,
): AcademyWeightedTrainingResult {
  if (!Number.isInteger(totalQuestions) || totalQuestions <= 0 || outcomes.length !== totalQuestions) {
    throw new Error("Invalid weighted training score");
  }
  let scoreUnits = 0;
  const counts: Record<AcademyStrategyAnswerOutcome, number> = { PRIMARY: 0, SUPPORTED_ALTERNATIVE: 0, NOT_IN_STRATEGY: 0 };
  for (const outcome of outcomes) {
    if (!(ACADEMY_STRATEGY_ANSWER_OUTCOMES as readonly string[]).includes(outcome)) {
      throw new Error("Invalid weighted training outcome");
    }
    counts[outcome] += 1;
    scoreUnits += ACADEMY_STRATEGY_ANSWER_UNITS[outcome];
  }
  const maxScoreUnits = totalQuestions * ACADEMY_STRATEGY_ANSWER_MAX_UNITS;
  const ratio = scoreUnits / maxScoreUnits;
  const passed = ratio >= ACADEMY_PASS_THRESHOLD;
  return {
    correctAnswers: counts.PRIMARY,
    totalQuestions,
    percentage: Math.round((scoreUnits * 100) / maxScoreUnits),
    passed,
    feedback: trainingFeedback(ratio, passed),
    scoring: "WEIGHTED_HALF_POINTS",
    scoreUnits,
    maxScoreUnits,
    scorePoints: scoreUnits / 2,
    primaryAnswers: counts.PRIMARY,
    supportedAlternativeAnswers: counts.SUPPORTED_ALTERNATIVE,
    notInStrategyAnswers: counts.NOT_IN_STRATEGY,
  };
}

/** Type guard for a weighted result (e.g. to show "8.5 / 10"). */
export function isWeightedTrainingResult(result: AcademyTrainingResult): result is AcademyWeightedTrainingResult {
  return (result as Partial<AcademyWeightedTrainingResult>).scoring === "WEIGHTED_HALF_POINTS"
    && typeof (result as Partial<AcademyWeightedTrainingResult>).scorePoints === "number";
}
