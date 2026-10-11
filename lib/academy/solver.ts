/**
 * Pure Solver Lab primitives (no I/O, no secrets):
 * - generic strategy dataset validation (any table size / stack / spot /
 *   number of actions / number of nodes),
 * - canonical serializations: whole dataset, strategy CONTENT only, and
 *   METADATA only (see `serializeAcademyStrategyContentCanonical`),
 * - the canonical randomizer → action resolver (N actions),
 * - the balanced hand-composition sampler.
 *
 * These deliberately know nothing about HMAC/session derivation so each piece
 * is unit-testable with an injected random source.
 */
import {
  CANONICAL_STARTING_HANDS,
  isCanonicalStartingHand,
} from "@/lib/academy/preflop";
import type {
  AcademySolverHandBucket,
  AcademyStrategyActionCode,
  AcademyStrategyHandBucket,
  AcademyStrategyActionDefinition,
  AcademyStrategyActionKind,
  AcademyStrategyDataset,
  AcademyStrategyHandFrequencies,
  AcademyStrategyNode,
  AcademyStrategyNodeHands,
  AcademyStrategyPositionFrequencies,
  StartingHandClass,
} from "@/types/academy";

/** Tolerance for "frequencies of one hand sum to 1". */
export const ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON = 1e-9;

/** The generic, reusable action-kind vocabulary. */
export const ACADEMY_STRATEGY_ACTION_KINDS = Object.freeze([
  "FOLD",
  "CHECK",
  "CALL",
  "BET",
  "RAISE",
  "ALL_IN",
] as const satisfies readonly AcademyStrategyActionKind[]);

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

// ---------------------------------------------------------------------------
// Validation building blocks (shared with the normalized import schema in
// data/academy/solver/schema-v1.ts)
// ---------------------------------------------------------------------------

/**
 * Validates one hand's action → frequency map against the node's declared
 * action codes: exactly those codes (no missing / extra), every frequency a
 * finite number in [0, 1], summing to 1 ± `ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON`.
 * Never normalizes or clamps.
 */
export function validateAcademyStrategyHandFrequencies(
  datasetId: string,
  nodeKey: string,
  hand: string,
  frequencies: unknown,
  actionCodes: readonly AcademyStrategyActionCode[],
): void {
  if (!isPlainObject(frequencies)) fail(datasetId, `${nodeKey} ${hand} has no action-frequency map`);
  let sum = 0;

  for (const [action, frequency] of Object.entries(frequencies)) {
    if (!actionCodes.includes(action)) {
      fail(datasetId, `${nodeKey} ${hand} uses unknown action ${action}`);
    }
    if (typeof frequency !== "number" || !Number.isFinite(frequency) || frequency < 0 || frequency > 1) {
      fail(datasetId, `${nodeKey} ${hand} ${action} frequency ${String(frequency)} is outside [0, 1]`);
    }
    sum += frequency;
  }

  for (const action of actionCodes) {
    if (!hasOwn(frequencies, action)) fail(datasetId, `${nodeKey} ${hand} is missing action ${action}`);
  }
  if (Math.abs(sum - 1) > ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON) {
    fail(datasetId, `${nodeKey} ${hand} frequencies sum to ${sum}, expected 1`);
  }
}

/** Exactly the 169 canonical hand classes, no unknown/non-canonical keys. */
export function validateAcademyStrategyHandKeys(datasetId: string, nodeKey: string, hands: unknown): void {
  if (!isPlainObject(hands)) fail(datasetId, `node ${nodeKey} has no hands`);
  const handKeys = Object.keys(hands);
  for (const hand of handKeys) {
    if (!isCanonicalStartingHand(hand)) fail(datasetId, `${nodeKey} has non-canonical hand ${hand}`);
  }
  for (const hand of CANONICAL_STARTING_HANDS) {
    if (!hasOwn(hands, hand)) fail(datasetId, `${nodeKey} is missing hand ${hand}`);
  }
  if (handKeys.length !== CANONICAL_STARTING_HANDS.length) {
    fail(datasetId, `${nodeKey} has ${handKeys.length} hands, expected ${CANONICAL_STARTING_HANDS.length}`);
  }
}

