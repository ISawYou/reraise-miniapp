/**
 * Adapter: HoldemMath push/fold charts (`pushfold/pushfold_charts.json`, see
 * data/academy/reference/holdemmath-pushfold/MANIFEST.json) → RERAISE
 * `AcademyStrategyDataset`.
 *
 * Status of the data: EXTERNAL_REFERENCE_LICENSED (CC BY 4.0, attribution
 * "Data source: HoldemMath — https://holdemmath.com/"). NOT RERAISE solver
 * output. Model (upstream README, reproduced faithfully): heads-up is a
 * near-exact Nash equilibrium; 6-max / 9-max tables use a SINGLE-CALLER
 * APPROXIMATION per first-in seat with SB's first-in range fixed to the
 * heads-up solution — not a true multi-way Nash equilibrium. Chip EV, no
 * rake, no limps, no ICM.
 *
 * Pure (no I/O). Source shape:
 *   { v: 1, depths, order: [169 hand classes], formats: { max9: { seats } },
 *     anteVariants: { data: 0, dataAnte10: 0.1 },
 *     data | dataAnte10: { <fmt>: { <depth>: { <seatKey>: { s, p, e? } } } } }
 * `s` = indices into `order` of the hands IN the range (pure membership),
 * `p` = % of the 1326 combos covered, `e` = chip EV per hand (bb, fold = 0).
 *
 * Seat keys:
 *   "<SEAT>"             first-in shove range  → FIRST_IN_SHOVE node (ALL_IN / FOLD)
 *   "<CALLER>|<SHOVER>"  caller's range facing SHOVER's first-in shove
 *                        → CALL_VS_SHOVE node (CALL / FOLD)
 *
 * Node keys (RERAISE 9-max seat names, same scheme as the MTT reference
 * import; upstream "MP" is renamed "UTG2", see `PUSH_FOLD_SOURCE_SEAT_TO_9MAX`):
 *   FIRST_IN_SHOVE_<HERO>
 *   CALL_VS_SHOVE_<HERO>_VS_<SHOVER>
 *
 * Frequencies (never fabricated, never mixed): a hand listed in `s` gets the
 * node's non-fold action = 1 and FOLD = 0; every other hand FOLD = 1 and the
 * non-fold action = 0.
 *
 * EV is intentionally NOT imported: the runtime `AcademyStrategyDataset`
 * carries frequencies only (schema-v1's optional `evBb` is "type only … dropped
 * when converting to the runtime dataset", data/academy/solver/README.md).
 * Carrying EV would need a runtime-model change beyond this importer, so `e`
 * is only structurally validated (169 finite numbers when present) and then
 * discarded.
 *
 * Fail closed — the whole import throws `AcademyPushFoldImportError` on: an
 * unexpected version / seat list / ante value, an `order` that is not a
 * permutation of the 169 canonical hand classes, a missing depth, an
 * unrecognized seat key, an unknown PfRange field, a non-integer / out-of-range
 * / duplicate hand index, an empty range, a `p` that does not match the
 * combos of `s` (±0.05, the source rounds to 0.1), a malformed `e`, or a
 * call-vs-shove key whose shover has no first-in range at that depth. Nothing
 * is skipped, clamped or repaired.
 */
import { CANONICAL_STARTING_HANDS, isCanonicalStartingHand, PREFLOP_TOTAL_COMBINATIONS } from "@/lib/academy/preflop";
import { validateAcademyStrategyDataset } from "@/lib/academy/solver";
import type {
  AcademyPushFoldSituation,
  AcademyStrategyActionDefinition,
  AcademyStrategyDataset,
  AcademyStrategyHandFrequencies,
  AcademyStrategyNode,
  StartingHandClass,
} from "@/types/academy";

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/** Upstream max9 seats, in table order (exactly `formats.max9.seats`). */
export const PUSH_FOLD_SOURCE_SEATS = Object.freeze([
  "UTG", "UTG1", "MP", "LJ", "HJ", "CO", "BTN", "SB", "BB",
] as const);
export type PushFoldSourceSeat = (typeof PUSH_FOLD_SOURCE_SEATS)[number];

