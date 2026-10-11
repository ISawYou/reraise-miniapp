import "server-only";

import { getAcademyStrategyDataset } from "@/config/academy/solver-datasets";
import { getAcademySolverLessonBinding } from "@/config/academy/solver-lessons";
import { ACADEMY_TRAINING_QUESTION_COUNT } from "@/config/academy/training";
import {
  ACADEMY_SOLVER_BUCKET_TARGETS,
  getAcademyStrategyNode,
  getAcademyStrategyNodeActions,
  resolveAcademyStrategyNodeAction,
  sampleBalancedSolverHands,
} from "@/lib/academy/solver";
import { createDeterministicRandom, deriveDeterministicUnit } from "@/lib/academy/solver-session";
import { renderStartingHand } from "@/lib/academy/training";
import type {
  AcademySolverAction,
  AcademySolverHandBucket,
  AcademySolverLessonBinding,
  AcademySolverPublicAction,
  AcademySolverPublicQuestion,
  AcademyStrategyActionCode,
  AcademyStrategyActionDefinition,
  AcademyStrategyDataset,
  AcademyStrategyHandFrequencies,
  AcademyStrategyNodeKey,
  RenderedPlayingCard,
  StartingHandClass,
} from "@/types/academy";

/** Solver Lab sessions reuse the shared 10-question session length. */
export const ACADEMY_SOLVER_QUESTION_COUNT = ACADEMY_TRAINING_QUESTION_COUNT;

export type AcademySolverSessionKey = {
  readonly playerId: string;
  readonly lessonCode: string;
  readonly attemptId: string;
  /** Strategy node the session draws hands from (from the lesson binding). */
  readonly nodeKey: AcademyStrategyNodeKey;
};

/** Which strategy a session trains: a dataset plus the sampler's primary action. */
export type AcademySolverSessionStrategy = {
  readonly dataset: AcademyStrategyDataset;
  /** Action whose frequency defines the pure/mixed sampler buckets. */
  readonly primaryActionCode: AcademyStrategyActionCode;
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
  /** Safe display metadata of the node's actions, in resolver order. */
  readonly actions: readonly AcademySolverPublicAction[];
};

/**
 * Per-question randomizer: integer in [0, 99] from
 * HMAC(SESSION_SECRET, `${playerId}:${lessonCode}:${attemptId}:${questionIndex}:resolve`).
 */
export function deriveSolverRandomizerPercent(
  key: Omit<AcademySolverSessionKey, "nodeKey">,
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
 * Explicit whitelist projection of an action definition to answer-free
 * display metadata (code, kind, label, optional size and localized copy).
 */
export function toPublicSolverAction(action: AcademyStrategyActionDefinition): AcademySolverPublicAction {
  return Object.freeze({
    code: action.code,
    kind: action.kind,
    label: action.label,
    ...(action.amountBb === undefined ? {} : { amountBb: action.amountBb }),
    ...(action.ru === undefined
      ? {}
      : {
        ru: Object.freeze({
          button: action.ru.button,
          inline: action.ru.inline,
          short: action.ru.short,
          ...(action.ru.always === undefined ? {} : { always: action.ru.always }),
        }),
      }),
  });
}

/**
 * Regenerates the full Solver Lab session for `(playerId, lessonCode,
 * attemptId)` over `strategy.dataset`'s node `key.nodeKey`: which hands
 * (balanced 4 mixed / 3 pure / 3 pure by the primary action), their order,
 * their card rendering, and each hand's randomizer + resolved action (walked
 * in the node's declared action order, for any number of actions). Pure
 * function of its inputs + SESSION_SECRET, so the question endpoint and the
 * verifier always agree without stored state.
 *
 * Derivation inputs are unchanged from the original 100bb trainer: the
 * dataset/node only select WHICH strategy is sampled, they are never mixed
 * into the HMAC parts, so existing (player, lesson, attempt) sessions
 * reproduce exactly.
 */
export function buildAcademySolverSession(
  key: AcademySolverSessionKey,
  strategy: AcademySolverSessionStrategy,
): readonly AcademySolverSessionQuestion[] {
  const node = getAcademyStrategyNode(strategy.dataset, key.nodeKey);
  if (!node.actionCodes.includes(strategy.primaryActionCode)) {
    throw new Error(`Node ${node.key} has no primary action ${strategy.primaryActionCode}`);
  }
  const hands = node.hands;
  const actions = Object.freeze(getAcademyStrategyNodeActions(strategy.dataset, node).map(toPublicSolverAction));

  const sampled = sampleBalancedSolverHands({
    hands,
    primaryAction: strategy.primaryActionCode,
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
      resolvedAction: resolveAcademyStrategyNodeAction(node, hand, randomizerPercent),
      actions,
    });
  }));
}

/** Fail-closed: the binding of a Solver Lab lesson, or throws. */
export function requireAcademySolverLessonBinding(lessonCode: string): AcademySolverLessonBinding {
  const binding = getAcademySolverLessonBinding(lessonCode);
  if (!binding) throw new Error(`No Solver Lab binding for lesson ${lessonCode}`);
  return binding;
}

/**
 * Builds a lesson's session through its canonical binding: dataset (from the
 * registry, fail closed), node and primary action are all taken from
 * `ACADEMY_SOLVER_LESSON_BINDINGS`, never inferred from the lesson code text.
 */
export function buildAcademySolverSessionForLesson(
  key: Omit<AcademySolverSessionKey, "nodeKey">,
): readonly AcademySolverSessionQuestion[] {
  const binding = requireAcademySolverLessonBinding(key.lessonCode);
  return buildAcademySolverSession(
    { ...key, nodeKey: binding.selector.nodeKey },
    { dataset: getAcademyStrategyDataset(binding.datasetId), primaryActionCode: binding.primaryActionCode },
  );
}

/** Strips everything that would reveal the answer before the player responds. */
export function toPublicSolverQuestion(question: AcademySolverSessionQuestion): AcademySolverPublicQuestion {
  return {
    hand: question.hand,
    renderedCards: question.renderedCards,
    randomizerPercent: question.randomizerPercent,
    actions: question.actions,
  };
}
