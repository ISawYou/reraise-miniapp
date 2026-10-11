import "server-only";

/**
 * Configurable Solver Lab preflop trainer — server side.
 *
 * - Spot index: derived at runtime from the REAL registered datasets in
 *   `ACADEMY_PREFLOP_TRAINER_DATASET_IDS` (their nodes + the hero / villain /
 *   scenario stored per node in `provenance.nodeSources`). Only nodes that
 *   exist (i.e. were imported and validated) are selectable; skipped and
 *   rejected nodes are absent from the datasets and therefore never offered.
 * - Selection validation: fail closed. A client-supplied datasetId / nodeKey
 *   is accepted only if it is an own key of a whitelisted, registered dataset.
 * - Sessions: same architecture as the 100bb Solver Lab trainer
 *   (HMAC-derived, server-authoritative, regenerated — never stored), but
 *   with their OWN derivation inputs: the configurable lesson code, the
 *   dataset id, the node key and a "preflop-trainer" namespace tag are all
 *   HMAC parts, so a session can never collide with a 100bb lesson session
 *   or with another node's session. The 100bb derivation is not touched.
 */
import {
  ACADEMY_PREFLOP_TRAINER_DATASET_IDS,
  ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE,
} from "@/config/academy/preflop-trainer";
import { getAcademyStrategyDataset } from "@/config/academy/solver-datasets";
import { describePreflopTrainerSpot, localizePreflopTrainerAction } from "@/lib/academy/preflop-trainer-copy";
import { isAcademyPreflopTrainerSituation } from "@/lib/academy/preflop-trainer-selection";
import {
  getAcademyStrategyNode,
  getAcademyStrategyNodeActions,
  resolveAcademyStrategyNodeAction,
  sampleBalancedStrategyHands,
} from "@/lib/academy/solver";
import { createDeterministicRandom, deriveDeterministicUnit } from "@/lib/academy/solver-session";
import { ACADEMY_SOLVER_QUESTION_COUNT, toPublicSolverAction } from "@/lib/academy/solver-training";
import { renderStartingHand } from "@/lib/academy/training";
import type {
  AcademyPreflopTrainerPublicQuestion,
  AcademyPreflopTrainerSpot,
  AcademyPreflopTrainerSpotCopy,
  AcademySolverAction,
  AcademySolverPublicAction,
  AcademyStrategyDataset,
  AcademyStrategyHandBucket,
  AcademyStrategyHandFrequencies,
  AcademyStrategyNode,
  RenderedPlayingCard,
  StartingHandClass,
} from "@/types/academy";

export class AcademyPreflopTrainerSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcademyPreflopTrainerSelectionError";
  }
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function buildSpot(dataset: AcademyStrategyDataset, node: AcademyStrategyNode): AcademyPreflopTrainerSpot {
  const source = dataset.provenance.nodeSources?.[node.key];
  const situation = source?.scenario;
  const heroPosition = source?.heroPosition;
  const villainPosition = source?.villainPosition;
  if (!source || !isAcademyPreflopTrainerSituation(situation) || typeof heroPosition !== "string" || heroPosition === "") {
    throw new AcademyPreflopTrainerSelectionError(`Node ${dataset.id}/${node.key} has no usable spot description`);
  }
  const needsVillain = situation !== "RFI";
  if (needsVillain !== (typeof villainPosition === "string" && villainPosition !== "")) {
    throw new AcademyPreflopTrainerSelectionError(`Node ${dataset.id}/${node.key} has an inconsistent villain`);
  }
  return Object.freeze({
    datasetId: dataset.id,
    nodeKey: node.key,
    stackBb: dataset.metadata.effectiveStackBb,
    situation,
    heroPosition,
    ...(needsVillain ? { villainPosition: villainPosition as string } : {}),
    actionCount: node.actionCodes.length,
  });
}

let spotIndex: readonly AcademyPreflopTrainerSpot[] | null = null;

/**
 * Every selectable spot: one per real node of every whitelisted dataset, in
 * dataset (stack) order then the dataset's own node order. Built lazily from
 * the registry and memoized (datasets are immutable).
 */
export function listAcademyPreflopTrainerSpots(): readonly AcademyPreflopTrainerSpot[] {
  if (!spotIndex) {
    spotIndex = Object.freeze(ACADEMY_PREFLOP_TRAINER_DATASET_IDS.flatMap((datasetId) => {
      const dataset = getAcademyStrategyDataset(datasetId);
      return Object.keys(dataset.nodes).map((nodeKey) => buildSpot(dataset, dataset.nodes[nodeKey]));
    }));
  }
  return spotIndex;
}

export type AcademyPreflopTrainerResolvedSpot = {
  readonly spot: AcademyPreflopTrainerSpot;
  readonly dataset: AcademyStrategyDataset;
  readonly node: AcademyStrategyNode;
};

/**
 * Fail-closed selection lookup: `datasetId` must be a whitelisted registered
 * dataset and `nodeKey` an OWN node key of it. Anything else (unknown,
 * forged, wrong type, the HRC dataset, a prototype key, a skipped/rejected
 * node that was never imported) throws.
 */
export function requireAcademyPreflopTrainerSpot(datasetId: unknown, nodeKey: unknown): AcademyPreflopTrainerResolvedSpot {
  if (typeof datasetId !== "string" || !ACADEMY_PREFLOP_TRAINER_DATASET_IDS.includes(datasetId)) {
    throw new AcademyPreflopTrainerSelectionError("Неизвестный набор стратегии тренажёра");
  }
  const dataset = getAcademyStrategyDataset(datasetId);
  if (typeof nodeKey !== "string" || !hasOwn(dataset.nodes, nodeKey)) {
    throw new AcademyPreflopTrainerSelectionError("Неизвестная ситуация тренажёра");
  }
  const node = getAcademyStrategyNode(dataset, nodeKey);
  return { spot: buildSpot(dataset, node), dataset, node };
}

