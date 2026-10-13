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
import { getAcademyPreflopSizingProfile } from "@/config/academy/preflop-sizing-profiles";
import { getAcademyStrategyDataset } from "@/config/academy/solver-datasets";
import {
  type AcademyPreflopHandState,
  buildPreflopTableMoney,
  resolveAnteSemantics,
  resolvePreflopHandState,
  sizePreflopAction,
} from "@/lib/academy/preflop-sizing";
import {
  describePreflopTrainerSpot,
  describePreflopTrainerSpotHistory,
  localizePreflopTrainerAction,
  localizePreflopTrainerActionCopy,
} from "@/lib/academy/preflop-trainer-copy";
import { buildPreflopTableScene } from "@/lib/academy/preflop-table-scene";
import { isAcademyPreflopTrainerSituation } from "@/lib/academy/preflop-trainer-selection";
import {
  getAcademyStrategyNode,
  getAcademyStrategyNodeActions,
  resolveAcademyStrategyNodeAction,
  sampleBalancedStrategyHands,
} from "@/lib/academy/solver";
import { createDeterministicRandom, deriveDeterministicUnit } from "@/lib/academy/solver-session";
import { ACADEMY_SOLVER_QUESTION_COUNT, toPublicSolverAction } from "@/lib/academy/solver-training";
import {
  classifyStrategyAnswer,
  primaryStrategyActions,
  strategyAnswerCountsAsCorrect,
  strategyAnswerPoints,
} from "@/lib/academy/strategy-answer";
import { renderStartingHand } from "@/lib/academy/training";
import type {
  AcademyPreflopTableMoney,
  AcademyPreflopTableScene,
  AcademyPreflopTrainerPublicQuestion,
  AcademyPreflopTrainerPublicSpot,
  AcademyPreflopTrainerReveal,
  AcademyPreflopTrainerSituation,
  AcademyPreflopTrainerSpot,
  AcademySolverAction,
  AcademySolverPublicAction,
  AcademyStrategyDataset,
  AcademyStrategyHandBucket,
  AcademyStrategyHandFrequencies,
  AcademyStrategyNode,
  AcademyStrategyNodeHands,
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

// ---------------------------------------------------------------------------
// Table scene (prior actions implied by the node)
// ---------------------------------------------------------------------------

/** The situation whose aggressive action led to each situation. */
const PREVIOUS_SITUATION: Readonly<Record<AcademyPreflopTrainerSituation, AcademyPreflopTrainerSituation | null>> = {
  RFI: null,
  FACING_OPEN: "RFI",
  FACING_3BET: "FACING_OPEN",
  FACING_4BET: "FACING_3BET",
  FACING_5BET: "FACING_4BET",
};

/**
 * Russian label ("Рейз", "3-бет", "Олл-ин", …) of the single aggressive
 * action offered by a REAL node of the same dataset, localized for that
 * node's situation and without any size. Undefined when the node does not
 * exist or is ambiguous (zero or several aggressive actions) — the table then
 * shows no label instead of a guess.
 */
function aggressiveActionLabel(
  stackBb: number,
  situation: AcademyPreflopTrainerSituation,
  heroPosition: string,
  villainPosition: string | undefined,
): string | undefined {
  const spot = listAcademyPreflopTrainerSpots().find((candidate) =>
    candidate.stackBb === stackBb
    && candidate.situation === situation
    && candidate.heroPosition === heroPosition
    && (candidate.villainPosition ?? null) === (villainPosition ?? null));
  if (!spot) return undefined;
  const { dataset, node } = requireAcademyPreflopTrainerSpot(spot.datasetId, spot.nodeKey);
  const aggressive = getAcademyStrategyNodeActions(dataset, node)
    .filter((action) => action.kind === "RAISE" || action.kind === "ALL_IN" || action.kind === "BET");
  if (aggressive.length !== 1) return undefined;
  return localizePreflopTrainerActionCopy({ code: aggressive[0].code, kind: aggressive[0].kind }, situation)?.button;
}

const sceneCache = new Map<string, AcademyPreflopTableScene>();

/**
 * Table scene for a spot. The villain's label comes from the node that
 * created the hero's decision (FACING_OPEN_BB_VS_BTN ← RFI_BTN, FACING_3BET_H_VS_V
 * ← FACING_OPEN_V_VS_H, …); the hero's label (facing a 3-/4-/5-bet) from the
 * hero's own previous node (FACING_4BET_H_VS_V ← FACING_OPEN_H_VS_V, …).
 */
export function getPreflopTrainerSpotScene(spot: AcademyPreflopTrainerSpot): AcademyPreflopTableScene {
  const cacheKey = `${spot.datasetId}:${spot.nodeKey}`;
  const cached = sceneCache.get(cacheKey);
  if (cached) return cached;
  const previous = PREVIOUS_SITUATION[spot.situation];
  const villainLabel = previous && spot.villainPosition
    ? aggressiveActionLabel(spot.stackBb, previous, spot.villainPosition, previous === "RFI" ? undefined : spot.heroPosition)
    : undefined;
  const heroLabel = previous && previous !== "RFI" && spot.situation !== "FACING_OPEN"
    ? aggressiveActionLabel(
      spot.stackBb,
      previous === "FACING_OPEN" ? "RFI" : PREVIOUS_SITUATION[previous]!,
      spot.heroPosition,
      previous === "FACING_OPEN" ? undefined : spot.villainPosition,
    )
    : undefined;
  const scene = buildPreflopTableScene(spot, {
    ...(villainLabel ? { villain: villainLabel } : {}),
    ...(heroLabel ? { hero: heroLabel } : {}),
  });
  sceneCache.set(cacheKey, scene);
  return scene;
}

const handStateCache = new Map<string, AcademyPreflopHandState | null>();

/**
 * Chip state of a spot from the dataset's TYPED sizing profile
 * (config/academy/preflop-sizing-profiles.ts). Null when the source documents
 * no sizing for any earlier action — then nothing is sized.
 */
export function getPreflopTrainerSpotHandState(spot: AcademyPreflopTrainerSpot): AcademyPreflopHandState | null {
  const cacheKey = `${spot.datasetId}:${spot.nodeKey}`;
  if (handStateCache.has(cacheKey)) return handStateCache.get(cacheKey)!;
  const state = resolvePreflopHandState({
    profile: getAcademyPreflopSizingProfile(spot.datasetId),
    stackBb: spot.stackBb,
    situation: spot.situation,
    heroSeat: spot.heroPosition,
    ...(spot.villainPosition ? { villainSeat: spot.villainPosition } : {}),
  });
  handStateCache.set(cacheKey, state);
  return state;
}

/** Stacks / committed chips / pot of a spot (ante policy from the dataset's own assumptions). */
export function getPreflopTrainerSpotTableMoney(spot: AcademyPreflopTrainerSpot): AcademyPreflopTableMoney | undefined {
  const state = getPreflopTrainerSpotHandState(spot);
  if (!state) return undefined;
  const dataset = getAcademyStrategyDataset(spot.datasetId);
  const ante = resolveAnteSemantics(dataset.assumptions, dataset.metadata.tableSize);
  // The pot policy is decided by `buildPreflopTableMoney` alone; `ante` only
  // travels along so the table can label it (presentation, never a total).
  return Object.freeze({ ...buildPreflopTableMoney(state, ante), ante });
}

/** Public spot + Russian copy (history with trusted sizes) + table scene + table money (answer-free). */
export function toPublicPreflopTrainerSpot(spot: AcademyPreflopTrainerSpot): AcademyPreflopTrainerPublicSpot {
  const state = getPreflopTrainerSpotHandState(spot);
  const table = getPreflopTrainerSpotTableMoney(spot);
  return Object.freeze({
    ...spot,
    ...describePreflopTrainerSpot(spot),
    history: describePreflopTrainerSpotHistory(spot, state?.steps ?? null),
    scene: getPreflopTrainerSpotScene(spot),
    ...(table ? { table } : {}),
  });
}

/**
 * The node's actions as public display metadata with Russian copy, in
 * resolver order. `ru` stays the generic label; when the source documents a
 * size for this node, `sizing` (and `amountBb` = total raise-to size for
 * raises) is attached for the advanced presentation. Codes, kinds and order
 * are untouched — scoring never sees any of this.
 */
export function getPreflopTrainerPublicActions(resolved: AcademyPreflopTrainerResolvedSpot): readonly AcademySolverPublicAction[] {
  const state = getPreflopTrainerSpotHandState(resolved.spot);
  return Object.freeze(getAcademyStrategyNodeActions(resolved.dataset, resolved.node).map((action) => {
    const localized = localizePreflopTrainerAction(toPublicSolverAction(action), resolved.spot.situation);
    const sizing = sizePreflopAction(localized, localized.ru?.button ?? localized.label, state);
    if (!sizing) return localized;
    const amountBb = sizing.kind === "CALL" ? localized.amountBb : sizing.totalBb;
    return Object.freeze({ ...localized, ...(amountBb !== undefined ? { amountBb } : {}), sizing });
  }));
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
  readonly spot: AcademyPreflopTrainerPublicSpot;
  /**
   * SERVER-ONLY until answered: the resolved node's own `hands` (the same
   * object `frequencies` is read from). Exposed only by
   * `toPreflopTrainerReveal`; `toPublicPreflopTrainerQuestion` whitelists
   * fields and never copies it.
   */
  readonly rangeHands: AcademyStrategyNodeHands;
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
      rangeHands: node.hands,
    });
  }));
}

