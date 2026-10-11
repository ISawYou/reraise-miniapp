/**
 * Adapter: third-party MTT preflop reference range sets
 * (`{ "<scenarioKey>": { "<hand>": frequency } }`, see
 * data/academy/reference/mtt-preflop/MANIFEST.json) → RERAISE
 * `AcademyStrategyDataset`.
 *
 * Status of the data: EXTERNAL_REFERENCE_UNVERIFIED. These are NOT
 * RERAISE-produced solver outputs.
 *
 * Pure (no I/O). Only the upstream FREQUENCY MATH is reproduced:
 * - spot composition (raise key / call key per scenario),
 * - `conditional(freqs, prev)` normalization for vs-3bet and later,
 * - fold = 1 - raise - call, computed AFTER normalization.
 * Nothing of the upstream range-viewer/notation/output architecture is used.
 *
 * Node key convention (RERAISE 9-max seat names, see
 * `MTT_REFERENCE_SEAT_TO_9MAX`):
 *   RFI_<HERO>                    hero acts first in (raise / limp / fold)
 *   FACING_OPEN_<HERO>_VS_<VIL>   hero faces VIL's open  (3-bet / call / fold)
 *   FACING_3BET_<HERO>_VS_<VIL>   hero opened, faces VIL's 3-bet (4-bet / call / fold)
 *   FACING_4BET_<HERO>_VS_<VIL>   hero 3-bet, faces VIL's 4-bet  (5-bet / call / fold)
 *   FACING_5BET_<HERO>_VS_<VIL>   hero 4-bet, faces VIL's 5-bet  (call / fold)
 * Hero/villain/scenario are also stored per node in
 * `provenance.nodeSources[nodeKey]` (and in the typed `nodes` descriptors of
 * the import report) so filtering never has to parse key strings.
 *
 * Reachability: a non-RFI spot is imported only if the villain node whose
 * aggressive action creates it was imported and offers that action (e.g. at
 * 5/10 BB the upstream 3-bet keys are all-zero, so no facing-3bet spot is
 * reachable even though some 4-bet / call-3-bet keys carry numbers).
 *
 * Fail closed: malformed source values, non-canonical hands, a missing hand in
 * a file whose policy is REJECT, or a hand whose derived fold is negative
 * beyond `ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON` are never clamped or
 * repaired — the node (or, for structural source errors, the whole file) is
 * rejected and recorded with its reason.
 */
import { CANONICAL_STARTING_HANDS, isCanonicalStartingHand } from "@/lib/academy/preflop";
import {
  ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON,
  validateAcademyStrategyDataset,
} from "@/lib/academy/solver";
import type {
  AcademyStrategyActionCode,
  AcademyStrategyActionDefinition,
  AcademyStrategyDataset,
  AcademyStrategyHandFrequencies,
  AcademyStrategyNode,
  StartingHandClass,
} from "@/types/academy";

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/** Upstream seat labels, in table order. */
export const MTT_REFERENCE_SOURCE_SEATS = Object.freeze([
  "EP1", "EP2", "EP3", "LJ", "HJ", "CO", "BTN", "SB", "BB",
] as const);
export type MttReferenceSourceSeat = (typeof MTT_REFERENCE_SOURCE_SEATS)[number];

/** RERAISE 9-max seat names (mirrors the upstream 9-max seat map). */
export const MTT_REFERENCE_SEAT_TO_9MAX = Object.freeze({
  EP1: "UTG",
  EP2: "UTG1",
  EP3: "UTG2",
  LJ: "LJ",
  HJ: "HJ",
  CO: "CO",
  BTN: "BTN",
  SB: "SB",
  BB: "BB",
} as const satisfies Record<MttReferenceSourceSeat, string>);
export type MttReference9MaxSeat = (typeof MTT_REFERENCE_SEAT_TO_9MAX)[MttReferenceSourceSeat];

/**
 * Upstream seats that exist at each table size (6-max = LJ..BB, 8-max adds
 * EP2/EP3, 9-max adds EP1). The underlying chart for a seat is the same key
 * at every size; only the display name of early seats differs (8-max calls
 * EP2/EP3 "UTG"/"UTG1").
 */
