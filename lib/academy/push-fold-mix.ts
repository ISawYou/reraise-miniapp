import "server-only";

/**
 * "Быстрая Push/Fold тренировка" — 10 decisions from DIFFERENT validated
 * nodes of the Push/Fold whitelist (`ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS`,
 * HoldemMath ante10, 4–15 BB; never MTT / HRC / no-ante / 20 BB data) whose
 * dataset is ALSO on the scored whitelist (`ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS`,
 * currently empty → every Quick session fails closed with
 * `AcademyPushFoldScoringUnavailableError`; see docs/ACADEMY_PUSH_FOLD_AUDIT.md).
 *
 * Server-authoritative and stateless, like every Solver Lab session: the
 * whole session (nodes, hands, cards, answers) is regenerated on every
 * request purely from
 *   HMAC(SESSION_SECRET, playerId : solver_push_fold_trainer : attemptId :
 *        push-fold-quick-mix : …)
 * via the unchanged `deriveDeterministicUnit` / `createDeterministicRandom`.
 * The lesson code + `push-fold-quick-mix` tag keep these inputs disjoint from
 * the fixed-node Push/Fold trainer (`…:push-fold-trainer:<dataset>:<node>:…`)
 * and from every MTT / HRC input. The client only sends attemptId +
 * questionIndex.
 *
 * ===========================================================================
 * QUICK SAMPLING POLICY (balanced, deterministic)
 * ===========================================================================
 * The candidate pool is 264 nodes (6 stacks × [8 first-in + 36 call-vs-shove]).
 * Uniform sampling would be ~80% call-vs-shove spots (most of them tiny
 * "call only with premiums" ranges from early seats). Instead:
 *
 * 1. CATEGORIES. Every node gets one category:
 *      FIRST_IN   first-in shove, any seat (UTG … SB)
 *      BB_CALL    hero is BB calling a shove (the most frequent real call spot)
 *      CALL       hero calls a shove from any other seat (UTG1 … SB)
 *
 * 2. SLOT TEMPLATE (`ACADEMY_PUSH_FOLD_MIX_SLOT_TEMPLATE`), 10 slots:
 *      5 × FIRST_IN, 2 × BB_CALL, 2 × CALL, 1 × WILDCARD.
 *    The WILDCARD is resolved once per session by weighted pick
 *    (`ACADEMY_PUSH_FOLD_MIX_WILDCARD_WEIGHTS`): FIRST_IN 50, BB_CALL 25,
 *    CALL 25. So first-in is always 5–6 of 10 (dominant) and call-vs-shove
 *    always 4–5 of 10, with BB calls ≥ 2. The 10 categories are then shuffled.
 *
 * 3. STACK VARIETY. For each slot (in order) the stack is picked uniformly
 *    among the stacks that have nodes of the slot's category AND are the
 *    least used so far in this session. Every category exists at every
 *    stack, so every stack is used once before any is used twice: a session
 *    always shows all 6 stacks (4/6/8/10/12/15 BB) and none more than twice.
 *
 * 4. NODE PICK. Within (category, stack) a node is picked by weighted random
 *    with weight `0.25 + 0.75 × inRangeShare` (`pushFoldMixNodeWeight`),
 *    where `inRangeShare` is the combo-weighted share of the node's hands whose
 *    pure action is the shove / call. A node that almost always folds (e.g.
 *    UTG1 calling a UTG shove) weighs ~0.3, a wide BTN / SB shove ~0.8.
 *    Constraints: a node is never repeated inside a session, and the node key
 *    of the previous question is excluded even at another stack (the same
 *    seat decision never appears twice in a row). If the filtered pool is
 *    empty the "no repeat in session" rule is relaxed first, then the stack;
 *    "not the same as the previous question" is never relaxed.
 *
 * 5. HAND PICK. Push/fold ranges are pure (every hand is `PURE:ALL_IN` /
 *    `PURE:CALL` or `PURE:FOLD`), so instead of MIXED vs PURE the plan uses the
 *    range-boundary categories of `classifyPushFoldHands`: a shuffled plan of
 *    3 EDGE_IN + 3 EDGE_OUT + 2 CORE_IN + 2 DEEP_OUT
 *    (`ACADEMY_PUSH_FOLD_HAND_PLAN`) — 6 of 10 hands sit on the range border,
 *    at most 4 are "obvious" (AA-like or 72o-like). An empty category falls back
 *    to its nearest (`ACADEMY_PUSH_FOLD_HAND_FALLBACK`). Hands already used in
 *    the session are avoided while alternatives exist.
 *
 * 6. Cards come from their own HMAC input (`…:push-fold-quick-mix:<i>:cards`);
 *    the answer is the hand's pure action at the node.
 * ===========================================================================
 */
