import "server-only";

/**
 * Solver Lab Push/Fold trainer — server side. Mirrors the configurable
 * preflop trainer (lib/academy/preflop-trainer.ts) with its OWN identity,
 * whitelist, registry and HMAC namespace:
 *
 * - Spot index: derived at runtime from the REAL nodes of the whitelisted
 *   datasets (`ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS`: HoldemMath ante10,
 *   4–15 BB) and the hero / villain / situation stored per node in
 *   `provenance.nodeSources`. Only imported, validated nodes are selectable.
 * - Selection validation: fail closed. A datasetId must be in the Push/Fold
 *   whitelist (disjoint from the MTT trainer's, never HRC) and is looked up in
 *   the separate Push/Fold registry; a nodeKey must be an OWN node key
 *   (`Object.prototype.hasOwnProperty`), so `__proto__` / `constructor` /
 *   `toString` and friends are rejected.
 * - Sessions: HMAC-derived, server-authoritative, regenerated (never
 *   stored), via the unchanged `deriveDeterministicUnit` /
 *   `createDeterministicRandom` with inputs
 *   `playerId : solver_push_fold_trainer : attemptId : push-fold-trainer : datasetId : nodeKey : …`
 *   — disjoint from every MTT / HRC session input.
 * - Answers: push/fold ranges are PURE, so each hand has exactly one correct
 *   action (`pushFoldPureAction`); a MIXED hand is a data error and throws.
 * - Reference vs scored: the spot index (study pages) covers the REFERENCE
 *   whitelist; SCORED questions additionally require the dataset to be on
 *   `ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS` (currently empty — see
 *   docs/ACADEMY_PUSH_FOLD_AUDIT.md). `buildPushFoldQuestion` enforces it.
 */
import {
  ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS,
  ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS,
  ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE,
} from "@/config/academy/push-fold-trainer";
import { getAcademyPushFoldDataset } from "@/config/academy/push-fold-datasets";
import { CANONICAL_STARTING_HANDS, PREFLOP_RANKS } from "@/lib/academy/preflop";
import { describePushFoldSpot } from "@/lib/academy/push-fold-copy";
import { isAcademyPushFoldSituation } from "@/lib/academy/push-fold-selection";
import { buildPushFoldTableScene } from "@/lib/academy/push-fold-table-scene";
import {
  ACADEMY_STRATEGY_MIXED_BUCKET,
  classifyStrategyHandBucket,
  getAcademyStrategyNode,
  getAcademyStrategyNodeActions,
  shuffleWithRandom,
  type AcademySolverRandom,
} from "@/lib/academy/solver";
import { createDeterministicRandom } from "@/lib/academy/solver-session";
import { ACADEMY_SOLVER_QUESTION_COUNT, toPublicSolverAction } from "@/lib/academy/solver-training";
import {
  classifyStrategyAnswer,
  primaryStrategyActions,
  strategyAnswerCountsAsCorrect,
  strategyAnswerPoints,
} from "@/lib/academy/strategy-answer";
import { renderStartingHand } from "@/lib/academy/training";
import type {
  AcademyPreflopTableScene,
  AcademyPushFoldPublicQuestion,
  AcademyPushFoldPublicSpot,
  AcademyPushFoldReveal,
  AcademyPushFoldSpot,
  AcademySolverAction,
  AcademySolverPublicAction,
  AcademyStrategyDataset,
  AcademyStrategyHandFrequencies,
  AcademyStrategyNode,
  RenderedPlayingCard,
  StartingHandClass,
} from "@/types/academy";

export class AcademyPushFoldSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcademyPushFoldSelectionError";
  }
}

/**
 * Scored Push/Fold training is unavailable for this dataset (not on
 * `ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS`). Thrown instead of serving,
 * revealing or verifying a scored question — fail closed, never a fallback.
 */
export class AcademyPushFoldScoringUnavailableError extends Error {
  constructor(message = "Тренировка Push/Fold с оценкой временно недоступна — диапазоны доступны как справочник") {
    super(message);
    this.name = "AcademyPushFoldScoringUnavailableError";
  }
}

/** True iff `datasetId` is validated for SCORED training (reference ≠ scored). */
export function isAcademyPushFoldDatasetScored(datasetId: unknown): boolean {
  return typeof datasetId === "string"
    && ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS.includes(datasetId)
    && ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS.includes(datasetId);
}