export const MTT_REFERENCE_TABLE_SIZE_SEATS = Object.freeze({
  6: Object.freeze(["LJ", "HJ", "CO", "BTN", "SB", "BB"] as const),
  8: Object.freeze(["EP2", "EP3", "LJ", "HJ", "CO", "BTN", "SB", "BB"] as const),
  9: MTT_REFERENCE_SOURCE_SEATS,
} as const satisfies Record<number, readonly MttReferenceSourceSeat[]>);
export const MTT_REFERENCE_TABLE_SIZES = Object.freeze([6, 8, 9] as const);

// ---------------------------------------------------------------------------
// Scenario keys
// ---------------------------------------------------------------------------

/** Upstream key prefixes (longest-first matching order matters: "Call 3Bet" before "Call"). */
export const MTT_REFERENCE_KEY_PREFIXES = Object.freeze([
  "Call 3Bet", "Call 4Bet", "Call 5Bet", "Open", "Limp", "Call", "3Bet", "4Bet", "5Bet",
] as const);
export type MttReferenceKeyPrefix = (typeof MTT_REFERENCE_KEY_PREFIXES)[number];

/** Upstream helper keys (all-0 / all-1), not real spots. */
export const MTT_REFERENCE_HELPER_KEYS = Object.freeze(["EmptyRange", "WideRange"] as const);

const PREFIXES_WITHOUT_VILLAIN: readonly MttReferenceKeyPrefix[] = ["Open", "Limp"];

export type ParsedMttReferenceKey =
  | { readonly kind: "SPOT"; readonly prefix: MttReferenceKeyPrefix; readonly hero: MttReferenceSourceSeat; readonly villain?: MttReferenceSourceSeat }
  | { readonly kind: "HELPER" }
  | { readonly kind: "UNRECOGNIZED" };

function isSourceSeat(value: string): value is MttReferenceSourceSeat {
  return (MTT_REFERENCE_SOURCE_SEATS as readonly string[]).includes(value);
}

/**
 * Parses one upstream scenario key. Anything not matching a documented
 * pattern exactly (prefix + seat [+ "vs" + seat], villain present iff the
 * prefix requires one, hero ≠ villain) is UNRECOGNIZED and must be ignored —
 * never guessed at.
 */
export function parseMttReferenceScenarioKey(key: string): ParsedMttReferenceKey {
  if ((MTT_REFERENCE_HELPER_KEYS as readonly string[]).includes(key)) return { kind: "HELPER" };
  const prefix = MTT_REFERENCE_KEY_PREFIXES.find((candidate) => key.startsWith(candidate));
  if (!prefix) return { kind: "UNRECOGNIZED" };
  const rest = key.slice(prefix.length);
  const [heroText, villainText, ...extra] = rest.split("vs");
  if (extra.length > 0 || !isSourceSeat(heroText)) return { kind: "UNRECOGNIZED" };
  const needsVillain = !PREFIXES_WITHOUT_VILLAIN.includes(prefix);
  if (!needsVillain) {
    return villainText === undefined ? { kind: "SPOT", prefix, hero: heroText } : { kind: "UNRECOGNIZED" };
  }
  if (villainText === undefined || !isSourceSeat(villainText) || villainText === heroText) {
    return { kind: "UNRECOGNIZED" };
  }
  return { kind: "SPOT", prefix, hero: heroText, villain: villainText };
}

export type MttReferenceScenario = "RFI" | "FACING_OPEN" | "FACING_3BET" | "FACING_4BET" | "FACING_5BET";

export const MTT_REFERENCE_SCENARIOS = Object.freeze([
  "RFI", "FACING_OPEN", "FACING_3BET", "FACING_4BET", "FACING_5BET",
] as const satisfies readonly MttReferenceScenario[]);

type ScenarioDefinition = {
  readonly scenario: MttReferenceScenario;
  readonly keyPrefix: string;
  /** Upstream raise-range prefix; null when no raise exists (vs 5-bet). */
  readonly raise: MttReferenceKeyPrefix | null;
  readonly call: MttReferenceKeyPrefix;
  /** Hero's own previous action prefix used by `conditional` (null = no normalization). */
  readonly prev: MttReferenceKeyPrefix | null;
  readonly prevHasVillain: boolean;
  readonly hasVillain: boolean;
  /**
   * Villain's node whose aggressive action creates this spot (reachability):
   * the spot is reachable only if that villain node was imported AND offers
   * its aggressive action (RAISE / ALL_IN).
   */
  readonly villainOrigin: MttReferenceScenario | null;
  readonly callActionCode: "LIMP" | "CALL";
};

