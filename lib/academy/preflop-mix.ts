import "server-only";

/**
 * "Быстрая тренировка" (Quick Mix) — 10 decisions from DIFFERENT validated
 * nodes of the configurable preflop trainer's whitelisted datasets
 * (`ACADEMY_PREFLOP_TRAINER_DATASET_IDS`; never the HRC dataset).
 *
 * Server-authoritative and stateless, like every Solver Lab session: the
 * whole 10-question mix (nodes, hands, cards, randomizers, resolved actions)
 * is regenerated on every request purely from
 *   HMAC(SESSION_SECRET, playerId : solver_preflop_trainer : attemptId :
 *        preflop-quick-mix : …)
 * via the unchanged `deriveDeterministicUnit` / `createDeterministicRandom`.
 * The `preflop-quick-mix` tag (and the absence of a dataset / node part)
 * keeps these inputs disjoint from the fixed-node trainer
 * (`…:preflop-trainer:<dataset>:<node>:…`) and from the HRC lessons. The
 * client never names a node: it only sends attemptId + questionIndex.
 *
 * ===========================================================================
 * MIX SAMPLING POLICY (balanced, deterministic)
 * ===========================================================================
 * Uniform sampling over all 434 nodes would be dominated by deep / rare
 * branches (178 of them are facing a 3-, 4- or 5-bet) and by near-trivial
 * pure-fold spots. Instead:
 *
 * 1. CATEGORIES. Every node gets one category:
 *      BLIND_DEFENSE  facing an open as SB or BB
 *      FACING_OPEN    facing an open from any other seat
 *      RFI            first in
 *      FACING_3BET / FACING_4BET / FACING_5BET
 *
 * 2. SLOT TEMPLATE. A session is 10 slots with a fixed composition
 *    (`ACADEMY_PREFLOP_MIX_SLOT_TEMPLATE`):
 *      3 × BLIND_DEFENSE, 2 × FACING_OPEN, 2 × RFI, 2 × FACING_3BET,
 *      1 × WILDCARD.
 *    The WILDCARD is resolved once per session by weighted pick
 *    (`ACADEMY_PREFLOP_MIX_WILDCARD_WEIGHTS`): FACING_4BET 35,
 *    FACING_5BET 15, BLIND_DEFENSE 20, FACING_OPEN 15, RFI 15.
 *    So facing-open / blind defence is always ≥ 5/10, RFI ≥ 2/10,
 *    facing a 3-bet 2/10, and a 4-bet / 5-bet spot appears in roughly half of
 *    the sessions, never more than once. The 10 categories are then shuffled.
 *
 * 3. STACK VARIETY. For each slot (in order) the stack is picked uniformly
 *    among the stacks that have nodes of the slot's category AND are the
 *    least used so far in this session. (FACING_3BET exists only at
 *    20/40/100 BB, FACING_4BET at 40/100, FACING_5BET at 100.)
 *
 * 4. NODE PICK. Within (category, stack) a node is picked by weighted random
 *    with weight `0.25 + 0.75 × (1 − pureFoldShare)`, where `pureFoldShare`
 *    is the combo-weighted share of the node's hands that are 100% fold
 *    (`PURE:FOLD` bucket of `classifyStrategyHandBucket`). A node whose whole
 *    range folds weighs 0.25, a node with no pure folds 1.0.
 *    Constraints: a node is never repeated inside a session, and the node key
 *    of the previous question is excluded even at another stack (so the
 *    same seat-vs-seat decision never appears twice in a row). If the
 *    filtered pool is empty, the "no repeat in session" rule is relaxed
 *    first, then the stack; the "not the same as the previous question" rule
 *    is never relaxed.
 *
 * 5. HAND PICK. Reuses the hand-level MIXED / PURE:<code> buckets. A shuffled
 *    plan of 4 MIXED and 6 PURE slots is drawn per session. For a PURE slot
 *    one of the node's non-empty pure buckets is chosen UNIFORMLY (so a
 *    3-action node gives pure-fold hands at most 1/3 of its pure slots, not
 *    "most of the range"); for a MIXED slot a mixed hand. A missing bucket
 *    falls back to any hand of the node. Hands already used in the session
 *    are avoided while alternatives exist. At most
 *    `ACADEMY_PREFLOP_MIX_MAX_PURE_FOLD_HANDS` (3) hands per session may be
 *    100% folds; after that the PURE:FOLD bucket is excluded (a mixed or other
 *    pure bucket always exists). The hand is then uniform within the chosen
 *    bucket.
 *
 * 6. Per question, cards and the randomizer come from their own HMAC inputs
 *    (`…:preflop-quick-mix:<i>:cards` / `…:<i>:resolve`); the resolved
 *    action is the generic cumulative resolver over the node's own actions.
 * ===========================================================================
 */