/** True iff any scored Push/Fold training (fixed or Quick) can be served. */
export function isAcademyPushFoldScoredTrainingEnabled(): boolean {
  return ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS.some((datasetId) => isAcademyPushFoldDatasetScored(datasetId));
}

/** Single choke point: every scored question / session passes through here. */
export function assertAcademyPushFoldDatasetScored(datasetId: unknown): void {
  if (!isAcademyPushFoldDatasetScored(datasetId)) throw new AcademyPushFoldScoringUnavailableError();
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function buildSpot(dataset: AcademyStrategyDataset, node: AcademyStrategyNode): AcademyPushFoldSpot {
  const source = dataset.provenance.nodeSources && hasOwn(dataset.provenance.nodeSources, node.key)
    ? dataset.provenance.nodeSources[node.key]
    : undefined;
  const situation = source?.situation;
  const heroPosition = source?.heroPosition;
  const villainPosition = source?.villainPosition;
  if (!source || !isAcademyPushFoldSituation(situation) || typeof heroPosition !== "string" || heroPosition === "") {
    throw new AcademyPushFoldSelectionError(`Node ${dataset.id}/${node.key} has no usable spot description`);
  }
  const needsVillain = situation === "CALL_VS_SHOVE";
  if (needsVillain !== (typeof villainPosition === "string" && villainPosition !== "")) {
    throw new AcademyPushFoldSelectionError(`Node ${dataset.id}/${node.key} has an inconsistent villain`);
  }
  return Object.freeze({
    datasetId: dataset.id,
    nodeKey: node.key,
    stackBb: dataset.metadata.effectiveStackBb,
    situation,
    heroPosition,
    ...(needsVillain ? { villainPosition: villainPosition as string } : {}),
  });
}

let spotIndex: readonly AcademyPushFoldSpot[] | null = null;

/** Every selectable Push/Fold spot (whitelisted datasets' real nodes). Memoized. */
export function listAcademyPushFoldSpots(): readonly AcademyPushFoldSpot[] {
  if (!spotIndex) {
    spotIndex = Object.freeze(ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS.flatMap((datasetId) => {
      const dataset = getAcademyPushFoldDataset(datasetId);
      return Object.keys(dataset.nodes).map((nodeKey) => buildSpot(dataset, dataset.nodes[nodeKey]));
    }));
  }
  return spotIndex;
}

export type AcademyPushFoldResolvedSpot = {
  readonly spot: AcademyPushFoldSpot;
  readonly dataset: AcademyStrategyDataset;
  readonly node: AcademyStrategyNode;
};

/**
 * Fail-closed selection lookup: `datasetId` must be in the Push/Fold
 * whitelist and `nodeKey` an OWN node key of that dataset. Anything else
 * (unknown, forged, wrong type, an MTT / HRC / no-ante / 20 BB dataset, a
 * prototype key) throws `AcademyPushFoldSelectionError`.
 */
export function requireAcademyPushFoldSpot(datasetId: unknown, nodeKey: unknown): AcademyPushFoldResolvedSpot {
  if (typeof datasetId !== "string" || !ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS.includes(datasetId)) {
    throw new AcademyPushFoldSelectionError("Неизвестный набор Push/Fold");
  }
  const dataset = getAcademyPushFoldDataset(datasetId);
  if (typeof nodeKey !== "string" || !hasOwn(dataset.nodes, nodeKey)) {
    throw new AcademyPushFoldSelectionError("Неизвестная ситуация Push/Fold");
  }
  const node = getAcademyStrategyNode(dataset, nodeKey);
  return { spot: buildSpot(dataset, node), dataset, node };
}

/** Fail-closed lookup by stack + node key (route params). */
export function requireAcademyPushFoldSpotByStack(stackBb: unknown, nodeKey: unknown): AcademyPushFoldResolvedSpot {
  const spot = listAcademyPushFoldSpots().find((candidate) => candidate.stackBb === stackBb && candidate.nodeKey === nodeKey);
  if (!spot) throw new AcademyPushFoldSelectionError("Неизвестная ситуация Push/Fold");
  return requireAcademyPushFoldSpot(spot.datasetId, spot.nodeKey);
}

/** The source's own range coverage (`p`, % of combos) for a node — study page only. */
export function getPushFoldSourceCoveragePercent(resolved: AcademyPushFoldResolvedSpot): number {
  const value = resolved.dataset.provenance.nodeSources?.[resolved.node.key]?.sourceCoveragePercent;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AcademyPushFoldSelectionError(`Node ${resolved.spot.nodeKey} has no source coverage`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Scene / public shapes
// ---------------------------------------------------------------------------

const sceneCache = new Map<string, AcademyPreflopTableScene>();

/**
 * Table scene. For a call-vs-shove spot the shover's label comes from the
 * shover's REAL first-in node of the same dataset (its single ALL_IN action's
 * Russian button, "Олл-ин"); no node → no label, never a guess.
 */
export function getPushFoldSpotScene(spot: AcademyPushFoldSpot): AcademyPreflopTableScene {
  const cacheKey = `${spot.datasetId}:${spot.nodeKey}`;
  const cached = sceneCache.get(cacheKey);
  if (cached) return cached;
  let shoveLabel: string | undefined;
  if (spot.situation === "CALL_VS_SHOVE" && spot.villainPosition) {
    const shover = listAcademyPushFoldSpots().find((candidate) =>
      candidate.datasetId === spot.datasetId
      && candidate.situation === "FIRST_IN_SHOVE"
      && candidate.heroPosition === spot.villainPosition);
    if (shover) {
      const { dataset, node } = requireAcademyPushFoldSpot(shover.datasetId, shover.nodeKey);
      const allIn = getAcademyStrategyNodeActions(dataset, node).filter((action) => action.kind === "ALL_IN");
      if (allIn.length === 1) shoveLabel = allIn[0].ru?.button;
    }
  }
  const scene = buildPushFoldTableScene(spot, shoveLabel);
  sceneCache.set(cacheKey, scene);
  return scene;
}

export function toPublicPushFoldSpot(spot: AcademyPushFoldSpot): AcademyPushFoldPublicSpot {
  return Object.freeze({ ...spot, ...describePushFoldSpot(spot), scene: getPushFoldSpotScene(spot) });
}

/** The node's actions (dataset's own Russian copy), in resolver order. */
export function getPushFoldPublicActions(resolved: AcademyPushFoldResolvedSpot): readonly AcademySolverPublicAction[] {
  return Object.freeze(getAcademyStrategyNodeActions(resolved.dataset, resolved.node).map(toPublicSolverAction));
}

// ---------------------------------------------------------------------------
// Pure answers + hand categories
// ---------------------------------------------------------------------------

/**
 * The single correct action of a hand at a pure push/fold node (the
 * `PURE:<code>` bucket of the generic `classifyStrategyHandBucket`). Throws
 * on a MIXED hand — push/fold data never has one.
 */
export function pushFoldPureAction(node: AcademyStrategyNode, hand: StartingHandClass): AcademySolverAction {
  const frequencies = node.hands[hand];
  if (!frequencies) throw new Error(`Node ${node.key} has no strategy for ${hand}`);
  const bucket = classifyStrategyHandBucket(frequencies, node.actionCodes);
  if (bucket === ACADEMY_STRATEGY_MIXED_BUCKET) throw new Error(`Push/Fold node ${node.key} has a mixed hand ${hand}`);
  return bucket.slice("PURE:".length);
}

/**
 * Training category of a hand at a node (for balanced sampling only):
 *   EDGE_IN   in the shove/call range, next to a fold cell on the 13x13 grid
 *   CORE_IN   in the range, all grid neighbours also in the range
 *   EDGE_OUT  a fold, next to an in-range cell
 *   DEEP_OUT  a fold, all grid neighbours also folds
 * "In range" = the node's non-fold action is the hand's pure action.
 * Neighbours are the up / down / left / right cells of the canonical 13x13
 * grid (row = first rank, column = second rank), i.e. the next stronger /
 * weaker kicker or the suited / offsuit / pair neighbour.
 */
export type AcademyPushFoldHandCategory = "EDGE_IN" | "CORE_IN" | "EDGE_OUT" | "DEEP_OUT";

export const ACADEMY_PUSH_FOLD_HAND_CATEGORIES = Object.freeze([
  "EDGE_IN", "EDGE_OUT", "CORE_IN", "DEEP_OUT",
] as const satisfies readonly AcademyPushFoldHandCategory[]);

/**
 * 10-hand plan: 6 boundary hands (3 just inside, 3 just outside the range) and
 * 4 clear hands (2 deep inside, 2 deep outside), so a session is never only
 * AA / 72o-type decisions.
 */
export const ACADEMY_PUSH_FOLD_HAND_PLAN: readonly AcademyPushFoldHandCategory[] = Object.freeze([
  "EDGE_IN", "EDGE_IN", "EDGE_IN",
  "EDGE_OUT", "EDGE_OUT", "EDGE_OUT",
  "CORE_IN", "CORE_IN",
  "DEEP_OUT", "DEEP_OUT",
]);

/** When a category is empty at a node, the nearest one is used instead. */
export const ACADEMY_PUSH_FOLD_HAND_FALLBACK: Readonly<Record<AcademyPushFoldHandCategory, readonly AcademyPushFoldHandCategory[]>> = {
  EDGE_IN: ["CORE_IN", "EDGE_OUT", "DEEP_OUT"],
  CORE_IN: ["EDGE_IN", "EDGE_OUT", "DEEP_OUT"],
  EDGE_OUT: ["DEEP_OUT", "EDGE_IN", "CORE_IN"],
  DEEP_OUT: ["EDGE_OUT", "EDGE_IN", "CORE_IN"],
};

const GRID_SIZE = PREFLOP_RANKS.length;

const handCategoryCache = new WeakMap<AcademyStrategyNode, ReadonlyMap<AcademyPushFoldHandCategory, readonly StartingHandClass[]>>();

/** Hands per category (canonical 13x13 order) for one node. Memoized per node. */
export function classifyPushFoldHands(node: AcademyStrategyNode): ReadonlyMap<AcademyPushFoldHandCategory, readonly StartingHandClass[]> {
  const cached = handCategoryCache.get(node);
  if (cached) return cached;
  const inRange = CANONICAL_STARTING_HANDS.map((hand) => pushFoldPureAction(node, hand) !== "FOLD");
  const categories = new Map<AcademyPushFoldHandCategory, StartingHandClass[]>(
    ACADEMY_PUSH_FOLD_HAND_CATEGORIES.map((category) => [category, []]),
  );
  CANONICAL_STARTING_HANDS.forEach((hand, index) => {
    const row = Math.floor(index / GRID_SIZE);
    const column = index % GRID_SIZE;
    const neighbours = [[row - 1, column], [row + 1, column], [row, column - 1], [row, column + 1]]
      .filter(([r, c]) => r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE)
      .map(([r, c]) => inRange[r * GRID_SIZE + c]);
    const crossesBoundary = neighbours.some((neighbour) => neighbour !== inRange[index]);
    const category: AcademyPushFoldHandCategory = inRange[index]
      ? crossesBoundary ? "EDGE_IN" : "CORE_IN"
      : crossesBoundary ? "EDGE_OUT" : "DEEP_OUT";
    categories.get(category)!.push(hand);
  });
  const frozen = new Map([...categories].map(([category, hands]) => [category, Object.freeze(hands)] as const));
  handCategoryCache.set(node, frozen);
  return frozen;
}

/**
 * Picks one hand of `wanted` category (or its fallbacks) uniformly, avoiding
 * `used` hands while any alternative exists in that category chain.
 */
export function pickPushFoldHand(
  node: AcademyStrategyNode,
  wanted: AcademyPushFoldHandCategory,
  used: ReadonlySet<StartingHandClass>,
  random: AcademySolverRandom,
): { hand: StartingHandClass; category: AcademyPushFoldHandCategory } {
  const categories = classifyPushFoldHands(node);
  const chain = [wanted, ...ACADEMY_PUSH_FOLD_HAND_FALLBACK[wanted]];
  for (const allowUsed of [false, true]) {
    for (const category of chain) {
      const pool = (categories.get(category) ?? []).filter((hand) => allowUsed || !used.has(hand));
      if (pool.length > 0) {
        return { hand: pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))], category };
      }
    }
  }
  throw new Error(`Push/Fold node ${node.key} has no hands`);
}