/** Mirrors the upstream SCENARIOS table (raise/call/prev composition). */
const SCENARIO_DEFINITIONS: readonly ScenarioDefinition[] = Object.freeze([
  { scenario: "RFI", keyPrefix: "RFI", raise: "Open", call: "Limp", prev: null, prevHasVillain: false, hasVillain: false, villainOrigin: null, callActionCode: "LIMP" },
  { scenario: "FACING_OPEN", keyPrefix: "FACING_OPEN", raise: "3Bet", call: "Call", prev: null, prevHasVillain: false, hasVillain: true, villainOrigin: "RFI", callActionCode: "CALL" },
  { scenario: "FACING_3BET", keyPrefix: "FACING_3BET", raise: "4Bet", call: "Call 3Bet", prev: "Open", prevHasVillain: false, hasVillain: true, villainOrigin: "FACING_OPEN", callActionCode: "CALL" },
  { scenario: "FACING_4BET", keyPrefix: "FACING_4BET", raise: "5Bet", call: "Call 4Bet", prev: "3Bet", prevHasVillain: true, hasVillain: true, villainOrigin: "FACING_3BET", callActionCode: "CALL" },
  { scenario: "FACING_5BET", keyPrefix: "FACING_5BET", raise: null, call: "Call 5Bet", prev: "4Bet", prevHasVillain: true, hasVillain: true, villainOrigin: "FACING_4BET", callActionCode: "CALL" },
]);

function sourceKey(prefix: string, hero: MttReferenceSourceSeat, villain?: MttReferenceSourceSeat): string {
  return villain ? `${prefix}${hero}vs${villain}` : `${prefix}${hero}`;
}

/** RERAISE node key for a spot (see module doc). */
export function mttReferenceNodeKey(
  scenario: MttReferenceScenario,
  hero: MttReferenceSourceSeat,
  villain?: MttReferenceSourceSeat,
): string {
  const heroName = MTT_REFERENCE_SEAT_TO_9MAX[hero];
  return villain ? `${scenario}_${heroName}_VS_${MTT_REFERENCE_SEAT_TO_9MAX[villain]}` : `${scenario}_${heroName}`;
}

// ---------------------------------------------------------------------------
// Frequency math (reproduced exactly from the upstream script)
// ---------------------------------------------------------------------------

/**
 * Exact reproduction of the upstream `conditional(freqs, prev)`: each hand's
 * later-node frequency is divided by HERO'S OWN previous-node frequency for
 * that hand, capped at 1; a hand that never reached the node (prev 0 or
 * missing) becomes 0. `prev === null` → returned unchanged.
 */
export function conditionalMttReferenceFrequencies(
  freqs: Readonly<Record<string, number>> | undefined,
  prev: Readonly<Record<string, number>> | null | undefined,
): Record<string, number> {
  if (!freqs) return {};
  if (!prev) return { ...freqs };
  const out: Record<string, number> = {};
  for (const [hand, w] of Object.entries(freqs)) {
    const p = prev[hand] ?? 0;
    out[hand] = p > 0 ? Math.min(1, w / p) : 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export class AcademyMttReferenceImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcademyMttReferenceImportError";
  }
}

/** How a hand absent from an existing upstream key is treated. */
export type MttReferenceMissingHandPolicy = "ZERO" | "REJECT";

export type MttReferenceStackProfile = {
  readonly datasetId: string;
  readonly version: number;
  readonly title: string;
  readonly effectiveStackBb: number;
  readonly strategyModel: string;
  readonly missingHandPolicy: MttReferenceMissingHandPolicy;
  /** Whether the aggressive action of each scenario is all-in at this stack (upstream sizing table). */
  readonly raiseIsAllIn: Readonly<Record<Exclude<MttReferenceScenario, "FACING_5BET">, boolean>>;
  readonly provenance: AcademyStrategyDataset["provenance"];
  readonly assumptions: AcademyStrategyDataset["assumptions"];
};

