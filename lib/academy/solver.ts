/**
 * Pure Solver Lab primitives (no I/O, no secrets):
 * - strategy dataset validation + canonical serialization (fingerprinting),
 * - the canonical randomizer → action resolver,
 * - the balanced hand-composition sampler.
 *
 * These deliberately know nothing about HMAC/session derivation so each piece
 * is unit-testable with an injected random source.
 */
import {
  ACADEMY_PREFLOP_POSITIONS,
  CANONICAL_STARTING_HANDS,
  isCanonicalStartingHand,
} from "@/lib/academy/preflop";
import type {
  AcademySolverHandBucket,
  AcademyStrategyActionCode,
  AcademyStrategyDataset,
  AcademyStrategyHandFrequencies,
  AcademyStrategyPositionFrequencies,
  PreflopPosition,
  StartingHandClass,
} from "@/types/academy";

/** Tolerance for "frequencies of one hand sum to 1". */
export const ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON = 1e-9;

/** Random source returning a value in [0, 1). */
export type AcademySolverRandom = () => number;

export class AcademyStrategyDatasetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcademyStrategyDatasetValidationError";
  }
}

function fail(datasetId: string, message: string): never {
  throw new AcademyStrategyDatasetValidationError(`Strategy dataset "${datasetId}": ${message}`);
}

function validateHandFrequencies(
  datasetId: string,
  position: string,
  hand: string,
  frequencies: unknown,
  actions: readonly AcademyStrategyActionCode[],
): void {
  if (!frequencies || typeof frequencies !== "object" || Array.isArray(frequencies)) {
    fail(datasetId, `${position} ${hand} has no action-frequency map`);
  }
  const entries = Object.entries(frequencies as Record<string, unknown>);
  const seen = new Set<string>();
  let sum = 0;

  for (const [action, frequency] of entries) {
    if (seen.has(action)) fail(datasetId, `${position} ${hand} repeats action ${action}`);
    seen.add(action);
    if (!actions.includes(action)) {
      fail(datasetId, `${position} ${hand} uses unknown action ${action}`);
    }
    if (typeof frequency !== "number" || !Number.isFinite(frequency) || frequency < 0 || frequency > 1) {
      fail(datasetId, `${position} ${hand} ${action} frequency ${String(frequency)} is outside [0, 1]`);
    }
    sum += frequency;
  }

  for (const action of actions) {
    if (!seen.has(action)) fail(datasetId, `${position} ${hand} is missing action ${action}`);
  }
  if (Math.abs(sum - 1) > ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON) {
    fail(datasetId, `${position} ${hand} frequencies sum to ${sum}, expected 1`);
  }
}

/**
 * Throws `AcademyStrategyDatasetValidationError` unless: the dataset has a
 * non-empty id, a non-empty list of unique action codes, exactly the expected
 * positions, each position has exactly the 169 canonical hands, every
 * frequency is in [0, 1], every hand lists each action exactly once, and each
 * hand's frequencies sum to 1 (±`ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON`).
 */