import {
  ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS,
  ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE,
} from "@/config/academy/push-fold-trainer";
import { calculateWeightedRangePercentage, CANONICAL_STARTING_HANDS } from "@/lib/academy/preflop";
import {
  ACADEMY_PUSH_FOLD_HAND_PLAN,
  AcademyPushFoldScoringUnavailableError,
  buildPushFoldQuestion,
  isAcademyPushFoldDatasetScored,
  isAcademyPushFoldScoredTrainingEnabled,
  listAcademyPushFoldSpots,
  pickPushFoldHand,
  pushFoldPureAction,
  requireAcademyPushFoldSpot,
  type AcademyPushFoldHandCategory,
  type AcademyPushFoldSessionQuestion,
} from "@/lib/academy/push-fold-trainer";
import { shuffleWithRandom, type AcademySolverRandom } from "@/lib/academy/solver";
import { createDeterministicRandom } from "@/lib/academy/solver-session";
import { ACADEMY_SOLVER_QUESTION_COUNT } from "@/lib/academy/solver-training";
import type { AcademyPushFoldSpot, StartingHandClass } from "@/types/academy";

export const ACADEMY_PUSH_FOLD_MIX_DERIVATION_TAG = "push-fold-quick-mix";

export const ACADEMY_PUSH_FOLD_MIX_QUESTION_COUNT = ACADEMY_SOLVER_QUESTION_COUNT;

export type AcademyPushFoldMixCategory = "FIRST_IN" | "BB_CALL" | "CALL";

type MixSlot = AcademyPushFoldMixCategory | "WILDCARD";

export const ACADEMY_PUSH_FOLD_MIX_SLOT_TEMPLATE: readonly MixSlot[] = Object.freeze([
  "FIRST_IN", "FIRST_IN", "FIRST_IN", "FIRST_IN", "FIRST_IN",
  "BB_CALL", "BB_CALL",
  "CALL", "CALL",
  "WILDCARD",
]);

export const ACADEMY_PUSH_FOLD_MIX_WILDCARD_WEIGHTS: ReadonlyArray<readonly [AcademyPushFoldMixCategory, number]> = Object.freeze([
  ["FIRST_IN", 50],
  ["BB_CALL", 25],
  ["CALL", 25],
] as const);

export function classifyPushFoldMixCategory(
  spot: Pick<AcademyPushFoldSpot, "situation" | "heroPosition">,
): AcademyPushFoldMixCategory {
  if (spot.situation === "FIRST_IN_SHOVE") return "FIRST_IN";
  return spot.heroPosition === "BB" ? "BB_CALL" : "CALL";
}

/** Node weight from its in-range (shove / call) share, see policy step 4. */
export function pushFoldMixNodeWeight(inRangeShare: number): number {
  return 0.25 + 0.75 * inRangeShare;
}

export type AcademyPushFoldMixCandidate = {
  readonly spot: AcademyPushFoldSpot;
  readonly category: AcademyPushFoldMixCategory;
  readonly weight: number;
};

let candidateIndex: readonly AcademyPushFoldMixCandidate[] | null = null;

/**
 * Every Quick candidate node with policy metadata: the Push/Fold spots whose
 * dataset is validated for SCORED training (`isAcademyPushFoldDatasetScored`).
 * Empty while no dataset is validated. Memoized.
 */