export type MttReferenceNodeDescriptor = {
  readonly nodeKey: string;
  readonly scenario: MttReferenceScenario;
  readonly heroPosition: MttReference9MaxSeat;
  readonly villainPosition?: MttReference9MaxSeat;
  readonly sourceHero: MttReferenceSourceSeat;
  readonly sourceVillain?: MttReferenceSourceSeat;
  readonly raiseSourceKey?: string;
  readonly callSourceKey: string;
  readonly prevSourceKey?: string;
  readonly actionCodes: readonly AcademyStrategyActionCode[];
  /** Table sizes whose seat set contains hero (and villain). */
  readonly tableSizes: readonly number[];
  /** Hand lookups resolved to 0 because the hand was absent from an existing key. */
  readonly zeroFilledHandLookups: number;
  /** Hands where w / prev > 1 and the upstream `Math.min(1, …)` cap applied. */
  readonly conditionalCappedHands: number;
  /** Hands with raw w > 0 but prev 0 (did not reach the node) → 0. */
  readonly conditionalUnreachedHands: number;
};

export type MttReferenceNodeOutcomeReason =
  | "DEGENERATE_ALL_FOLD"
  | "UNREACHABLE_VILLAIN_ACTION_EMPTY"
  | "MISSING_PREV_KEY"
  | "NEGATIVE_FOLD_REMAINDER";

export type MttReferenceNodeOutcome = {
  readonly nodeKey: string;
  readonly scenario: MttReferenceScenario;
  readonly reason: MttReferenceNodeOutcomeReason;
  readonly detail: string;
};

export type MttReferenceImportReport = {
  readonly datasetId: string;
  readonly effectiveStackBb: number;
  readonly nodes: readonly MttReferenceNodeDescriptor[];
  /** Not built: all-fold after composition (upstream skips these too). */
  readonly skipped: readonly MttReferenceNodeOutcome[];
  /** Not built: fail-closed rejections. */
  readonly rejected: readonly MttReferenceNodeOutcome[];
  readonly ignoredHelperKeys: readonly string[];
  readonly ignoredUnrecognizedKeys: readonly string[];
};

export type MttReferenceImportResult = {
  readonly dataset: AcademyStrategyDataset;
  readonly report: MttReferenceImportReport;
};

type SourceRanges = Readonly<Record<string, Readonly<Record<string, number>>>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Structural validation of a raw upstream file (whole-file fail closed):
 * every recognized/helper key maps to an object of canonical hands with
 * finite frequencies in [0, 1]; with policy REJECT every recognized key must
 * list all 169 hands.
 */
function validateSourceRanges(raw: unknown, profile: MttReferenceStackProfile): SourceRanges {
  const where = `MTT reference ${profile.datasetId}`;
  if (!isPlainObject(raw)) throw new AcademyMttReferenceImportError(`${where}: source must be an object`);
  for (const [key, value] of Object.entries(raw)) {
    const parsed = parseMttReferenceScenarioKey(key);
    if (parsed.kind === "UNRECOGNIZED") continue;
    if (!isPlainObject(value)) throw new AcademyMttReferenceImportError(`${where}: key "${key}" must map hands to frequencies`);
    for (const [hand, frequency] of Object.entries(value)) {
      if (!isCanonicalStartingHand(hand)) {
        throw new AcademyMttReferenceImportError(`${where}: key "${key}" has non-canonical hand ${hand}`);
      }
      if (typeof frequency !== "number" || !Number.isFinite(frequency) || frequency < 0 || frequency > 1) {
        throw new AcademyMttReferenceImportError(`${where}: key "${key}" ${hand} frequency ${String(frequency)} is outside [0, 1]`);
      }
    }
    if (parsed.kind === "SPOT" && profile.missingHandPolicy === "REJECT") {
      const missing = CANONICAL_STARTING_HANDS.filter((hand) => !Object.prototype.hasOwnProperty.call(value, hand));
      if (missing.length > 0) {
        throw new AcademyMttReferenceImportError(
          `${where}: key "${key}" is missing ${missing.length} hand(s) (e.g. ${missing[0]}) but this file's missing-hand policy is REJECT`);
      }
    }
  }
  return raw as SourceRanges;
}

function hasAnyPositive(range: Readonly<Record<string, number>> | undefined): boolean {
  return Boolean(range) && Object.values(range!).some((value) => value > 0);
}

const ACTION_ORDER = ["RAISE", "ALL_IN", "LIMP", "CALL", "FOLD"] as const;