// ---------------------------------------------------------------------------
// Fixed-node session
// ---------------------------------------------------------------------------

export const ACADEMY_PUSH_FOLD_TRAINER_DERIVATION_TAG = "push-fold-trainer";

export type AcademyPushFoldSessionKey = {
  readonly playerId: string;
  readonly attemptId: string;
  readonly datasetId: string;
  readonly nodeKey: string;
};

export type AcademyPushFoldSessionQuestion = {
  readonly questionIndex: number;
  readonly hand: StartingHandClass;
  readonly category: AcademyPushFoldHandCategory;
  readonly renderedCards: readonly [RenderedPlayingCard, RenderedPlayingCard];
  readonly frequencies: AcademyStrategyHandFrequencies;
  readonly resolvedAction: AcademySolverAction;
  readonly actions: readonly AcademySolverPublicAction[];
  readonly spot: AcademyPushFoldPublicSpot;
};

function derivationParts(key: AcademyPushFoldSessionKey): string[] {
  return [
    key.playerId,
    ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE,
    key.attemptId,
    ACADEMY_PUSH_FOLD_TRAINER_DERIVATION_TAG,
    key.datasetId,
    key.nodeKey,
  ];
}

/**
 * One SCORED session question for a resolved node + hand (shared by fixed-node
 * and Quick). The scored-dataset gate lives here, so no scored question can be
 * built from a node outside `ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS`, whichever
 * path asks for it.
 */