/**
 * RERAISE 9-max seat names (same as the MTT reference import and the shared
 * table: UTG, UTG1, UTG2, LJ, HJ, CO, BTN, SB, BB). Only upstream "MP" is
 * renamed — it is the third seat, called UTG2 everywhere else in Solver Lab.
 */
export const PUSH_FOLD_SOURCE_SEAT_TO_9MAX = Object.freeze({
  UTG: "UTG",
  UTG1: "UTG1",
  MP: "UTG2",
  LJ: "LJ",
  HJ: "HJ",
  CO: "CO",
  BTN: "BTN",
  SB: "SB",
  BB: "BB",
} as const satisfies Record<PushFoldSourceSeat, string>);
export type PushFold9MaxSeat = (typeof PUSH_FOLD_SOURCE_SEAT_TO_9MAX)[PushFoldSourceSeat];

/** Upstream variant key → ante per player in BB (must equal `anteVariants`). */
export const PUSH_FOLD_SOURCE_VARIANTS = Object.freeze({ data: 0, dataAnte10: 0.1 } as const);
export type PushFoldSourceVariant = keyof typeof PUSH_FOLD_SOURCE_VARIANTS;

export const PUSH_FOLD_SITUATIONS = Object.freeze([
  "FIRST_IN_SHOVE",
  "CALL_VS_SHOVE",
] as const satisfies readonly AcademyPushFoldSituation[]);

function isSourceSeat(value: string): value is PushFoldSourceSeat {
  return (PUSH_FOLD_SOURCE_SEATS as readonly string[]).includes(value);
}

const seatIndex = (seat: PushFoldSourceSeat) => PUSH_FOLD_SOURCE_SEATS.indexOf(seat);

export type ParsedPushFoldSeatKey =
  | { readonly kind: "FIRST_IN_SHOVE"; readonly hero: PushFoldSourceSeat }
  | { readonly kind: "CALL_VS_SHOVE"; readonly hero: PushFoldSourceSeat; readonly villain: PushFoldSourceSeat }
  | { readonly kind: "UNRECOGNIZED" };

/**
 * Parses one upstream max9 seat key. First-in: any seat but BB (BB never acts
 * first in). Call: "<caller>|<shover>" with both real seats and the caller
 * acting AFTER the shover. Anything else is UNRECOGNIZED (and rejects the import).
 */
export function parsePushFoldSeatKey(key: string): ParsedPushFoldSeatKey {
  const parts = key.split("|");
  if (parts.length === 1) {
    const [hero] = parts;
    return isSourceSeat(hero) && hero !== "BB" ? { kind: "FIRST_IN_SHOVE", hero } : { kind: "UNRECOGNIZED" };
  }
  if (parts.length === 2) {
    const [hero, villain] = parts;
    if (isSourceSeat(hero) && isSourceSeat(villain) && seatIndex(hero) > seatIndex(villain) && villain !== "BB") {
      return { kind: "CALL_VS_SHOVE", hero, villain };
    }
  }
  return { kind: "UNRECOGNIZED" };
}

/** RERAISE node key for a parsed seat key. */
export function pushFoldNodeKey(parsed: Exclude<ParsedPushFoldSeatKey, { kind: "UNRECOGNIZED" }>): string {
  const hero = PUSH_FOLD_SOURCE_SEAT_TO_9MAX[parsed.hero];
  return parsed.kind === "FIRST_IN_SHOVE"
    ? `FIRST_IN_SHOVE_${hero}`
    : `CALL_VS_SHOVE_${hero}_VS_${PUSH_FOLD_SOURCE_SEAT_TO_9MAX[parsed.villain]}`;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export class AcademyPushFoldImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcademyPushFoldImportError";
  }
}

export type PushFoldDatasetProfile = {
  readonly datasetId: string;
  readonly version: number;
  readonly title: string;
  readonly depthBb: number;
  readonly variant: PushFoldSourceVariant;
  readonly provenance: Omit<AcademyStrategyDataset["provenance"], "nodeSources">;
  readonly assumptions: AcademyStrategyDataset["assumptions"];
};