function validateLocalizedCopy(datasetId: string, code: string, copy: unknown): void {
  if (!isPlainObject(copy)) fail(datasetId, `action ${code} has invalid localized copy`);
  for (const field of ["button", "inline", "short"] as const) {
    if (!isNonEmptyString(copy[field])) fail(datasetId, `action ${code} localized copy needs a non-empty ${field}`);
  }
  if (copy.always !== undefined && !isNonEmptyString(copy.always)) {
    fail(datasetId, `action ${code} localized "always" copy must be a non-empty string`);
  }
}

/** Non-empty list of valid action definitions with unique codes. */
export function validateAcademyStrategyActionDefinitions(datasetId: string, actions: unknown): void {
  if (!Array.isArray(actions) || actions.length === 0) fail(datasetId, "actions must be a non-empty list");
  const codes = new Set<string>();
  for (const action of actions as unknown[]) {
    if (!isPlainObject(action) || !isNonEmptyString(action.code)) {
      fail(datasetId, "action codes must be non-empty strings");
    }
    const code = action.code;
    if (codes.has(code)) fail(datasetId, `action codes must be unique (duplicate ${code})`);
    codes.add(code);
    if (!(ACADEMY_STRATEGY_ACTION_KINDS as readonly unknown[]).includes(action.kind)) {
      fail(datasetId, `action ${code} has unknown kind ${String(action.kind)}`);
    }
    if (!isNonEmptyString(action.label)) fail(datasetId, `action ${code} needs a non-empty label`);
    if (action.amountBb !== undefined) {
      if (typeof action.amountBb !== "number" || !Number.isFinite(action.amountBb) || action.amountBb <= 0) {
        fail(datasetId, `action ${code} amountBb must be a finite positive number`);
      }
    }
    if (action.ru !== undefined) validateLocalizedCopy(datasetId, code, action.ru);
  }
}

/** Generic metadata: non-empty codes, integer table size ≥ 2, positive stack. */
export function validateAcademyStrategyMetadata(datasetId: string, metadata: unknown): void {
  if (!isPlainObject(metadata)) fail(datasetId, "metadata is missing");
  for (const field of ["game", "format", "strategyModel", "spotCode"] as const) {
    if (!isNonEmptyString(metadata[field])) fail(datasetId, `metadata.${field} must be a non-empty string`);
  }
  const { tableSize, effectiveStackBb } = metadata;
  if (typeof tableSize !== "number" || !Number.isInteger(tableSize) || tableSize < 2) {
    fail(datasetId, "metadata.tableSize must be an integer ≥ 2");
  }
  if (typeof effectiveStackBb !== "number" || !Number.isFinite(effectiveStackBb) || effectiveStackBb <= 0) {
    fail(datasetId, "metadata.effectiveStackBb must be a finite positive number");
  }
}

/** Provenance must say where the data came from and how it was derived. */
export function validateAcademyStrategyProvenance(datasetId: string, provenance: unknown): void {
  if (!isPlainObject(provenance)) fail(datasetId, "provenance is missing");
  for (const field of ["provider", "scenario", "derivation"] as const) {
    if (!isNonEmptyString(provenance[field])) fail(datasetId, `provenance.${field} must be a non-empty string`);
  }
  if (typeof provenance.note !== "string") fail(datasetId, "provenance.note must be a string");
  if (!isPlainObject(provenance.references)
    || Object.values(provenance.references).some((value) => !isNonEmptyString(value))) {
    fail(datasetId, "provenance.references must map names to non-empty strings");
  }
  if (provenance.nodeSources !== undefined) {
    if (!isPlainObject(provenance.nodeSources)) fail(datasetId, "provenance.nodeSources must be an object");
    for (const [nodeKey, details] of Object.entries(provenance.nodeSources)) {
      if (!isPlainObject(details)) fail(datasetId, `provenance.nodeSources.${nodeKey} must be an object`);
      for (const value of Object.values(details)) {
        if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) {
          fail(datasetId, `provenance.nodeSources.${nodeKey} values must be strings or finite numbers`);
        }
      }
    }
  }
}