export function buildPushFoldQuestion(
  resolved: AcademyPushFoldResolvedSpot,
  questionIndex: number,
  hand: StartingHandClass,
  category: AcademyPushFoldHandCategory,
  cardsRandom: AcademySolverRandom,
): AcademyPushFoldSessionQuestion {
  assertAcademyPushFoldDatasetScored(resolved.dataset.id);
  return Object.freeze({
    questionIndex,
    hand,
    category,
    renderedCards: renderStartingHand(hand, cardsRandom),
    frequencies: resolved.node.hands[hand],
    resolvedAction: pushFoldPureAction(resolved.node, hand),
    actions: getPushFoldPublicActions(resolved),
    spot: toPublicPushFoldSpot(resolved.spot),
  });
}

/**
 * Regenerates the full 10-question session for (player, attempt, dataset,
 * node): 10 UNIQUE hands following `ACADEMY_PUSH_FOLD_HAND_PLAN` (shuffled),
 * cards, and each hand's pure action. Validates the selection first.
 */
export function buildAcademyPushFoldSession(key: AcademyPushFoldSessionKey): readonly AcademyPushFoldSessionQuestion[] {
  const resolved = requireAcademyPushFoldSpot(key.datasetId, key.nodeKey);
  assertAcademyPushFoldDatasetScored(resolved.dataset.id);
  const parts = derivationParts(key);
  const random = createDeterministicRandom([...parts, "hand-selection"]);
  const plan = shuffleWithRandom(ACADEMY_PUSH_FOLD_HAND_PLAN, random);
  const used = new Set<StartingHandClass>();
  const questions = plan.map((wanted, questionIndex) => {
    const { hand, category } = pickPushFoldHand(resolved.node, wanted, used, random);
    if (used.has(hand)) throw new Error("Push/Fold session invariant violated: duplicate hands");
    used.add(hand);
    return buildPushFoldQuestion(resolved, questionIndex, hand, category,
      createDeterministicRandom([...parts, String(questionIndex), "cards"]));
  });
  if (questions.length !== ACADEMY_SOLVER_QUESTION_COUNT) {
    throw new Error(`Push/Fold session must have ${ACADEMY_SOLVER_QUESTION_COUNT} questions`);
  }
  return Object.freeze(questions);
}