export type PushFoldNodeDescriptor = {
  readonly nodeKey: string;
  readonly situation: AcademyPushFoldSituation;
  readonly heroPosition: PushFold9MaxSeat;
  readonly villainPosition?: PushFold9MaxSeat;
  readonly sourceSeatKey: string;
  /** Number of hand classes in the source range (`s.length`). */
  readonly sourceHandCount: number;
  /** The source's own coverage percentage (`p`). */
  readonly sourceCoveragePercent: number;
};

export type PushFoldImportResult = {
  readonly dataset: AcademyStrategyDataset;
  readonly nodes: readonly PushFoldNodeDescriptor[];
};

export const PUSH_FOLD_EXPECTED_SOURCE_VERSION = 1;

/** The source rounds `p` to 0.1 %, so it may differ from the exact combos by ≤ 0.05. */
export const PUSH_FOLD_COVERAGE_TOLERANCE_PERCENT = 0.05 + 1e-9;

/** Action codes: non-fold action first (resolver order), FOLD last. */
export const PUSH_FOLD_ACTION_ORDER = Object.freeze(["ALL_IN", "CALL", "FOLD"] as const);

function buildActionDefinitions(depthBb: number): readonly AcademyStrategyActionDefinition[] {
  return Object.freeze([
    Object.freeze({
      code: "ALL_IN",
      kind: "ALL_IN",
      label: `All-in ${depthBb} BB`,
      amountBb: depthBb,
      ru: Object.freeze({ button: "Олл-ин", inline: "олл-ин", short: "олл-ин", always: "всегда идём олл-ин" }),
    }),
    Object.freeze({
      code: "CALL",
      kind: "CALL",
      label: "Call all-in",
      ru: Object.freeze({ button: "Колл", inline: "колл олл-ина", short: "колл", always: "всегда коллируем" }),
    }),
    Object.freeze({
      code: "FOLD",
      kind: "FOLD",
      label: "Fold",
      ru: Object.freeze({ button: "Фолд", inline: "фолд", short: "фолд", always: "всегда сбрасываем" }),
    }),
  ] satisfies AcademyStrategyActionDefinition[]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function combosOf(hand: StartingHandClass): number {
  return hand.length === 2 ? 6 : hand[2] === "s" ? 4 : 12;
}

/** `order` must be exactly a permutation of the 169 canonical hand classes. */
function validateOrder(where: string, order: unknown): readonly StartingHandClass[] {
  if (!Array.isArray(order) || order.length !== CANONICAL_STARTING_HANDS.length) {
    throw new AcademyPushFoldImportError(`${where}: order must list ${CANONICAL_STARTING_HANDS.length} hand classes`);
  }
  const seen = new Set<string>();
  for (const hand of order) {
    if (typeof hand !== "string" || !isCanonicalStartingHand(hand)) {
      throw new AcademyPushFoldImportError(`${where}: order has non-canonical hand ${String(hand)}`);
    }
    if (seen.has(hand)) throw new AcademyPushFoldImportError(`${where}: order lists ${hand} twice`);
    seen.add(hand);
  }
  return order as StartingHandClass[];
}

const RANGE_FIELDS: readonly string[] = ["s", "p", "e"];

type ValidatedRange = { readonly inRange: ReadonlySet<StartingHandClass>; readonly coverage: number; readonly handCount: number };

function validateRange(where: string, raw: unknown, order: readonly StartingHandClass[]): ValidatedRange {
  if (!isPlainObject(raw)) throw new AcademyPushFoldImportError(`${where}: range must be an object`);
  for (const field of Object.keys(raw)) {
    if (!RANGE_FIELDS.includes(field)) throw new AcademyPushFoldImportError(`${where}: unknown range field ${field}`);
  }
  const { s, p, e } = raw;
  if (!Array.isArray(s) || s.length === 0) throw new AcademyPushFoldImportError(`${where}: s must be a non-empty list`);
  const inRange = new Set<StartingHandClass>();
  for (const index of s) {
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= order.length) {
      throw new AcademyPushFoldImportError(`${where}: hand index ${String(index)} is outside [0, ${order.length - 1}]`);
    }
    const hand = order[index];
    if (inRange.has(hand)) throw new AcademyPushFoldImportError(`${where}: hand index ${index} (${hand}) is listed twice`);
    inRange.add(hand);
  }
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 100) {
    throw new AcademyPushFoldImportError(`${where}: p ${String(p)} must be a percentage in [0, 100]`);
  }
  const combos = [...inRange].reduce((total, hand) => total + combosOf(hand), 0);
  const exact = (combos / PREFLOP_TOTAL_COMBINATIONS) * 100;
  if (Math.abs(exact - p) > PUSH_FOLD_COVERAGE_TOLERANCE_PERCENT) {
    throw new AcademyPushFoldImportError(`${where}: p ${p} does not match the range's ${exact.toFixed(3)}% of combos`);
  }
  if (e !== undefined) {
    if (!Array.isArray(e) || e.length !== order.length || e.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      throw new AcademyPushFoldImportError(`${where}: e must list ${order.length} finite numbers`);
    }
  }
  return { inRange, coverage: p, handCount: inRange.size };
}

