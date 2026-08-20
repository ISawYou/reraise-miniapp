import {
  ACADEMY_PASS_THRESHOLD,
  ACADEMY_TRAINING_BUCKET_TARGETS,
  ACADEMY_TRAINING_QUESTION_COUNT,
} from "@/config/academy/training";
import {
  ACADEMY_TEACHING_OPEN_THRESHOLD,
  CANONICAL_STARTING_HANDS,
  PREFLOP_RANKS,
  getTeachingAction,
  isCanonicalStartingHand,
} from "@/lib/academy/preflop";
import type {
  AcademyTrainingBucket,
  AcademyTrainingQuestion,
  AcademyTrainingResult,
  AcademyTrainingSession,
  HandRank,
  PlayingCardSuit,
  PreflopAction,
  PreflopPosition,
  PreflopReferenceStrategy,
  RenderedPlayingCard,
  StartingHandClass,
} from "@/types/academy";

export type AcademyRandom = () => number;

export type CreateTrainingSessionInput = {
  readonly position: PreflopPosition;
  readonly referenceStrategy: PreflopReferenceStrategy;
  readonly rng?: AcademyRandom;
  readonly candidateHands?: readonly StartingHandClass[];
  readonly questionCount?: number;
  readonly resolveTeachingAction?: (referenceFrequency: number) => PreflopAction;
};

const FOLD_BOUNDARY_MIN_FREQUENCY = 0.1;
const CORE_OPEN_MIN_FREQUENCY = 0.8;
const SUITS = ["♠", "♥", "♦", "♣"] as const satisfies readonly PlayingCardSuit[];

const BUCKET_ORDER = [
  "CORE_OPEN",
  "OPEN_BOUNDARY",
  "FOLD_BOUNDARY",
  "CLEAR_FOLD",
] as const satisfies readonly AcademyTrainingBucket[];

type Candidate = {
  readonly hand: StartingHandClass;
  readonly frequency: number;
  readonly bucket: AcademyTrainingBucket;
  readonly action: PreflopAction;
  readonly boundaryDistance: number | null;
  readonly educationalPriority: 1 | 2 | 3 | 4;
};

export type TrainingCandidateDiagnostic = Pick<
  Candidate,
  | "hand"
  | "frequency"
  | "bucket"
  | "action"
  | "boundaryDistance"
  | "educationalPriority"
>;

export function classifyTrainingBucket(referenceFrequency: number): AcademyTrainingBucket {
  if (!Number.isFinite(referenceFrequency) || referenceFrequency < 0 || referenceFrequency > 1) {
    throw new Error(`Invalid reference frequency: ${referenceFrequency}`);
  }
  if (referenceFrequency >= CORE_OPEN_MIN_FREQUENCY) return "CORE_OPEN";
  if (referenceFrequency >= ACADEMY_TEACHING_OPEN_THRESHOLD) return "OPEN_BOUNDARY";
  if (referenceFrequency >= FOLD_BOUNDARY_MIN_FREQUENCY) return "FOLD_BOUNDARY";
  return "CLEAR_FOLD";
}

function shuffled<T>(items: readonly T[], rng: AcademyRandom): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function rankIndex(rank: string): number {
  return PREFLOP_RANKS.indexOf(rank as HandRank);
}

function structuralDistance(
  foldHand: StartingHandClass,
  openHand: StartingHandClass,
): number | null {
  const foldIsPair = foldHand.length === 2;
  const openIsPair = openHand.length === 2;

  if (foldIsPair || openIsPair) {
    return foldIsPair && openIsPair
      ? Math.abs(rankIndex(foldHand[0]) - rankIndex(openHand[0]))
      : null;
  }

  const sameSuitedness = foldHand[2] === openHand[2];
  if (!sameSuitedness) return null;

  const foldHigh = rankIndex(foldHand[0]);
  const foldLow = rankIndex(foldHand[1]);
  const openHigh = rankIndex(openHand[0]);
  const openLow = rankIndex(openHand[1]);

  if (foldHigh === openHigh) return Math.abs(foldLow - openLow);

  const foldGap = foldLow - foldHigh;
  const openGap = openLow - openHigh;
  if (foldHand[2] === "s" && foldGap === openGap) {
    return Math.abs(foldHigh - openHigh);
  }

  return null;
}

