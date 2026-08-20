import type {
  AcademyPreflopRange,
  HandRank,
  PreflopAction,
  PreflopMatrixCell,
  PreflopPosition,
  PreflopReferenceStrategy,
  StartingHandClass,
  TeachingRangeStats,
} from "@/types/academy";

export const ACADEMY_TEACHING_OPEN_THRESHOLD = 0.4;
export const PREFLOP_TOTAL_COMBINATIONS = 1326;
export const PREFLOP_RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const satisfies readonly HandRank[];

export const ACADEMY_PREFLOP_POSITIONS = ["UTG", "EP", "MP1", "MP2", "HJ", "CO", "BTN"] as const satisfies readonly PreflopPosition[];

export function isPreflopPosition(value: string): value is PreflopPosition {
  return ACADEMY_PREFLOP_POSITIONS.includes(value as PreflopPosition);
}

function rankIndex(rank: string): number {
  return PREFLOP_RANKS.indexOf(rank as HandRank);
}

export function isCanonicalStartingHand(value: string): value is StartingHandClass {
  if (value.length !== 2 && value.length !== 3) return false;

  const firstIndex = rankIndex(value[0]);
  const secondIndex = rankIndex(value[1]);
  if (firstIndex < 0 || secondIndex < 0) return false;

  if (value.length === 2) return firstIndex === secondIndex;

  const suffix = value[2];
  return firstIndex < secondIndex && (suffix === "s" || suffix === "o");
}

function assertCanonicalStartingHand(value: string): asserts value is StartingHandClass {
  if (!isCanonicalStartingHand(value)) {
    throw new Error(`Invalid canonical starting hand: ${value}`);
  }
}

export function getCanonicalStartingHands(): readonly StartingHandClass[] {
  const hands: StartingHandClass[] = [];

  for (let row = 0; row < PREFLOP_RANKS.length; row += 1) {
    for (let column = 0; column < PREFLOP_RANKS.length; column += 1) {
      const rowRank = PREFLOP_RANKS[row];
      const columnRank = PREFLOP_RANKS[column];
      const hand = row === column
        ? `${rowRank}${columnRank}`
        : row < column
          ? `${rowRank}${columnRank}s`
          : `${columnRank}${rowRank}o`;

      assertCanonicalStartingHand(hand);
      hands.push(hand);
    }
  }

  return hands;
}

export const CANONICAL_STARTING_HANDS = getCanonicalStartingHands();

function expandPlusNotation(hand: StartingHandClass): readonly StartingHandClass[] {
  if (hand.length === 2) {
    const start = rankIndex(hand[0]);
    return PREFLOP_RANKS.slice(0, start + 1).map((rank) => `${rank}${rank}` as StartingHandClass);
  }

  const highRank = hand[0] as HandRank;
  const lowRank = hand[1] as HandRank;
  const suffix = hand[2] as "s" | "o";
  const highIndex = rankIndex(highRank);
  const lowIndex = rankIndex(lowRank);

  return PREFLOP_RANKS
    .slice(highIndex + 1, lowIndex + 1)
    .map((kicker) => `${highRank}${kicker}${suffix}` as StartingHandClass);
}

/** Parses the compact notation used by the public HRC Scenario B export. */
export function parseHrcRangeNotation(notation: string): PreflopReferenceStrategy {
  const strategy: Partial<Record<StartingHandClass, number>> = {};

  for (const rawToken of notation.split(",")) {
    const token = rawToken.trim();
    if (!token) continue;

    const [handExpression, rawFrequency] = token.split(":");
    const hasPlus = handExpression.endsWith("+");
    const hand = hasPlus ? handExpression.slice(0, -1) : handExpression;
    assertCanonicalStartingHand(hand);

    const frequency = rawFrequency === undefined ? 1 : Number(rawFrequency);
    if (!Number.isFinite(frequency) || frequency < 0 || frequency > 1) {
      throw new Error(`Invalid HRC frequency for ${hand}: ${rawFrequency}`);
    }

    const expandedHands = hasPlus ? expandPlusNotation(hand) : [hand];
    for (const expandedHand of expandedHands) {
      if (strategy[expandedHand] !== undefined) {
        throw new Error(`Duplicate HRC hand: ${expandedHand}`);
      }
      strategy[expandedHand] = frequency;
    }
  }

  return Object.freeze(strategy);
}

export function normalizeReferenceStrategy(
  strategy: PreflopReferenceStrategy,
): Readonly<Record<StartingHandClass, number>> {
  return Object.freeze(Object.fromEntries(
    CANONICAL_STARTING_HANDS.map((hand) => [hand, strategy[hand] ?? 0]),
  ) as Record<StartingHandClass, number>);
}

export function getTeachingAction(referenceFrequency: number): PreflopAction {
  return referenceFrequency >= ACADEMY_TEACHING_OPEN_THRESHOLD ? "OPEN" : "FOLD";
}

export function getStartingHandCombinationCount(hand: StartingHandClass): 4 | 6 | 12 {
  assertCanonicalStartingHand(hand);
  if (hand.length === 2) return 6;
  return hand.endsWith("s") ? 4 : 12;
}

export function buildPreflopMatrix(
  strategy: PreflopReferenceStrategy,
): readonly (readonly PreflopMatrixCell[])[] {
  const normalized = normalizeReferenceStrategy(strategy);

  return PREFLOP_RANKS.map((_, row) => Object.freeze(
    PREFLOP_RANKS.map((__, column) => {
      const hand = CANONICAL_STARTING_HANDS[row * PREFLOP_RANKS.length + column];
      const referenceFrequency = normalized[hand];
      return Object.freeze({
        row,
        column,
        hand,
        referenceFrequency,
        teachingAction: getTeachingAction(referenceFrequency),
        combinationCount: getStartingHandCombinationCount(hand),
      });
    }),
  ));
}

export function calculateWeightedRangePercentage(strategy: PreflopReferenceStrategy): number {
  const weightedCombinations = CANONICAL_STARTING_HANDS.reduce(
    (total, hand) => total + (strategy[hand] ?? 0) * getStartingHandCombinationCount(hand),
    0,
  );

  return (weightedCombinations / PREFLOP_TOTAL_COMBINATIONS) * 100;
}

export function calculateTeachingRangeStats(
  strategy: PreflopReferenceStrategy,
): TeachingRangeStats {
  const teachingOpenComboCount = CANONICAL_STARTING_HANDS.reduce(
    (total, hand) => getTeachingAction(strategy[hand] ?? 0) === "OPEN"
      ? total + getStartingHandCombinationCount(hand)
      : total,
    0,
  );

  return {
    teachingOpenComboCount,
    teachingOpenPercentage: (teachingOpenComboCount / PREFLOP_TOTAL_COMBINATIONS) * 100,
  };
}

export function validateAcademyPreflopRange(range: AcademyPreflopRange): void {
  for (const [hand, frequency] of Object.entries(range.referenceStrategy)) {
    assertCanonicalStartingHand(hand);
    if (frequency === undefined || !Number.isFinite(frequency) || frequency < 0 || frequency > 1) {
      throw new Error(`Invalid reference frequency for ${range.position} ${hand}`);
    }
  }
}