export function validateAcademyStrategyDataset(
  dataset: AcademyStrategyDataset,
  expectedPositions: readonly PreflopPosition[] = ACADEMY_PREFLOP_POSITIONS,
): void {
  const datasetId = typeof dataset?.id === "string" ? dataset.id : "<unknown>";
  if (!dataset || typeof dataset.id !== "string" || dataset.id.length === 0) {
    fail(datasetId, "id must be a non-empty string");
  }
  if (!Array.isArray(dataset.actions) || dataset.actions.length === 0) {
    fail(datasetId, "actions must be a non-empty list");
  }
  if (new Set(dataset.actions).size !== dataset.actions.length) {
    fail(datasetId, "action codes must be unique");
  }
  for (const action of dataset.actions) {
    if (typeof action !== "string" || action.length === 0) fail(datasetId, "action codes must be non-empty strings");
  }

  const positionKeys = Object.keys(dataset.positions ?? {});
  for (const position of expectedPositions) {
    if (!positionKeys.includes(position)) fail(datasetId, `missing position ${position}`);
  }
  for (const position of positionKeys) {
    if (!expectedPositions.includes(position as PreflopPosition)) {
      fail(datasetId, `unexpected position ${position}`);
    }
  }

  for (const position of expectedPositions) {
    const hands = dataset.positions[position] as Record<string, unknown>;
    if (!hands || typeof hands !== "object") fail(datasetId, `position ${position} has no hands`);
    const handKeys = Object.keys(hands);
    for (const hand of handKeys) {
      if (!isCanonicalStartingHand(hand)) fail(datasetId, `${position} has non-canonical hand ${hand}`);
    }
    for (const hand of CANONICAL_STARTING_HANDS) {
      if (!Object.prototype.hasOwnProperty.call(hands, hand)) {
        fail(datasetId, `${position} is missing hand ${hand}`);
      }
    }
    if (handKeys.length !== CANONICAL_STARTING_HANDS.length) {
      fail(datasetId, `${position} has ${handKeys.length} hands, expected ${CANONICAL_STARTING_HANDS.length}`);
    }
    for (const hand of CANONICAL_STARTING_HANDS) {
      validateHandFrequencies(datasetId, position, hand, hands[hand], dataset.actions);
    }
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/**
 * Deterministic JSON serialization: every object's keys are sorted
 * (positions, hands, per-hand actions, provenance fields); arrays keep their
 * order because order is semantic there (e.g. the canonical action order).
 */
export function serializeAcademyStrategyDatasetCanonical(dataset: AcademyStrategyDataset): string {
  return JSON.stringify(canonicalize(dataset));
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

function snapPercent(value: number): number {
  // Frequencies such as 0.57 become 56.99999999999999 after * 100. Snap values
  // within 1e-9 of an integer so 2-decimal source frequencies map to exact
  // integer percent thresholds.
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 1e-9 ? rounded : value;
}

/**
 * Canonical randomizer → action resolver.
 *
 * Scale: `randomizerPercent` is on the PERCENT scale, a finite number in
 * [0, 100). (Server sessions derive integers 0..99; any real value in range is
 * accepted.) Walks `actionOrder` accumulating `frequency * 100` and returns the
 * first action whose cumulative threshold is strictly greater than
 * `randomizerPercent`.
 *
 * Example with RAISE_2_25BB = 0.41, FOLD = 0.59 and order
 * [RAISE_2_25BB, FOLD]: randomizerPercent in [0, 41) → RAISE_2_25BB;
 * [41, 100) → FOLD. A 0-frequency action is never returned; a 1-frequency
 * first action is always returned.
 */
export function resolveActionFromFrequencies(
  frequencies: Readonly<Record<string, number>>,
  actionOrder: readonly string[],
  randomizerPercent: number,
): string {
  if (!Number.isFinite(randomizerPercent) || randomizerPercent < 0 || randomizerPercent >= 100) {
    throw new RangeError(`randomizerPercent must be in [0, 100), got ${randomizerPercent}`);
  }
  if (actionOrder.length === 0) throw new Error("actionOrder must not be empty");
  if (new Set(actionOrder).size !== actionOrder.length) throw new Error("actionOrder must be unique");
  for (const action of Object.keys(frequencies)) {
    if (!actionOrder.includes(action)) throw new Error(`Frequency for unknown action ${action}`);
  }

  let cumulative = 0;
  for (const action of actionOrder) {
    const frequency = frequencies[action] ?? 0;
    if (!Number.isFinite(frequency) || frequency < 0 || frequency > 1) {
      throw new Error(`Invalid frequency for ${action}: ${frequency}`);
    }
    cumulative += frequency;
    if (randomizerPercent < snapPercent(cumulative * 100)) return action;
  }

  throw new Error(`Frequencies sum to ${cumulative}, expected 1`);
}

// ---------------------------------------------------------------------------
// Balanced sampler
// ---------------------------------------------------------------------------

/** Target session composition (sums to the 10-question session length). */
export const ACADEMY_SOLVER_BUCKET_TARGETS = Object.freeze({
  MIXED: 4,
  PURE_RAISE: 3,
  PURE_FOLD: 3,
} as const satisfies Record<AcademySolverHandBucket, number>);

/**
 * Fixed tie-break order for the shortfall fallback (see
 * `sampleBalancedSolverHands`).
 */
export const ACADEMY_SOLVER_BUCKET_FALLBACK_ORDER = Object.freeze([
  "MIXED",
  "PURE_RAISE",
  "PURE_FOLD",
] as const satisfies readonly AcademySolverHandBucket[]);

export function classifySolverHandBucket(
  frequencies: AcademyStrategyHandFrequencies,
  primaryAction: AcademyStrategyActionCode,
): AcademySolverHandBucket {
  const frequency = frequencies[primaryAction] ?? 0;
  if (frequency >= 1) return "PURE_RAISE";
  if (frequency <= 0) return "PURE_FOLD";
  return "MIXED";
}

function randomIndex(random: AcademySolverRandom, size: number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError(`Random source must return a value in [0, 1), got ${value}`);
  }
  return Math.floor(value * size);
}

export function shuffleWithRandom<T>(items: readonly T[], random: AcademySolverRandom): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(random, index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export type SampleBalancedSolverHandsInput = {
  readonly hands: AcademyStrategyPositionFrequencies;
  /** Action whose frequency defines the buckets (RAISE_2_25BB for RFI). */
  readonly primaryAction: AcademyStrategyActionCode;
  readonly random: AcademySolverRandom;
  readonly targets?: Readonly<Record<AcademySolverHandBucket, number>>;
};

export type SampledSolverHand = {
  readonly hand: StartingHandClass;
  readonly bucket: AcademySolverHandBucket;
};

/**
 * Picks `sum(targets)` (default 10) UNIQUE hands: 4 mixed (0 < f < 1),
 * 3 pure-raise (f = 1), 3 pure-fold (f = 0), where f is the primary action's
 * frequency.
 *
 * Algorithm (fully determined by the random source):
 * 1. Each bucket's candidates, in canonical 13x13 order, are shuffled with
 *    `random` in the fixed order MIXED, PURE_RAISE, PURE_FOLD.
 * 2. Each bucket contributes min(target, available) hands from the front.
 * 3. Shortfall fallback: while fewer than the total are selected, take the
 *    next hand from the bucket with the MOST remaining unselected candidates;
 *    ties are broken by `ACADEMY_SOLVER_BUCKET_FALLBACK_ORDER`
 *    (MIXED, PURE_RAISE, PURE_FOLD). One hand per step.
 * 4. The selected hands are shuffled once more with `random` so buckets are
 *    not presented in blocks.
 * Throws if the position has fewer candidate hands than the total.
 */
export function sampleBalancedSolverHands({
  hands,
  primaryAction,
  random,
  targets = ACADEMY_SOLVER_BUCKET_TARGETS,
}: SampleBalancedSolverHandsInput): readonly SampledSolverHand[] {
  const total = ACADEMY_SOLVER_BUCKET_FALLBACK_ORDER.reduce((sum, bucket) => sum + targets[bucket], 0);
  const candidateHands = CANONICAL_STARTING_HANDS.filter((hand) =>
    Object.prototype.hasOwnProperty.call(hands, hand));
  if (candidateHands.length < total) {
    throw new Error(`Need ${total} candidate hands, found ${candidateHands.length}`);
  }

  const pools = Object.fromEntries(ACADEMY_SOLVER_BUCKET_FALLBACK_ORDER.map((bucket) => [
    bucket,
    shuffleWithRandom(
      candidateHands.filter((hand) => classifySolverHandBucket(hands[hand], primaryAction) === bucket),
      random,
    ),
  ])) as Record<AcademySolverHandBucket, StartingHandClass[]>;

  const selected: SampledSolverHand[] = [];
  for (const bucket of ACADEMY_SOLVER_BUCKET_FALLBACK_ORDER) {
    const taken = pools[bucket].splice(0, Math.min(targets[bucket], pools[bucket].length));
    for (const hand of taken) selected.push({ hand, bucket });
  }

  while (selected.length < total) {
    let best: AcademySolverHandBucket | null = null;
    for (const bucket of ACADEMY_SOLVER_BUCKET_FALLBACK_ORDER) {
      if (pools[bucket].length === 0) continue;
      if (best === null || pools[bucket].length > pools[best].length) best = bucket;
    }
    if (best === null) throw new Error("Solver sampler ran out of candidate hands");
    selected.push({ hand: pools[best].shift()!, bucket: best });
  }

  return Object.freeze(shuffleWithRandom(selected, random));
}