function buildActionDefinitions(stackBb: number): Record<(typeof ACTION_ORDER)[number], AcademyStrategyActionDefinition> {
  return {
    RAISE: { code: "RAISE", kind: "RAISE", label: "Raise" },
    ALL_IN: { code: "ALL_IN", kind: "ALL_IN", label: `All-in ${stackBb} BB`, amountBb: stackBb },
    LIMP: { code: "LIMP", kind: "CALL", label: "Limp" },
    CALL: { code: "CALL", kind: "CALL", label: "Call" },
    FOLD: { code: "FOLD", kind: "FOLD", label: "Fold" },
  };
}

type Spot = { readonly definition: ScenarioDefinition; readonly hero: MttReferenceSourceSeat; readonly villain?: MttReferenceSourceSeat };

function collectSpots(source: SourceRanges): { spots: Spot[]; helpers: string[]; unrecognized: string[] } {
  const found = new Map<string, Spot>();
  const helpers: string[] = [];
  const unrecognized: string[] = [];
  for (const key of Object.keys(source)) {
    const parsed = parseMttReferenceScenarioKey(key);
    if (parsed.kind === "HELPER") { helpers.push(key); continue; }
    if (parsed.kind === "UNRECOGNIZED") { unrecognized.push(key); continue; }
    for (const definition of SCENARIO_DEFINITIONS) {
      if (parsed.prefix !== definition.raise && parsed.prefix !== definition.call) continue;
      if (Boolean(parsed.villain) !== definition.hasVillain) continue;
      found.set(mttReferenceNodeKey(definition.scenario, parsed.hero, parsed.villain), {
        definition, hero: parsed.hero, villain: parsed.villain,
      });
    }
  }
  const seatIndex = (seat: MttReferenceSourceSeat | undefined) => (seat ? MTT_REFERENCE_SOURCE_SEATS.indexOf(seat) : -1);
  const spots = [...found.values()].sort((a, b) =>
    MTT_REFERENCE_SCENARIOS.indexOf(a.definition.scenario) - MTT_REFERENCE_SCENARIOS.indexOf(b.definition.scenario)
    || seatIndex(a.hero) - seatIndex(b.hero)
    || seatIndex(a.villain) - seatIndex(b.villain));
  return { spots, helpers, unrecognized };
}

function tableSizesFor(hero: MttReferenceSourceSeat, villain?: MttReferenceSourceSeat): number[] {
  return MTT_REFERENCE_TABLE_SIZES.filter((size) => {
    const seats = MTT_REFERENCE_TABLE_SIZE_SEATS[size] as readonly string[];
    return seats.includes(hero) && (!villain || seats.includes(villain));
  });
}

type BuiltNode = { node: AcademyStrategyNode; descriptor: MttReferenceNodeDescriptor };

class NodeOutcome extends Error {
  constructor(readonly reason: MttReferenceNodeOutcomeReason, detail: string) {
    super(detail);
  }
}