/** Strips everything that would reveal the answer before the player responds. */
export function toPublicPushFoldQuestion(question: AcademyPushFoldSessionQuestion): AcademyPushFoldPublicQuestion {
  return {
    hand: question.hand,
    renderedCards: question.renderedCards,
    actions: question.actions,
    spot: question.spot,
  };
}

/**
 * Post-answer reveal; outcome computed server-side with the same weighted,
 * frequency-only rule as the preflop trainer (for pure push/fold data a
 * choice is either the range's 100% action or a 0% action, so it is never
 * SUPPORTED_ALTERNATIVE). `selectedAction` must already be validated against
 * the node's actions.
 */
export function toPushFoldReveal(question: AcademyPushFoldSessionQuestion, selectedAction: AcademySolverAction): AcademyPushFoldReveal {
  const outcome = classifyStrategyAnswer({ frequencies: question.frequencies, selectedAction });
  return {
    ...toPublicPushFoldQuestion(question),
    questionIndex: question.questionIndex,
    frequencies: question.frequencies,
    resolvedAction: question.resolvedAction,
    selectedAction,
    matchesResolvedAction: selectedAction === question.resolvedAction,
    outcome,
    points: strategyAnswerPoints(outcome),
    primaryActions: primaryStrategyActions(question.frequencies),
    countsAsCorrect: strategyAnswerCountsAsCorrect(outcome),
  };
}