/**
 * Validates the source's top-level structure for one (variant, depth) and
 * returns its seat-key → range table (max9 only).
 */
function validateSource(raw: unknown, profile: PushFoldDatasetProfile) {
  const where = `HoldemMath push/fold ${profile.datasetId}`;
  if (!isPlainObject(raw)) throw new AcademyPushFoldImportError(`${where}: source must be an object`);
  if (raw.v !== PUSH_FOLD_EXPECTED_SOURCE_VERSION) {
    throw new AcademyPushFoldImportError(`${where}: unsupported source version ${String(raw.v)}`);
  }
  if (!Array.isArray(raw.depths) || !raw.depths.includes(profile.depthBb)) {
    throw new AcademyPushFoldImportError(`${where}: source does not declare depth ${profile.depthBb}`);
  }
  const order = validateOrder(where, raw.order);
  const formats = raw.formats;
  const seats = isPlainObject(formats) && isPlainObject(formats.max9) ? formats.max9.seats : undefined;
  if (!Array.isArray(seats) || seats.length !== PUSH_FOLD_SOURCE_SEATS.length
    || seats.some((seat, index) => seat !== PUSH_FOLD_SOURCE_SEATS[index])) {
    throw new AcademyPushFoldImportError(`${where}: formats.max9.seats must be ${PUSH_FOLD_SOURCE_SEATS.join(",")}`);
  }
  const anteVariants = raw.anteVariants;
  if (!isPlainObject(anteVariants) || anteVariants[profile.variant] !== PUSH_FOLD_SOURCE_VARIANTS[profile.variant]) {
    throw new AcademyPushFoldImportError(
      `${where}: anteVariants.${profile.variant} must be ${PUSH_FOLD_SOURCE_VARIANTS[profile.variant]}`);
  }
  const variantData = raw[profile.variant];
  const max9 = isPlainObject(variantData) ? variantData.max9 : undefined;
  const table = isPlainObject(max9) ? max9[String(profile.depthBb)] : undefined;
  if (!isPlainObject(table) || Object.keys(table).length === 0) {
    throw new AcademyPushFoldImportError(`${where}: ${profile.variant}.max9.${profile.depthBb} is missing`);
  }
  return { where, order, table };
}

function pureHands(
  inRange: ReadonlySet<StartingHandClass>,
  actionCode: "ALL_IN" | "CALL",
): Readonly<Record<StartingHandClass, AcademyStrategyHandFrequencies>> {
  const hands = {} as Record<StartingHandClass, AcademyStrategyHandFrequencies>;
  for (const hand of CANONICAL_STARTING_HANDS) {
    const member = inRange.has(hand);
    hands[hand] = Object.freeze({ [actionCode]: member ? 1 : 0, FOLD: member ? 0 : 1 });
  }
  return Object.freeze(hands);
}

const situationRank = (situation: AcademyPushFoldSituation) => PUSH_FOLD_SITUATIONS.indexOf(situation);

/**
 * Builds one immutable, validated dataset for one (variant, depth) of the
 * max9 charts. Every recognized key becomes exactly one node; any
 * unrecognized key, malformed range or unreachable call node rejects the
 * whole import (fail closed). Result passes `validateAcademyStrategyDataset`.
 */