function buildNode(
  source: SourceRanges,
  spot: Spot,
  profile: MttReferenceStackProfile,
  builtNodes: ReadonlyMap<string, AcademyStrategyNode>,
): BuiltNode {
  const { definition, hero, villain } = spot;
  const nodeKey = mttReferenceNodeKey(definition.scenario, hero, villain);
  const raiseKey = definition.raise ? sourceKey(definition.raise, hero, villain) : undefined;
  const callKey = sourceKey(definition.call, hero, villain);
  const raiseRaw = raiseKey ? source[raiseKey] : undefined;
  const callRaw = source[callKey];

  let prev: Readonly<Record<string, number>> | null = null;
  let prevKey: string | undefined;
  if (definition.prev) {
    prevKey = sourceKey(definition.prev, hero, definition.prevHasVillain ? villain : undefined);
    if (!source[prevKey]) throw new NodeOutcome("MISSING_PREV_KEY", `previous-node key "${prevKey}" does not exist`);
    prev = source[prevKey];
  }

  // Exact upstream transform on both lines, then zero-fill per policy
  // (policy REJECT already guaranteed every key lists all 169 hands).
  const raise = conditionalMttReferenceFrequencies(raiseRaw, prev);
  const call = conditionalMttReferenceFrequencies(callRaw, prev);

  if (!hasAnyPositive(raise) && !hasAnyPositive(call)) {
    throw new NodeOutcome("DEGENERATE_ALL_FOLD", "raise and call are 0 for every hand after composition");
  }
  if (definition.villainOrigin) {
    // Villain's originating node: RFI_<V> for facing-open, otherwise the
    // previous scenario with hero and villain swapped.
    const originKey = definition.villainOrigin === "RFI"
      ? mttReferenceNodeKey("RFI", villain!)
      : mttReferenceNodeKey(definition.villainOrigin, villain!, hero);
    const origin = builtNodes.get(originKey);
    if (!origin || !origin.actionCodes.some((code) => code === "RAISE" || code === "ALL_IN")) {
      throw new NodeOutcome("UNREACHABLE_VILLAIN_ACTION_EMPTY",
        `villain node ${originKey} ${origin ? "offers no raise/all-in" : "was not imported"}, so this spot cannot be reached`);
    }
  }

  const raiseCode = definition.scenario === "FACING_5BET"
    ? null
    : (profile.raiseIsAllIn[definition.scenario] ? "ALL_IN" : "RAISE");
  const actionCodes: AcademyStrategyActionCode[] = [];
  if (raiseCode && hasAnyPositive(raise)) actionCodes.push(raiseCode);
  if (hasAnyPositive(call)) actionCodes.push(definition.callActionCode);
  actionCodes.push("FOLD");

  let zeroFilled = 0;
  let capped = 0;
  let unreached = 0;
  const hands = {} as Record<StartingHandClass, AcademyStrategyHandFrequencies>;
  for (const hand of CANONICAL_STARTING_HANDS) {
    for (const range of [raiseRaw, callRaw]) {
      if (range && !Object.prototype.hasOwnProperty.call(range, hand)) zeroFilled += 1;
    }
    if (prev) {
      const p = prev[hand] ?? 0;
      const rw = raiseRaw?.[hand] ?? 0;
      const cw = callRaw?.[hand] ?? 0;
      if (p > 0 && (rw / p > 1 || cw / p > 1)) capped += 1;
      if (p <= 0 && (rw > 0 || cw > 0)) unreached += 1;
    }
    const r = raise[hand] ?? 0;
    const c = call[hand] ?? 0;
    const nonFold = r + c;
    const fold = 1 - nonFold;
    if (fold < -ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON) {
      throw new NodeOutcome("NEGATIVE_FOLD_REMAINDER",
        `${hand}: raise ${r} + call ${c} = ${nonFold} > 1 + ${ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON}; fold remainder ${fold} is negative`);
    }
    // Within tolerance a float residue below 0 is reported as exactly 0; the
    // sum then stays within the validator's own epsilon.
    const frequencies: Record<string, number> = {};
    if (raiseCode && actionCodes.includes(raiseCode)) frequencies[raiseCode] = r;
    if (actionCodes.includes(definition.callActionCode)) frequencies[definition.callActionCode] = c;
    frequencies.FOLD = fold < 0 ? 0 : fold;
    const sum = Object.values(frequencies).reduce((total, value) => total + value, 0);
    if (Math.abs(sum - 1) > ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON) {
      throw new NodeOutcome("NEGATIVE_FOLD_REMAINDER", `${hand}: action frequencies sum to ${sum}, expected 1`);
    }
    hands[hand] = Object.freeze(frequencies);
  }

  const descriptor: MttReferenceNodeDescriptor = Object.freeze({
    nodeKey,
    scenario: definition.scenario,
    heroPosition: MTT_REFERENCE_SEAT_TO_9MAX[hero],
    ...(villain ? { villainPosition: MTT_REFERENCE_SEAT_TO_9MAX[villain] } : {}),
    sourceHero: hero,
    ...(villain ? { sourceVillain: villain } : {}),
    ...(raiseKey ? { raiseSourceKey: raiseKey } : {}),
    callSourceKey: callKey,
    ...(prevKey ? { prevSourceKey: prevKey } : {}),
    actionCodes: Object.freeze([...actionCodes]),
    tableSizes: Object.freeze(tableSizesFor(hero, villain)),
    zeroFilledHandLookups: zeroFilled,
    conditionalCappedHands: capped,
    conditionalUnreachedHands: unreached,
  });
  return {
    node: Object.freeze({ key: nodeKey, actionCodes: Object.freeze(actionCodes), hands: Object.freeze(hands) }),
    descriptor,
  };
}