/** Assumptions: an object of scalar values (finite numbers only). */
export function validateAcademyStrategyAssumptions(datasetId: string, assumptions: unknown): void {
  if (!isPlainObject(assumptions)) fail(datasetId, "assumptions must be an object");
  for (const [key, value] of Object.entries(assumptions)) {
    const ok = typeof value === "string"
      || typeof value === "boolean"
      || (typeof value === "number" && Number.isFinite(value));
    if (!ok) fail(datasetId, `assumption ${key} must be a string, boolean or finite number`);
  }
}

/**
 * A node's action codes: non-empty, unique, all declared by the dataset, and
 * in the dataset's declared relative order (the resolver walks this order).
 */
export function validateAcademyStrategyNodeActionCodes(
  datasetId: string,
  nodeKey: string,
  actionCodes: unknown,
  datasetActionCodes: readonly AcademyStrategyActionCode[],
): void {
  if (!Array.isArray(actionCodes) || actionCodes.length === 0) {
    fail(datasetId, `node ${nodeKey} actionCodes must be a non-empty list`);
  }
  if (new Set(actionCodes).size !== actionCodes.length) {
    fail(datasetId, `node ${nodeKey} action codes must be unique`);
  }
  let previousIndex = -1;
  for (const code of actionCodes as unknown[]) {
    const index = typeof code === "string" ? datasetActionCodes.indexOf(code) : -1;
    if (index === -1) fail(datasetId, `node ${nodeKey} uses undeclared action ${String(code)}`);
    if (index < previousIndex) {
      fail(datasetId, `node ${nodeKey} action codes must follow the dataset's declared action order`);
    }
    previousIndex = index;
  }
}

export type ValidateAcademyStrategyDatasetOptions = {
  /** When given, the dataset must contain exactly these node keys. */
  readonly expectedNodeKeys?: readonly string[];
};

/**
 * Throws `AcademyStrategyDatasetValidationError` unless the dataset is fully
 * valid: non-empty id, positive integer version, title, valid metadata,
 * provenance and assumptions, a non-empty list of valid action definitions
 * with unique codes, a non-empty set of nodes (each keyed by its own `key`,
 * with valid `actionCodes`, exactly the 169 canonical hands and per-hand
 * frequencies over exactly the node's action codes, each in [0, 1], summing
 * to 1 ± `ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON`). Fail-closed: no
 * normalization or clamping.
 */