function calculateBoundaryDistance(
  hand: StartingHandClass,
  oppositeActionHands: readonly StartingHandClass[],
): number | null {
  let closest: number | null = null;
  for (const oppositeHand of oppositeActionHands) {
    const distance = structuralDistance(hand, oppositeHand);
    if (distance === null || distance === 0) continue;
    if (closest === null || distance < closest) closest = distance;
  }
  return closest;
}

function getEducationalPriority(
  action: PreflopAction,
  bucket: AcademyTrainingBucket,
  boundaryDistance: number | null,
): 1 | 2 | 3 | 4 {
  if (action === "OPEN" && bucket === "OPEN_BOUNDARY") return 1;
  if (bucket === "FOLD_BOUNDARY") return 1;
  if (boundaryDistance === 1) return 2;
  if (boundaryDistance === 2) return 3;
  return 4;
}

function buildCandidate(
  hand: StartingHandClass,
  referenceStrategy: PreflopReferenceStrategy,
  teachingOpenHands: readonly StartingHandClass[],
  teachingFoldHands: readonly StartingHandClass[],
  resolveTeachingAction: (referenceFrequency: number) => PreflopAction,
): Candidate {
  const frequency = referenceStrategy[hand] ?? 0;
  const action = resolveTeachingAction(frequency);
  const bucket = classifyTrainingBucket(frequency);
  const boundaryDistance = calculateBoundaryDistance(
    hand,
    action === "FOLD" ? teachingOpenHands : teachingFoldHands,
  );

  return {
    hand,
    frequency,
    bucket,
    action,
    boundaryDistance,
    educationalPriority: getEducationalPriority(action, bucket, boundaryDistance),
  };
}

export function getTrainingCandidateDiagnostic(
  hand: StartingHandClass,
  referenceStrategy: PreflopReferenceStrategy,
  resolveTeachingAction: (referenceFrequency: number) => PreflopAction = getTeachingAction,
): TrainingCandidateDiagnostic {
  if (!isCanonicalStartingHand(hand)) throw new Error(`Invalid canonical starting hand: ${hand}`);
  const teachingOpenHands = CANONICAL_STARTING_HANDS.filter(
    (candidateHand) => resolveTeachingAction(referenceStrategy[candidateHand] ?? 0) === "OPEN",
  );
  const teachingFoldHands = CANONICAL_STARTING_HANDS.filter(
    (candidateHand) => resolveTeachingAction(referenceStrategy[candidateHand] ?? 0) === "FOLD",
  );
  return buildCandidate(
    hand,
    referenceStrategy,
    teachingOpenHands,
    teachingFoldHands,
    resolveTeachingAction,
  );
}

function rankedBoundaryCandidates(
  candidates: readonly Candidate[],
  rng: AcademyRandom,
): Candidate[] {
  return shuffled(candidates, rng).sort((left, right) =>
    left.educationalPriority - right.educationalPriority ||
    (left.boundaryDistance ?? Number.POSITIVE_INFINITY) -
      (right.boundaryDistance ?? Number.POSITIVE_INFINITY) ||
    right.frequency - left.frequency,
  );
}

function rankedLowerOpenCandidates(
  candidates: readonly Candidate[],
  rng: AcademyRandom,
): Candidate[] {
  return shuffled(candidates, rng).sort((left, right) =>
    left.educationalPriority - right.educationalPriority ||
    (left.boundaryDistance ?? Number.POSITIVE_INFINITY) -
      (right.boundaryDistance ?? Number.POSITIVE_INFINITY) ||
    left.frequency - right.frequency,
  );
}