/** Fail-closed lookup by stack + node key (used by the route params). */
export function requireAcademyPreflopTrainerSpotByStack(stackBb: unknown, nodeKey: unknown): AcademyPreflopTrainerResolvedSpot {
  const spot = listAcademyPreflopTrainerSpots().find((candidate) =>
    candidate.stackBb === stackBb && candidate.nodeKey === nodeKey);
  if (!spot) throw new AcademyPreflopTrainerSelectionError("Неизвестная ситуация тренажёра");
  return requireAcademyPreflopTrainerSpot(spot.datasetId, spot.nodeKey);
}

/** Public spot + Russian copy (answer-free). */
export function toPublicPreflopTrainerSpot(
  spot: AcademyPreflopTrainerSpot,
): AcademyPreflopTrainerSpot & AcademyPreflopTrainerSpotCopy {
  return Object.freeze({ ...spot, ...describePreflopTrainerSpot(spot) });
}

/** The node's actions as public display metadata with Russian copy, in resolver order. */
export function getPreflopTrainerPublicActions(resolved: AcademyPreflopTrainerResolvedSpot): readonly AcademySolverPublicAction[] {
  return Object.freeze(getAcademyStrategyNodeActions(resolved.dataset, resolved.node)
    .map((action) => localizePreflopTrainerAction(toPublicSolverAction(action), resolved.spot.situation)));
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** Namespace tag mixed into every HMAC input of this trainer. */
export const ACADEMY_PREFLOP_TRAINER_DERIVATION_TAG = "preflop-trainer";

export type AcademyPreflopTrainerSessionKey = {
  readonly playerId: string;
  readonly attemptId: string;
  readonly datasetId: string;
  readonly nodeKey: string;
};

export type AcademyPreflopTrainerSessionQuestion = {
  readonly questionIndex: number;
  readonly hand: StartingHandClass;
  readonly bucket: AcademyStrategyHandBucket;
  readonly renderedCards: readonly [RenderedPlayingCard, RenderedPlayingCard];
  readonly randomizerPercent: number;
  readonly frequencies: AcademyStrategyHandFrequencies;
  readonly resolvedAction: AcademySolverAction;
  readonly actions: readonly AcademySolverPublicAction[];
  readonly spot: AcademyPreflopTrainerSpot & AcademyPreflopTrainerSpotCopy;
};

function derivationParts(key: AcademyPreflopTrainerSessionKey): string[] {
  return [
    key.playerId,
    ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE,
    key.attemptId,
    ACADEMY_PREFLOP_TRAINER_DERIVATION_TAG,
    key.datasetId,
    key.nodeKey,
  ];
}

/**
 * Per-question randomizer: integer in [0, 99] from HMAC(SESSION_SECRET,
 * `${playerId}:solver_preflop_trainer:${attemptId}:preflop-trainer:${datasetId}:${nodeKey}:${questionIndex}:resolve`).
 */
export function derivePreflopTrainerRandomizerPercent(key: AcademyPreflopTrainerSessionKey, questionIndex: number): number {
  return Math.floor(deriveDeterministicUnit([...derivationParts(key), String(questionIndex), "resolve"]) * 100);
}

/**
 * Regenerates the full 10-question session for (player, attempt, dataset,
 * node): balanced generic N-action hand sample, order, cards, randomizer and
 * resolved action (generic cumulative resolver over the node's own action
 * order). Validates the selection first (fail closed).
 */
export function buildAcademyPreflopTrainerSession(
  key: AcademyPreflopTrainerSessionKey,
): readonly AcademyPreflopTrainerSessionQuestion[] {
  const resolved = requireAcademyPreflopTrainerSpot(key.datasetId, key.nodeKey);
  const { node } = resolved;
  const actions = getPreflopTrainerPublicActions(resolved);
  const spot = toPublicPreflopTrainerSpot(resolved.spot);
  const parts = derivationParts(key);

  const sampled = sampleBalancedStrategyHands({
    hands: node.hands,
    actionCodes: node.actionCodes,
    random: createDeterministicRandom([...parts, "hand-selection"]),
    total: ACADEMY_SOLVER_QUESTION_COUNT,
  });
  if (sampled.length !== ACADEMY_SOLVER_QUESTION_COUNT) {
    throw new Error(`Preflop trainer session must have ${ACADEMY_SOLVER_QUESTION_COUNT} questions`);
  }

  return Object.freeze(sampled.map(({ hand, bucket }, questionIndex) => {
    const randomizerPercent = derivePreflopTrainerRandomizerPercent(key, questionIndex);
    return Object.freeze({
      questionIndex,
      hand,
      bucket,
      renderedCards: renderStartingHand(hand, createDeterministicRandom([...parts, String(questionIndex), "cards"])),
      randomizerPercent,
      frequencies: node.hands[hand],
      resolvedAction: resolveAcademyStrategyNodeAction(node, hand, randomizerPercent),
      actions,
      spot,
    });
  }));
}

/** Strips everything that would reveal the answer before the player responds. */
export function toPublicPreflopTrainerQuestion(
  question: AcademyPreflopTrainerSessionQuestion,
): AcademyPreflopTrainerPublicQuestion {
  return {
    hand: question.hand,
    renderedCards: question.renderedCards,
    randomizerPercent: question.randomizerPercent,
    actions: question.actions,
    spot: question.spot,
  };
}