export function validateAcademyStrategyDataset(
  dataset: AcademyStrategyDataset,
  options: ValidateAcademyStrategyDatasetOptions = {},
): void {
  const raw = dataset as unknown;
  if (!isPlainObject(raw)) fail("<unknown>", "dataset must be an object");
  const datasetId = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : "<unknown>";
  if (!isNonEmptyString(raw.id)) fail(datasetId, "id must be a non-empty string");
  if (typeof raw.version !== "number" || !Number.isInteger(raw.version) || raw.version < 1) {
    fail(datasetId, "version must be a positive integer");
  }
  if (!isNonEmptyString(raw.title)) fail(datasetId, "title must be a non-empty string");
  validateAcademyStrategyMetadata(datasetId, raw.metadata);
  validateAcademyStrategyProvenance(datasetId, raw.provenance);
  validateAcademyStrategyAssumptions(datasetId, raw.assumptions);
  validateAcademyStrategyActionDefinitions(datasetId, raw.actions);
  const datasetActionCodes = (raw.actions as AcademyStrategyActionDefinition[]).map((action) => action.code);

  if (!isPlainObject(raw.nodes) || Object.keys(raw.nodes).length === 0) {
    fail(datasetId, "nodes must be a non-empty object");
  }
  const nodes = raw.nodes;
  const nodeKeys = Object.keys(nodes);
  if (options.expectedNodeKeys) {
    for (const nodeKey of options.expectedNodeKeys) {
      if (!nodeKeys.includes(nodeKey)) fail(datasetId, `missing node ${nodeKey}`);
    }
    for (const nodeKey of nodeKeys) {
      if (!options.expectedNodeKeys.includes(nodeKey)) fail(datasetId, `unexpected node ${nodeKey}`);
    }
  }

  for (const nodeKey of nodeKeys) {
    const node = nodes[nodeKey];
    if (!isPlainObject(node)) fail(datasetId, `node ${nodeKey} must be an object`);
    if (node.key !== nodeKey) fail(datasetId, `node ${nodeKey} has mismatched key ${String(node.key)}`);
    validateAcademyStrategyNodeActionCodes(datasetId, nodeKey, node.actionCodes, datasetActionCodes);
    validateAcademyStrategyHandKeys(datasetId, nodeKey, node.hands);
    const hands = node.hands as Record<string, unknown>;
    for (const hand of CANONICAL_STARTING_HANDS) {
      validateAcademyStrategyHandFrequencies(
        datasetId, nodeKey, hand, hands[hand], node.actionCodes as readonly string[]);
    }
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class AcademyUnknownStrategyDatasetError extends Error {
  constructor(readonly datasetId: string) {
    super(`Unknown Academy strategy dataset: ${datasetId}`);
    this.name = "AcademyUnknownStrategyDatasetError";
  }
}

export type AcademyStrategyDatasetRegistry = Readonly<Record<string, AcademyStrategyDataset>>;

/**
 * Builds an immutable id → dataset registry, preserving registration order.
 * Fails closed on an empty list or a duplicate id. Datasets must already be
 * validated (and frozen) by their builders.
 */
export function createAcademyStrategyDatasetRegistry(
  datasets: readonly AcademyStrategyDataset[],
): AcademyStrategyDatasetRegistry {
  if (datasets.length === 0) throw new AcademyStrategyDatasetValidationError("Strategy registry must not be empty");
  const registry: Record<string, AcademyStrategyDataset> = {};
  for (const dataset of datasets) {
    if (!isNonEmptyString(dataset?.id)) fail("<unknown>", "id must be a non-empty string");
    if (hasOwn(registry, dataset.id)) fail(dataset.id, "dataset id must be unique within the registry");
    registry[dataset.id] = dataset;
  }
  return Object.freeze(registry);
}

/** Fail-closed registry lookup (own keys only; throws for unknown ids). */
export function lookupAcademyStrategyDataset(
  registry: AcademyStrategyDatasetRegistry,
  datasetId: string,
): AcademyStrategyDataset {
  if (typeof datasetId !== "string" || !hasOwn(registry, datasetId)) {
    throw new AcademyUnknownStrategyDatasetError(String(datasetId));
  }
  return registry[datasetId];
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Fail-closed node lookup. */
export function getAcademyStrategyNode(dataset: AcademyStrategyDataset, nodeKey: string): AcademyStrategyNode {
  if (!hasOwn(dataset.nodes, nodeKey)) {
    throw new Error(`Strategy dataset ${dataset.id} has no node ${nodeKey}`);
  }
  return dataset.nodes[nodeKey];
}

/** Action definitions available at a node, in the node's resolver order. */
export function getAcademyStrategyNodeActions(
  dataset: AcademyStrategyDataset,
  node: AcademyStrategyNode,
): readonly AcademyStrategyActionDefinition[] {
  return node.actionCodes.map((code) => {
    const action = dataset.actions.find((candidate) => candidate.code === code);
    if (!action) throw new Error(`Strategy dataset ${dataset.id} has no action ${code}`);
    return action;
  });
}

// ---------------------------------------------------------------------------
// Canonical serialization / fingerprint inputs
// ---------------------------------------------------------------------------

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
 * Deterministic JSON serialization: every object's keys are sorted; arrays
 * keep their order because order is semantic there (e.g. action order).
 */
export function serializeCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Canonical serialization of the WHOLE dataset (content + metadata). */
export function serializeAcademyStrategyDatasetCanonical(dataset: AcademyStrategyDataset): string {
  return serializeCanonicalJson(dataset);
}

/**
 * Strategy CONTENT projection: action identity (code, kind, size), node keys,
 * node action order and every hand's frequencies. Excludes id, title,
 * labels, localized copy, provenance and assumptions, so presentation edits
 * never look like a strategy change while any frequency change does.
 */
export function toAcademyStrategyContent(dataset: AcademyStrategyDataset) {
  return {
    actions: dataset.actions.map(({ code, kind, amountBb }) => (
      amountBb === undefined ? { code, kind } : { code, kind, amountBb })),
    nodes: Object.fromEntries(Object.keys(dataset.nodes).map((nodeKey) => {
      const node = dataset.nodes[nodeKey];
      return [nodeKey, { actionCodes: node.actionCodes, hands: node.hands }];
    })),
  };
}

export function serializeAcademyStrategyContentCanonical(dataset: AcademyStrategyDataset): string {
  return serializeCanonicalJson(toAcademyStrategyContent(dataset));
}

/** METADATA projection: everything descriptive, no strategy numbers. */
export function toAcademyStrategyMetadataProjection(dataset: AcademyStrategyDataset) {
  return {
    id: dataset.id,
    version: dataset.version,
    title: dataset.title,
    metadata: dataset.metadata,
    provenance: dataset.provenance,
    assumptions: dataset.assumptions,
    actionLabels: dataset.actions.map(({ code, label, ru }) => (ru === undefined ? { code, label } : { code, label, ru })),
  };
}

export function serializeAcademyStrategyMetadataCanonical(dataset: AcademyStrategyDataset): string {
  return serializeCanonicalJson(toAcademyStrategyMetadataProjection(dataset));
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

/**
 * Resolves one hand at one node for any number of actions. The cumulative
 * walk order is the node's declared `actionCodes` (the dataset's own action
 * order) — never re-sorted by kind or label.
 */
export function resolveAcademyStrategyNodeAction(
  node: AcademyStrategyNode,
  hand: StartingHandClass,
  randomizerPercent: number,
): AcademyStrategyActionCode {
  const frequencies = node.hands[hand];
  if (!frequencies) throw new Error(`Node ${node.key} has no strategy for ${hand}`);
  return resolveActionFromFrequencies(frequencies, node.actionCodes, randomizerPercent);
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

// ---------------------------------------------------------------------------
// Generic N-action balanced sampler (configurable preflop trainer)
//
// Strategy-neutral generalization of `sampleBalancedSolverHands`, which stays
// untouched for the shipped 100bb lessons (their deterministic sessions must
// reproduce byte-for-byte). Nothing here names an action: buckets are
// `MIXED` plus one `PURE:<code>` bucket per action of the node that actually
// has pure hands. For a 2-action RAISE/FOLD node that has mixed, pure-raise
// and pure-fold hands it yields the same 4 / 3 / 3 composition and the same
// hands as the original sampler for the same random stream.
// ---------------------------------------------------------------------------

export const ACADEMY_STRATEGY_MIXED_BUCKET = "MIXED" as const;

/** Preferred number of mixed hands in a 10-hand session (same as the 100bb trainer). */
export const ACADEMY_STRATEGY_MIXED_TARGET = 4;

/**
 * A hand is PURE for an action when that action's frequency is 1 within
 * `ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON` (so a float residue such as
 * 0.9999999999999999 from `1 - raise - call` still counts as pure);
 * otherwise MIXED. Mixed hands are not sub-categorized by which actions split them.
 */
export function classifyStrategyHandBucket(
  frequencies: AcademyStrategyHandFrequencies,
  actionCodes: readonly AcademyStrategyActionCode[],
): AcademyStrategyHandBucket {
  for (const code of actionCodes) {
    if ((frequencies[code] ?? 0) >= 1 - ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON) return `PURE:${code}`;
  }
  return ACADEMY_STRATEGY_MIXED_BUCKET;
}

/**
 * Bucket order + targets for one node: MIXED first (target
 * `ACADEMY_STRATEGY_MIXED_TARGET` when the node has mixed hands), then one
 * PURE bucket per action in the node's own action order — only buckets with
 * at least one candidate exist. The remaining slots are split evenly across
 * the pure buckets; any remainder goes to the earlier ones.
 */
export function buildStrategyBucketTargets(
  bucketSizes: ReadonlyMap<AcademyStrategyHandBucket, number>,
  actionCodes: readonly AcademyStrategyActionCode[],
  total: number,
): { order: readonly AcademyStrategyHandBucket[]; targets: ReadonlyMap<AcademyStrategyHandBucket, number> } {
  const hasMixed = (bucketSizes.get(ACADEMY_STRATEGY_MIXED_BUCKET) ?? 0) > 0;
  const pureBuckets = actionCodes
    .map((code): AcademyStrategyHandBucket => `PURE:${code}`)
    .filter((bucket) => (bucketSizes.get(bucket) ?? 0) > 0);
  const order: AcademyStrategyHandBucket[] = [...(hasMixed ? [ACADEMY_STRATEGY_MIXED_BUCKET] : []), ...pureBuckets];
  const targets = new Map<AcademyStrategyHandBucket, number>();
  const mixedTarget = hasMixed ? Math.min(ACADEMY_STRATEGY_MIXED_TARGET, total) : 0;
  if (hasMixed) targets.set(ACADEMY_STRATEGY_MIXED_BUCKET, mixedTarget);
  const remaining = total - mixedTarget;
  pureBuckets.forEach((bucket, index) => {
    const base = Math.floor(remaining / pureBuckets.length);
    targets.set(bucket, base + (index < remaining % pureBuckets.length ? 1 : 0));
  });
  // No pure buckets at all: every slot goes to MIXED.
  if (pureBuckets.length === 0 && hasMixed) targets.set(ACADEMY_STRATEGY_MIXED_BUCKET, total);
  return { order: Object.freeze(order), targets };
}

export type SampleBalancedStrategyHandsInput = {
  readonly hands: AcademyStrategyNodeHands;
  /** The node's action codes, in resolver order. */
  readonly actionCodes: readonly AcademyStrategyActionCode[];
  readonly random: AcademySolverRandom;
  /** Number of unique hands to pick (default 10). */
  readonly total?: number;
};

export type SampledStrategyHand = {
  readonly hand: StartingHandClass;
  readonly bucket: AcademyStrategyHandBucket;
};

/**
 * Picks `total` UNIQUE hands across the node's buckets (see
 * `buildStrategyBucketTargets`). Same algorithm as `sampleBalancedSolverHands`:
 * 1. candidates per bucket (canonical 13x13 order) are shuffled with `random`
 *    in bucket order;
 * 2. each bucket contributes min(target, available);
 * 3. shortfall: take from the bucket with the most remaining candidates,
 *    ties broken by bucket order, one hand per step;
 * 4. the selection is shuffled once more.
 */
export function sampleBalancedStrategyHands({
  hands,
  actionCodes,
  random,
  total = 10,
}: SampleBalancedStrategyHandsInput): readonly SampledStrategyHand[] {
  const candidateHands = CANONICAL_STARTING_HANDS.filter((hand) => hasOwn(hands, hand));
  if (candidateHands.length < total) {
    throw new Error(`Need ${total} candidate hands, found ${candidateHands.length}`);
  }
  const bucketOf = new Map(candidateHands.map((hand) => [hand, classifyStrategyHandBucket(hands[hand], actionCodes)]));
  const sizes = new Map<AcademyStrategyHandBucket, number>();
  for (const bucket of bucketOf.values()) sizes.set(bucket, (sizes.get(bucket) ?? 0) + 1);
  const { order, targets } = buildStrategyBucketTargets(sizes, actionCodes, total);

  const pools = new Map(order.map((bucket) => [
    bucket,
    shuffleWithRandom(candidateHands.filter((hand) => bucketOf.get(hand) === bucket), random),
  ]));

  const selected: SampledStrategyHand[] = [];
  for (const bucket of order) {
    const pool = pools.get(bucket)!;
    for (const hand of pool.splice(0, Math.min(targets.get(bucket) ?? 0, pool.length))) {
      selected.push({ hand, bucket });
    }
  }
  while (selected.length < total) {
    let best: AcademyStrategyHandBucket | null = null;
    for (const bucket of order) {
      const size = pools.get(bucket)!.length;
      if (size === 0) continue;
      if (best === null || size > pools.get(best)!.length) best = bucket;
    }
    if (best === null) throw new Error("Strategy sampler ran out of candidate hands");
    selected.push({ hand: pools.get(best)!.shift()!, bucket: best });
  }
  return Object.freeze(shuffleWithRandom(selected, random));
}