export function importHoldemMathPushFoldDataset(raw: unknown, profile: PushFoldDatasetProfile): PushFoldImportResult {
  const { where, order, table } = validateSource(raw, profile);

  type Parsed = Exclude<ParsedPushFoldSeatKey, { kind: "UNRECOGNIZED" }>;
  const parsedKeys: Array<{ key: string; parsed: Parsed }> = [];
  for (const key of Object.keys(table)) {
    const parsed = parsePushFoldSeatKey(key);
    if (parsed.kind === "UNRECOGNIZED") throw new AcademyPushFoldImportError(`${where}: unrecognized seat key "${key}"`);
    parsedKeys.push({ key, parsed });
  }
  const firstInSeats = new Set(parsedKeys.flatMap(({ parsed }) => (parsed.kind === "FIRST_IN_SHOVE" ? [parsed.hero] : [])));

  const built: Array<{ node: AcademyStrategyNode; descriptor: PushFoldNodeDescriptor }> = [];
  for (const { key, parsed } of parsedKeys) {
    if (parsed.kind === "CALL_VS_SHOVE" && !firstInSeats.has(parsed.villain)) {
      throw new AcademyPushFoldImportError(`${where}: "${key}" has no first-in shove range for ${parsed.villain}`);
    }
    const range = validateRange(`${where} "${key}"`, table[key], order);
    const nodeKey = pushFoldNodeKey(parsed);
    const actionCode = parsed.kind === "FIRST_IN_SHOVE" ? "ALL_IN" : "CALL";
    built.push({
      node: Object.freeze({ key: nodeKey, actionCodes: Object.freeze([actionCode, "FOLD"]), hands: pureHands(range.inRange, actionCode) }),
      descriptor: Object.freeze({
        nodeKey,
        situation: parsed.kind,
        heroPosition: PUSH_FOLD_SOURCE_SEAT_TO_9MAX[parsed.hero],
        ...(parsed.kind === "CALL_VS_SHOVE" ? { villainPosition: PUSH_FOLD_SOURCE_SEAT_TO_9MAX[parsed.villain] } : {}),
        sourceSeatKey: key,
        sourceHandCount: range.handCount,
        sourceCoveragePercent: range.coverage,
      }),
    });
  }
  const seatRank = (seat: string | undefined) => (seat ? Object.values(PUSH_FOLD_SOURCE_SEAT_TO_9MAX).indexOf(seat as PushFold9MaxSeat) : -1);
  built.sort((a, b) =>
    situationRank(a.descriptor.situation) - situationRank(b.descriptor.situation)
    || seatRank(a.descriptor.heroPosition) - seatRank(b.descriptor.heroPosition)
    || seatRank(a.descriptor.villainPosition) - seatRank(b.descriptor.villainPosition));

  const used = new Set(built.flatMap(({ node }) => node.actionCodes));
  const actions = buildActionDefinitions(profile.depthBb).filter((action) => used.has(action.code));

  const dataset: AcademyStrategyDataset = {
    id: profile.datasetId,
    version: profile.version,
    title: profile.title,
    metadata: Object.freeze({
      game: "NLHE",
      format: "MTT",
      strategyModel: "CHIP_EV",
      tableSize: 9,
      effectiveStackBb: profile.depthBb,
      spotCode: "PUSH_FOLD",
    }),
    provenance: Object.freeze({
      ...profile.provenance,
      nodeSources: Object.freeze(Object.fromEntries(built.map(({ descriptor }) => [descriptor.nodeKey, Object.freeze({
        situation: descriptor.situation,
        heroPosition: descriptor.heroPosition,
        ...(descriptor.villainPosition ? { villainPosition: descriptor.villainPosition } : {}),
        sourceSeatKey: descriptor.sourceSeatKey,
        sourceHandCount: descriptor.sourceHandCount,
        sourceCoveragePercent: descriptor.sourceCoveragePercent,
      })]))),
    }),
    assumptions: Object.freeze({ ...profile.assumptions }),
    actions,
    nodes: Object.freeze(Object.fromEntries(built.map(({ node }) => [node.key, node]))),
  };
  validateAcademyStrategyDataset(dataset);

  return Object.freeze({
    dataset: Object.freeze(dataset),
    nodes: Object.freeze(built.map(({ descriptor }) => descriptor)),
  });
}