export function listAcademyPushFoldMixCandidates(): readonly AcademyPushFoldMixCandidate[] {
  if (!candidateIndex) {
    candidateIndex = Object.freeze(listAcademyPushFoldSpots().filter((spot) => isAcademyPushFoldDatasetScored(spot.datasetId)).map((spot) => {
      if (!ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS.includes(spot.datasetId)) {
        throw new Error(`Push/Fold Quick candidate outside the whitelist: ${spot.datasetId}`);
      }
      const { node } = requireAcademyPushFoldSpot(spot.datasetId, spot.nodeKey);
      const inRangeShare = calculateWeightedRangePercentage(Object.fromEntries(
        CANONICAL_STARTING_HANDS.map((hand) => [hand, pushFoldPureAction(node, hand) === "FOLD" ? 0 : 1]),
      )) / 100;
      return Object.freeze({ spot, category: classifyPushFoldMixCategory(spot), weight: pushFoldMixNodeWeight(inRangeShare) });
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

const nodeId = (spot: AcademyPushFoldSpot) => `${spot.datasetId}:${spot.nodeKey}`;

/**
 * Policy steps 1–4: the 10 nodes of a session, in question order. Exported
 * for the policy tests (seeded streams); production passes the HMAC stream.
 */
export function selectPushFoldMixNodes(random: AcademySolverRandom): readonly AcademyPushFoldMixCandidate[] {
  const candidates = listAcademyPushFoldMixCandidates();
  const wildcard = pickWeighted(ACADEMY_PUSH_FOLD_MIX_WILDCARD_WEIGHTS, ([, weight]) => weight, random)[0];
  const categories = shuffleWithRandom(
    ACADEMY_PUSH_FOLD_MIX_SLOT_TEMPLATE.map((slot) => (slot === "WILDCARD" ? wildcard : slot)),
    random,
  );

  const stackUse = new Map<number, number>();
  const used = new Set<string>();
  const selected: AcademyPushFoldMixCandidate[] = [];
  for (const category of categories) {
    const previous = selected[selected.length - 1];
    const notPrevious = (candidate: AcademyPushFoldMixCandidate) => !previous || candidate.spot.nodeKey !== previous.spot.nodeKey;
    const pool = candidates.filter((candidate) => candidate.category === category && notPrevious(candidate));
    if (pool.length === 0) throw new Error(`Push/Fold Quick has no candidate for ${category}`);

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
export function selectPushFoldMixHands(
  nodes: readonly AcademyPushFoldMixCandidate[],
  random: AcademySolverRandom,
): ReadonlyArray<{ hand: StartingHandClass; category: AcademyPushFoldHandCategory }> {
  const plan = shuffleWithRandom(ACADEMY_PUSH_FOLD_HAND_PLAN, random);
  const used = new Set<StartingHandClass>();
  return Object.freeze(nodes.map((candidate, index) => {
    const { node } = requireAcademyPushFoldSpot(candidate.spot.datasetId, candidate.spot.nodeKey);
    const picked = pickPushFoldHand(node, plan[index % plan.length], used, random);
    used.add(picked.hand);
    return picked;
  }));
}

export type AcademyPushFoldMixSessionKey = {
  readonly playerId: string;
  readonly attemptId: string;
};

function mixDerivationParts(key: AcademyPushFoldMixSessionKey): string[] {
  return [key.playerId, ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE, key.attemptId, ACADEMY_PUSH_FOLD_MIX_DERIVATION_TAG];
}

/** Regenerates the whole Quick session for (player, attempt). */
export function buildAcademyPushFoldMixSession(key: AcademyPushFoldMixSessionKey): readonly AcademyPushFoldSessionQuestion[] {
  // Fail closed before any sampling: no validated dataset → no scored Quick session.
  if (!isAcademyPushFoldScoredTrainingEnabled()) throw new AcademyPushFoldScoringUnavailableError();
  const parts = mixDerivationParts(key);
  const nodes = selectPushFoldMixNodes(createDeterministicRandom([...parts, "node-selection"]));
  const hands = selectPushFoldMixHands(nodes, createDeterministicRandom([...parts, "hand-selection"]));
  if (nodes.length !== ACADEMY_PUSH_FOLD_MIX_QUESTION_COUNT) {
    throw new Error(`Push/Fold Quick session must have ${ACADEMY_PUSH_FOLD_MIX_QUESTION_COUNT} questions`);
  }
  return Object.freeze(nodes.map((candidate, questionIndex) => {
    const resolved = requireAcademyPushFoldSpot(candidate.spot.datasetId, candidate.spot.nodeKey);
    const { hand, category } = hands[questionIndex];
    return buildPushFoldQuestion(resolved, questionIndex, hand, category,
      createDeterministicRandom([...parts, String(questionIndex), "cards"]));
  }));
}