import {
  ACADEMY_PREFLOP_TRAINER_DATASET_IDS,
  ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE,
} from "@/config/academy/preflop-trainer";
import { calculateWeightedRangePercentage, CANONICAL_STARTING_HANDS } from "@/lib/academy/preflop";
import {
  getPreflopTrainerPublicActions,
  listAcademyPreflopTrainerSpots,
  requireAcademyPreflopTrainerSpot,
  toPublicPreflopTrainerSpot,
  type AcademyPreflopTrainerSessionQuestion,
} from "@/lib/academy/preflop-trainer";
import {
  ACADEMY_STRATEGY_MIXED_BUCKET,
  classifyStrategyHandBucket,
  resolveAcademyStrategyNodeAction,
  shuffleWithRandom,
  type AcademySolverRandom,
} from "@/lib/academy/solver";
import { createDeterministicRandom, deriveDeterministicUnit } from "@/lib/academy/solver-session";
import { ACADEMY_SOLVER_QUESTION_COUNT } from "@/lib/academy/solver-training";
import { renderStartingHand } from "@/lib/academy/training";
import type {
  AcademyPreflopTrainerSpot,
  AcademyStrategyHandBucket,
  StartingHandClass,
} from "@/types/academy";

export const ACADEMY_PREFLOP_MIX_DERIVATION_TAG = "preflop-quick-mix";

export const ACADEMY_PREFLOP_MIX_QUESTION_COUNT = ACADEMY_SOLVER_QUESTION_COUNT;

export type AcademyPreflopMixCategory =
  | "BLIND_DEFENSE"
  | "FACING_OPEN"
  | "RFI"
  | "FACING_3BET"
  | "FACING_4BET"
  | "FACING_5BET";

type MixSlot = AcademyPreflopMixCategory | "WILDCARD";

export const ACADEMY_PREFLOP_MIX_SLOT_TEMPLATE: readonly MixSlot[] = Object.freeze([
  "BLIND_DEFENSE", "BLIND_DEFENSE", "BLIND_DEFENSE",
  "FACING_OPEN", "FACING_OPEN",
  "RFI", "RFI",
  "FACING_3BET", "FACING_3BET",
  "WILDCARD",
]);

export const ACADEMY_PREFLOP_MIX_WILDCARD_WEIGHTS: ReadonlyArray<readonly [AcademyPreflopMixCategory, number]> = Object.freeze([
  ["FACING_4BET", 35],
  ["FACING_5BET", 15],
  ["BLIND_DEFENSE", 20],
  ["FACING_OPEN", 15],
  ["RFI", 15],
] as const);

/** Mixed hands per 10-question session (same target as the other trainers). */
export const ACADEMY_PREFLOP_MIX_MIXED_HAND_SLOTS = 4;

/**
 * At most this many 100%-fold hands per session. Every imported node offers
 * a non-fold action for some hand (all-fold nodes were skipped at import), so
 * a mixed or other pure bucket always exists once the cap is reached.
 */
export const ACADEMY_PREFLOP_MIX_MAX_PURE_FOLD_HANDS = 3;

const PURE_FOLD_BUCKET: AcademyStrategyHandBucket = "PURE:FOLD";

export function classifyPreflopMixCategory(
  spot: Pick<AcademyPreflopTrainerSpot, "situation" | "heroPosition">,
): AcademyPreflopMixCategory {
  if (spot.situation === "FACING_OPEN") {
    return spot.heroPosition === "SB" || spot.heroPosition === "BB" ? "BLIND_DEFENSE" : "FACING_OPEN";
  }
  return spot.situation;
}

export type AcademyPreflopMixCandidate = {
  readonly spot: AcademyPreflopTrainerSpot;
  readonly category: AcademyPreflopMixCategory;
  readonly weight: number;
  /** Hands per bucket, canonical 13x13 order. */
  readonly buckets: ReadonlyMap<AcademyStrategyHandBucket, readonly StartingHandClass[]>;
};

let candidateIndex: readonly AcademyPreflopMixCandidate[] | null = null;

/** Node weight from its pure-fold share (see policy step 4). */
export function preflopMixNodeWeight(pureFoldShare: number): number {
  return 0.25 + 0.75 * (1 - pureFoldShare);
}