/**
 * Strips everything that would reveal the answer before the player responds —
 * including the randomizer: normal practice is answered from the strategy, and
 * the randomizer is only explained (secondarily) in the reveal.
 */
export function toPublicPreflopTrainerQuestion(
  question: AcademyPreflopTrainerSessionQuestion,
): AcademyPreflopTrainerPublicQuestion {
  return {
    hand: question.hand,
    renderedCards: question.renderedCards,
    actions: question.actions,
    spot: question.spot,
  };
}

/**
 * Post-answer reveal of one question (fixed node or Quick Mix). Adds the
 * hand's frequencies AND the node's full 169-hand range (`rangeHands`, only
 * the one node — no dataset, provenance or other node). The outcome,
 * points and `countsAsCorrect` are computed HERE, server-side, with the same
 * frequency-only `classifyStrategyAnswer` the verifier uses — never by the
 * client, and never from the randomizer (which is returned as explanation).
 * `selectedAction` must already be validated against the node's actions.
 */
export function toPreflopTrainerReveal(
  question: AcademyPreflopTrainerSessionQuestion,
  selectedAction: AcademySolverAction,
): AcademyPreflopTrainerReveal {
  const outcome = classifyStrategyAnswer({ frequencies: question.frequencies, selectedAction });
  return {
    ...toPublicPreflopTrainerQuestion(question),
    questionIndex: question.questionIndex,
    frequencies: question.frequencies,
    randomizerPercent: question.randomizerPercent,
    resolvedAction: question.resolvedAction,
    selectedAction,
    bucket: question.bucket,
    matchesResolvedAction: selectedAction === question.resolvedAction,
    outcome,
    points: strategyAnswerPoints(outcome),
    primaryActions: primaryStrategyActions(question.frequencies),
    countsAsCorrect: strategyAnswerCountsAsCorrect(outcome),
    // Post-answer only: the whole range of the SAME node the hand was scored on.
    rangeHands: question.rangeHands,
  };
}
