/**
 * Three-state answer outcome for the NORMAL practice trainers (configurable
 * preflop trainer, Preflop Quick Mix, Push/Fold). Pure and client-safe, but
 * the outcome a client renders always comes from the SERVER reveal / verifier
 * — a client-computed "was this valid" flag is never trusted.
 *
 *   RESOLVED_MATCH   selected == the randomizer-resolved action      → correct
 *   VALID_MIXED      selected != resolved, but its frequency > 0     → correct
 *                    (a genuine part of a mixed strategy; never a mistake)
 *   NOT_IN_STRATEGY  selected action's frequency == 0               → wrong
 *
 * The 100bb HRC Solver Lab trainer deliberately does NOT use this module: it
 * keeps its exact-randomizer-execution scoring (`verifyAcademySolverAttempt`).
 */
import type {
  AcademySolverAction,
  AcademyStrategyAnswerOutcome,
  AcademyStrategyHandFrequencies,
} from "@/types/academy";

export type { AcademyStrategyAnswerOutcome };

export const ACADEMY_STRATEGY_ANSWER_OUTCOMES = Object.freeze([
  "RESOLVED_MATCH",
  "VALID_MIXED",
  "NOT_IN_STRATEGY",
] as const satisfies readonly AcademyStrategyAnswerOutcome[]);

export function classifyStrategyAnswer({
  frequencies,
  selectedAction,
  resolvedAction,
}: {
  readonly frequencies: AcademyStrategyHandFrequencies;
  readonly selectedAction: AcademySolverAction;
  readonly resolvedAction: AcademySolverAction;
}): AcademyStrategyAnswerOutcome {
  if (selectedAction === resolvedAction) return "RESOLVED_MATCH";
  const frequency = frequencies[selectedAction] ?? 0;
  return Number.isFinite(frequency) && frequency > 0 ? "VALID_MIXED" : "NOT_IN_STRATEGY";
}

/** Normal practice scoring: any action the strategy plays (> 0%) counts as correct. */
export function strategyAnswerCountsAsCorrect(outcome: AcademyStrategyAnswerOutcome): boolean {
  return outcome !== "NOT_IN_STRATEGY";
}