function getCardColor(suit: PlayingCardSuit): "red" | "black" {
  return suit === "♥" || suit === "♦" ? "red" : "black";
}

function toRenderedCard(rank: HandRank, suit: PlayingCardSuit): RenderedPlayingCard {
  return { rank, suit, color: getCardColor(suit) };
}

export function renderStartingHand(
  hand: StartingHandClass,
  rng: AcademyRandom = Math.random,
): readonly [RenderedPlayingCard, RenderedPlayingCard] {
  if (!isCanonicalStartingHand(hand)) throw new Error(`Invalid canonical starting hand: ${hand}`);

  const firstSuitIndex = Math.floor(rng() * SUITS.length);
  const firstSuit = SUITS[firstSuitIndex];
  const firstRank = hand[0] as HandRank;
  const secondRank = hand[1] as HandRank;

  if (hand.endsWith("s")) {
    return [toRenderedCard(firstRank, firstSuit), toRenderedCard(secondRank, firstSuit)];
  }

  const differentSuits = SUITS.filter((suit) => suit !== firstSuit);
  const secondSuit = differentSuits[Math.floor(rng() * differentSuits.length)];
  return [toRenderedCard(firstRank, firstSuit), toRenderedCard(secondRank, secondSuit)];
}

export function createTrainingSession({
  position,
  referenceStrategy,
  rng = Math.random,
  candidateHands = CANONICAL_STARTING_HANDS,
  questionCount = ACADEMY_TRAINING_QUESTION_COUNT,
  resolveTeachingAction = getTeachingAction,
}: CreateTrainingSessionInput): AcademyTrainingSession {
  const uniqueHands = [...new Set(candidateHands)];
  for (const hand of uniqueHands) {
    if (!isCanonicalStartingHand(hand)) throw new Error(`Invalid canonical starting hand: ${hand}`);
  }
  const teachingOpenHands = CANONICAL_STARTING_HANDS.filter(
    (hand) => resolveTeachingAction(referenceStrategy[hand] ?? 0) === "OPEN",
  );
  const teachingFoldHands = CANONICAL_STARTING_HANDS.filter(
    (hand) => resolveTeachingAction(referenceStrategy[hand] ?? 0) === "FOLD",
  );
  const candidates = uniqueHands.map((hand) =>
    buildCandidate(
      hand,
      referenceStrategy,
      teachingOpenHands,
      teachingFoldHands,
      resolveTeachingAction,
    ),
  );

  const pools = Object.fromEntries(BUCKET_ORDER.map((bucket) => {
    const bucketCandidates = candidates.filter((candidate) => candidate.bucket === bucket);
    return [
      bucket,
      bucket === "CLEAR_FOLD"
        ? rankedBoundaryCandidates(bucketCandidates, rng)
        : bucket === "CORE_OPEN"
          ? rankedLowerOpenCandidates(bucketCandidates, rng)
          : shuffled(bucketCandidates, rng),
    ];
  })) as Record<AcademyTrainingBucket, Candidate[]>;

  const selected: Candidate[] = [];
  const selectedHands = new Set<StartingHandClass>();

  function takeFromPool(pool: Candidate[], count: number): void {
    while (count > 0 && pool.length > 0) {
      const candidate = pool.shift()!;
      if (selectedHands.has(candidate.hand)) continue;
      selected.push(candidate);
      selectedHands.add(candidate.hand);
      count -= 1;
    }
  }

  const easyOpenPool = rankedLowerOpenCandidates(pools.CORE_OPEN, rng);
  const lowerOpenPool = rankedLowerOpenCandidates(pools.CORE_OPEN, rng);
  const structuralFoldPool = pools.CLEAR_FOLD.filter(
    (candidate) => candidate.educationalPriority < 4,
  );
  const easyFoldPool = shuffled(
    pools.CLEAR_FOLD.filter((candidate) => candidate.educationalPriority === 4),
    rng,
  );

  takeFromPool(easyOpenPool, ACADEMY_TRAINING_BUCKET_TARGETS.CORE_OPEN);
  takeFromPool(pools.OPEN_BOUNDARY, ACADEMY_TRAINING_BUCKET_TARGETS.OPEN_BOUNDARY);
  takeFromPool(lowerOpenPool, Math.max(0, 5 - selected.length));

  takeFromPool(pools.FOLD_BOUNDARY, ACADEMY_TRAINING_BUCKET_TARGETS.FOLD_BOUNDARY);
  takeFromPool(
    structuralFoldPool,
    Math.max(0, 9 - selected.length),
  );
  takeFromPool(easyFoldPool, ACADEMY_TRAINING_BUCKET_TARGETS.CLEAR_FOLD);

  const targetOpenCount =
    ACADEMY_TRAINING_BUCKET_TARGETS.CORE_OPEN +
    ACADEMY_TRAINING_BUCKET_TARGETS.OPEN_BOUNDARY;
  const targetFoldCount =
    ACADEMY_TRAINING_BUCKET_TARGETS.FOLD_BOUNDARY +
    ACADEMY_TRAINING_BUCKET_TARGETS.CLEAR_FOLD;

  function selectedActionCount(action: PreflopAction): number {
    return selected.filter((candidate) => candidate.action === action).length;
  }

  for (const bucket of ["OPEN_BOUNDARY", "CORE_OPEN"] as const) {
    takeFromPool(pools[bucket], Math.max(0, targetOpenCount - selectedActionCount("OPEN")));
  }
  for (const bucket of ["FOLD_BOUNDARY", "CLEAR_FOLD"] as const) {
    takeFromPool(pools[bucket], Math.max(0, targetFoldCount - selectedActionCount("FOLD")));
  }

  if (selected.length < questionCount) {
    const remaining = shuffled(
      candidates.filter((candidate) => !selectedHands.has(candidate.hand)),
      rng,
    ).sort(
      (left, right) =>
        Math.abs(left.frequency - ACADEMY_TEACHING_OPEN_THRESHOLD) -
        Math.abs(right.frequency - ACADEMY_TEACHING_OPEN_THRESHOLD),
    );

    for (const candidate of remaining) {
      if (selected.length >= questionCount) break;
      selected.push(candidate);
      selectedHands.add(candidate.hand);
    }
  }

  const questions = shuffled(selected.slice(0, questionCount), rng).map<AcademyTrainingQuestion>(
    (candidate) => ({
      hand: candidate.hand,
      referenceFrequency: candidate.frequency,
      bucket: candidate.bucket,
      correctAction: candidate.action,
      boundaryDistance: candidate.boundaryDistance,
      educationalPriority: candidate.educationalPriority,
      cards: renderStartingHand(candidate.hand, rng),
    }),
  );

  return Object.freeze({ position, questions: Object.freeze(questions) });
}

export function evaluateTrainingAnswer(
  question: AcademyTrainingQuestion,
  selectedAction: PreflopAction,
): boolean {
  return question.correctAction === selectedAction;
}

export function scoreTrainingSession(
  correctAnswers: number,
  totalQuestions: number,
): AcademyTrainingResult {
  if (!Number.isInteger(correctAnswers) || !Number.isInteger(totalQuestions)) {
    throw new Error("Training score values must be integers");
  }
  if (totalQuestions <= 0 || correctAnswers < 0 || correctAnswers > totalQuestions) {
    throw new Error("Invalid training score");
  }

  const ratio = correctAnswers / totalQuestions;
  const passed = ratio >= ACADEMY_PASS_THRESHOLD;
  return {
    correctAnswers,
    totalQuestions,
    percentage: Math.round(ratio * 100),
    passed,
    feedback: ratio >= 0.9 ? "Отлично" : passed ? "Пройдено" : "Стоит повторить диапазон",
  };
}
