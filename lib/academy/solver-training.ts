import "server-only";

import {
  ACADEMY_SOLVER_ACTION_ORDER,
  ACADEMY_SOLVER_RAISE_ACTION,
  getAcademySolverDataset,
} from "@/config/academy/solver-datasets";
import { ACADEMY_TRAINING_QUESTION_COUNT } from "@/config/academy/training";
import {
  ACADEMY_SOLVER_BUCKET_TARGETS,
  resolveActionFromFrequencies,
  sampleBalancedSolverHands,
} from "@/lib/academy/solver";
import { createDeterministicRandom, deriveDeterministicUnit } from "@/lib/academy/solver-session";
import { renderStartingHand } from "@/lib/academy/training";
import type {
  AcademySolverAction,
  AcademySolverHandBucket,
  AcademySolverPublicQuestion,
  AcademyStrategyDataset,
  AcademyStrategyHandFrequencies,
  PreflopPosition,
  RenderedPlayingCard,
  StartingHandClass,
} from "@/types/academy";

/** Solver Lab sessions reuse the shared 10-question session length. */
export const ACADEMY_SOLVER_QUESTION_COUNT = ACADEMY_TRAINING_QUESTION_COUNT;

export type AcademySolverSessionKey = {
  readonly playerId: string;
  readonly lessonCode: string;
  readonly attemptId: string;
  readonly position: PreflopPosition;
};

/** Full server-side view of one question (never sent before the answer). */
export type AcademySolverSessionQuestion = {
  readonly questionIndex: number;
  readonly hand: StartingHandClass;
  readonly bucket: AcademySolverHandBucket;
  readonly renderedCards: readonly [RenderedPlayingCard, RenderedPlayingCard];
  readonly randomizerPercent: number;
  readonly frequencies: AcademyStrategyHandFrequencies;
  readonly resolvedAction: AcademySolverAction;
};

/**
 * Per-question randomizer: integer in [0, 99] from
 * HMAC(SESSION_SECRET, `${playerId}:${lessonCode}:${attemptId}:${questionIndex}:resolve`).
 */
export function deriveSolverRandomizerPercent(
  key: Omit<AcademySolverSessionKey, "position">,
  questionIndex: number,
): number {
  const unit = deriveDeterministicUnit([
    key.playerId,
    key.lessonCode,
    key.attemptId,
    String(questionIndex),
    "resolve",
  ]);
  return Math.floor(unit * 100);
}

/**
 * Regenerates the full Solver Lab session for `(playerId, lessonCode,
 * attemptId)`: which hands (balanced 4 mixed / 3 pure-raise / 3 pure-fold),
 * their order, their card rendering, and each hand's randomizer + resolved
 * action. Pure function of its inputs + SESSION_SECRET, so the question
 * endpoint and the verifier always agree without stored state.
 */
export function buildAcademySolverSession(
  key: AcademySolverSessionKey,
  dataset: AcademyStrategyDataset = getAcademySolverDataset(),
): readonly AcademySolverSessionQuestion[] {
  const hands = dataset.positions[key.position];
  if (!hands) throw new Error(`Dataset ${dataset.id} has no position ${key.position}`);

  const sampled = sampleBalancedSolverHands({
    hands,
    primaryAction: ACADEMY_SOLVER_RAISE_ACTION,
    random: createDeterministicRandom([key.playerId, key.lessonCode, key.attemptId, "hand-selection"]),
    targets: ACADEMY_SOLVER_BUCKET_TARGETS,
  });
  if (sampled.length !== ACADEMY_SOLVER_QUESTION_COUNT) {
    throw new Error(`Solver session must have ${ACADEMY_SOLVER_QUESTION_COUNT} questions`);
  }

  return Object.freeze(sampled.map(({ hand, bucket }, questionIndex) => {
    const frequencies = hands[hand];
    const randomizerPercent = deriveSolverRandomizerPercent(key, questionIndex);
    return Object.freeze({
      questionIndex,
      hand,
      bucket,
      renderedCards: renderStartingHand(
        hand,
        createDeterministicRandom([key.playerId, key.lessonCode, key.attemptId, String(questionIndex), "cards"]),
      ),
      randomizerPercent,
      frequencies,
      resolvedAction: resolveActionFromFrequencies(
        frequencies,
        ACADEMY_SOLVER_ACTION_ORDER,
        randomizerPercent,
      ) as AcademySolverAction,
    });
  }));
}

/** Strips everything that would reveal the answer before the player responds. */
export function toPublicSolverQuestion(question: AcademySolverSessionQuestion): AcademySolverPublicQuestion {
  return {
    hand: question.hand,
    renderedCards: question.renderedCards,
    randomizerPercent: question.randomizerPercent,
  };
}