/** Every Quick Mix candidate node (= every trainer spot), with policy metadata. Memoized. */
export function listAcademyPreflopMixCandidates(): readonly AcademyPreflopMixCandidate[] {
  if (!candidateIndex) {
    candidateIndex = Object.freeze(listAcademyPreflopTrainerSpots().map((spot) => {
      if (!ACADEMY_PREFLOP_TRAINER_DATASET_IDS.includes(spot.datasetId)) {
        throw new Error(`Quick Mix candidate outside the trainer whitelist: ${spot.datasetId}`);
      }
      const { node } = requireAcademyPreflopTrainerSpot(spot.datasetId, spot.nodeKey);
      const buckets = new Map<AcademyStrategyHandBucket, StartingHandClass[]>();
      for (const hand of CANONICAL_STARTING_HANDS) {
        const bucket = classifyStrategyHandBucket(node.hands[hand], node.actionCodes);
        const list = buckets.get(bucket) ?? [];
        list.push(hand);
        buckets.set(bucket, list);
      }
      const pureFold = new Set(buckets.get(PURE_FOLD_BUCKET) ?? []);
      const pureFoldShare = calculateWeightedRangePercentage(Object.fromEntries(
        CANONICAL_STARTING_HANDS.map((hand) => [hand, pureFold.has(hand) ? 1 : 0]),
      )) / 100;
      return Object.freeze({
        spot,
        category: classifyPreflopMixCategory(spot),
        weight: preflopMixNodeWeight(pureFoldShare),
        buckets,
      });
    }));
  }
  return candidateIndex;
}

function pickIndex(random: AcademySolverRandom, length: number): number {
  return Math.min(length - 1, Math.floor(random() * length));
}

function pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number, random: AcademySolverRandom): T {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  let threshold = random() * total;
  for (const item of items) {
    threshold -= weightOf(item);
    if (threshold < 0) return item;
  }
  return items[items.length - 1];
}

const nodeId = (spot: AcademyPreflopTrainerSpot) => `${spot.datasetId}:${spot.nodeKey}`;

/**
 * Policy steps 1–4: the 10 nodes of a session, in question order, from a
 * deterministic random stream. Exported for the policy tests (which feed it
 * many seeded streams); production always passes the HMAC stream.
 */
export function selectPreflopMixNodes(random: AcademySolverRandom): readonly AcademyPreflopMixCandidate[] {
  const candidates = listAcademyPreflopMixCandidates();
  const wildcard = pickWeighted(ACADEMY_PREFLOP_MIX_WILDCARD_WEIGHTS, ([, weight]) => weight, random)[0];
  const categories = shuffleWithRandom(
    ACADEMY_PREFLOP_MIX_SLOT_TEMPLATE.map((slot) => (slot === "WILDCARD" ? wildcard : slot)),
    random,
  );

  const stackUse = new Map<number, number>();
  const used = new Set<string>();
  const selected: AcademyPreflopMixCandidate[] = [];
  for (const category of categories) {
    const previous = selected[selected.length - 1];
    const notPrevious = (candidate: AcademyPreflopMixCandidate) => !previous || candidate.spot.nodeKey !== previous.spot.nodeKey;
    const pool = candidates.filter((candidate) => candidate.category === category && notPrevious(candidate));
    if (pool.length === 0) throw new Error(`Quick Mix has no candidate for ${category}`);

    const stacks = [...new Set(pool.map((candidate) => candidate.spot.stackBb))].sort((a, b) => a - b);
    const leastUse = Math.min(...stacks.map((stack) => stackUse.get(stack) ?? 0));
    const freshStacks = stacks.filter((stack) => (stackUse.get(stack) ?? 0) === leastUse);
    const stackBb = freshStacks[pickIndex(random, freshStacks.length)];

    const atStack = pool.filter((candidate) => candidate.spot.stackBb === stackBb);
    const atStackUnused = atStack.filter((candidate) => !used.has(nodeId(candidate.spot)));
    const poolUnused = pool.filter((candidate) => !used.has(nodeId(candidate.spot)));
    const finalPool = atStackUnused.length > 0 ? atStackUnused : poolUnused.length > 0 ? poolUnused : pool;

    const chosen = pickWeighted(finalPool, (candidate) => candidate.weight, random);
    selected.push(chosen);
    used.add(nodeId(chosen.spot));
    stackUse.set(chosen.spot.stackBb, (stackUse.get(chosen.spot.stackBb) ?? 0) + 1);
  }
  return Object.freeze(selected);
}