function descriptorToNodeSource(descriptor: MttReferenceNodeDescriptor): Record<string, string | number> {
  const source: Record<string, string | number> = {
    scenario: descriptor.scenario,
    heroPosition: descriptor.heroPosition,
    sourceHero: descriptor.sourceHero,
    callSourceKey: descriptor.callSourceKey,
    tableSizes: descriptor.tableSizes.join(","),
    zeroFilledHandLookups: descriptor.zeroFilledHandLookups,
    conditionalCappedHands: descriptor.conditionalCappedHands,
    conditionalUnreachedHands: descriptor.conditionalUnreachedHands,
  };
  if (descriptor.villainPosition) source.villainPosition = descriptor.villainPosition;
  if (descriptor.sourceVillain) source.sourceVillain = descriptor.sourceVillain;
  if (descriptor.raiseSourceKey) source.raiseSourceKey = descriptor.raiseSourceKey;
  if (descriptor.prevSourceKey) source.prevSourceKey = descriptor.prevSourceKey;
  return Object.freeze(source);
}

/**
 * Builds one immutable, validated strategy dataset from one upstream file.
 * Nodes that are all-fold are skipped; nodes that fail a fail-closed check
 * are rejected (both recorded in the report, never repaired). The result is
 * run through the generic `validateAcademyStrategyDataset`.
 */
export function importMttReferenceDataset(raw: unknown, profile: MttReferenceStackProfile): MttReferenceImportResult {
  const source = validateSourceRanges(raw, profile);
  const { spots, helpers, unrecognized } = collectSpots(source);
  const built: BuiltNode[] = [];
  const skipped: MttReferenceNodeOutcome[] = [];
  const rejected: MttReferenceNodeOutcome[] = [];

  // Spots are processed in scenario order, so every villain-origin node is
  // decided before the spots that depend on it.
  const builtNodes = new Map<string, AcademyStrategyNode>();
  for (const spot of spots) {
    try {
      const result = buildNode(source, spot, profile, builtNodes);
      built.push(result);
      builtNodes.set(result.node.key, result.node);
    } catch (error) {
      if (!(error instanceof NodeOutcome)) throw error;
      const outcome = Object.freeze({
        nodeKey: mttReferenceNodeKey(spot.definition.scenario, spot.hero, spot.villain),
        scenario: spot.definition.scenario,
        reason: error.reason,
        detail: error.message,
      });
      (error.reason === "DEGENERATE_ALL_FOLD" ? skipped : rejected).push(outcome);
    }
  }
  if (built.length === 0) {
    throw new AcademyMttReferenceImportError(`MTT reference ${profile.datasetId}: no usable nodes`);
  }

  const definitions = buildActionDefinitions(profile.effectiveStackBb);
  const used = new Set(built.flatMap(({ node }) => node.actionCodes));
  const actions = ACTION_ORDER.filter((code) => used.has(code)).map((code) => Object.freeze(definitions[code]));

  const dataset: AcademyStrategyDataset = {
    id: profile.datasetId,
    version: profile.version,
    title: profile.title,
    metadata: Object.freeze({
      game: "NLHE",
      format: "MTT",
      strategyModel: profile.strategyModel,
      tableSize: 9,
      effectiveStackBb: profile.effectiveStackBb,
      spotCode: "PREFLOP_TREE",
    }),
    provenance: Object.freeze({
      ...profile.provenance,
      nodeSources: Object.freeze(Object.fromEntries(
        built.map(({ descriptor }) => [descriptor.nodeKey, descriptorToNodeSource(descriptor)]))),
    }),
    assumptions: Object.freeze({ ...profile.assumptions }),
    actions: Object.freeze(actions),
    nodes: Object.freeze(Object.fromEntries(built.map(({ node }) => [node.key, node]))),
  };
  validateAcademyStrategyDataset(dataset);

  return Object.freeze({
    dataset: Object.freeze(dataset),
    report: Object.freeze({
      datasetId: profile.datasetId,
      effectiveStackBb: profile.effectiveStackBb,
      nodes: Object.freeze(built.map(({ descriptor }) => descriptor)),
      skipped: Object.freeze(skipped),
      rejected: Object.freeze(rejected),
      ignoredHelperKeys: Object.freeze(helpers),
      ignoredUnrecognizedKeys: Object.freeze(unrecognized),
    }),
  });
}