/** Policy step 5: one hand per selected node. */
export function selectPreflopMixHands(
  nodes: readonly AcademyPreflopMixCandidate[],
  random: AcademySolverRandom,
): ReadonlyArray<{ hand: StartingHandClass; bucket: AcademyStrategyHandBucket }> {
  const plan = shuffleWithRandom(
    nodes.map((_, index) => (index < ACADEMY_PREFLOP_MIX_MIXED_HAND_SLOTS ? "MIXED" : "PURE")),
    random,
  );
  const usedHands = new Set<StartingHandClass>();
  let pureFoldHands = 0;
  return Object.freeze(nodes.map((candidate, index) => {
    const allBuckets = [...candidate.buckets.keys()];
    const allowed = (bucket: AcademyStrategyHandBucket) =>
      pureFoldHands < ACADEMY_PREFLOP_MIX_MAX_PURE_FOLD_HANDS || bucket !== PURE_FOLD_BUCKET;
    const pureBuckets = allBuckets.filter((bucket) => bucket !== ACADEMY_STRATEGY_MIXED_BUCKET && allowed(bucket));
    const hasMixed = candidate.buckets.has(ACADEMY_STRATEGY_MIXED_BUCKET);
    let bucketChoices: AcademyStrategyHandBucket[];
    if (plan[index] === "MIXED" && hasMixed) bucketChoices = [ACADEMY_STRATEGY_MIXED_BUCKET];
    else if (pureBuckets.length > 0) bucketChoices = pureBuckets;
    else if (allBuckets.some(allowed)) bucketChoices = allBuckets.filter(allowed);
    else bucketChoices = allBuckets;
    const bucket = bucketChoices[pickIndex(random, bucketChoices.length)];
    if (bucket === PURE_FOLD_BUCKET) pureFoldHands += 1;
    const inBucket = candidate.buckets.get(bucket)!;
    const fresh = inBucket.filter((hand) => !usedHands.has(hand));
    const pool = fresh.length > 0 ? fresh : inBucket;
    const hand = pool[pickIndex(random, pool.length)];
    usedHands.add(hand);
    return { hand, bucket };
  }));
}

export type AcademyPreflopMixSessionKey = {
  readonly playerId: string;
  readonly attemptId: string;
};

function mixDerivationParts(key: AcademyPreflopMixSessionKey): string[] {
  return [key.playerId, ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, key.attemptId, ACADEMY_PREFLOP_MIX_DERIVATION_TAG];
}

/** Randomizer of question i: HMAC(…:preflop-quick-mix:<i>:resolve) → [0, 99]. */
export function derivePreflopMixRandomizerPercent(key: AcademyPreflopMixSessionKey, questionIndex: number): number {
  return Math.floor(deriveDeterministicUnit([...mixDerivationParts(key), String(questionIndex), "resolve"]) * 100);
}

/**
 * Regenerates the whole Quick Mix session for (player, attempt). Same
 * question shape as the fixed-node trainer, but each question carries its
 * own node's spot / actions.
 */
export function buildAcademyPreflopMixSession(
  key: AcademyPreflopMixSessionKey,
): readonly AcademyPreflopTrainerSessionQuestion[] {
  const parts = mixDerivationParts(key);
  const nodes = selectPreflopMixNodes(createDeterministicRandom([...parts, "node-selection"]));
  const hands = selectPreflopMixHands(nodes, createDeterministicRandom([...parts, "hand-selection"]));
  if (nodes.length !== ACADEMY_PREFLOP_MIX_QUESTION_COUNT) {
    throw new Error(`Quick Mix session must have ${ACADEMY_PREFLOP_MIX_QUESTION_COUNT} questions`);
  }

  return Object.freeze(nodes.map((candidate, questionIndex) => {
    const resolved = requireAcademyPreflopTrainerSpot(candidate.spot.datasetId, candidate.spot.nodeKey);
    const { hand, bucket } = hands[questionIndex];
    const randomizerPercent = derivePreflopMixRandomizerPercent(key, questionIndex);
    return Object.freeze({
      questionIndex,
      hand,
      bucket,
      renderedCards: renderStartingHand(hand, createDeterministicRandom([...parts, String(questionIndex), "cards"])),
      randomizerPercent,
      frequencies: resolved.node.hands[hand],
      resolvedAction: resolveAcademyStrategyNodeAction(resolved.node, hand, randomizerPercent),
      actions: getPreflopTrainerPublicActions(resolved),
      spot: toPublicPreflopTrainerSpot(resolved.spot),
      // The server-derived node of this question — the range shown after the
      // answer can never be chosen by the client.
      rangeHands: resolved.node.hands,
    });
  }));
}
