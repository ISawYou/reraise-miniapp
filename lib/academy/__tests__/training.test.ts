import { describe, expect, it } from "vitest";
import { ACADEMY_PREFLOP_RANGES } from "@/config/academy/preflop-ranges";
import {
  ACADEMY_PASS_THRESHOLD,
  ACADEMY_TRAINING_BUCKET_TARGETS,
  ACADEMY_TRAINING_QUESTION_COUNT,
} from "@/config/academy/training";
import { getTeachingAction, isCanonicalStartingHand } from "@/lib/academy/preflop";
import {
  classifyTrainingBucket,
  createTrainingSession,
  evaluateTrainingAnswer,
  getTrainingCandidateDiagnostic,
  renderStartingHand,
  scoreTrainingSession,
  type AcademyRandom,
} from "@/lib/academy/training";
import type {
  AcademyTrainingBucket,
  PreflopReferenceStrategy,
  StartingHandClass,
} from "@/types/academy";

function seededRng(seed: number): AcademyRandom {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function strategy(
  entries: readonly (readonly [StartingHandClass, number])[],
): PreflopReferenceStrategy {
  return Object.fromEntries(entries) as PreflopReferenceStrategy;
}

function bucketCounts(questions: readonly { bucket: AcademyTrainingBucket }[]) {
  return questions.reduce<Record<AcademyTrainingBucket, number>>(
    (counts, question) => {
      counts[question.bucket] += 1;
      return counts;
    },
    { CORE_OPEN: 0, OPEN_BOUNDARY: 0, FOLD_BOUNDARY: 0, CLEAR_FOLD: 0 },
  );
}

function actionCounts(questions: readonly { correctAction: "OPEN" | "FOLD" }[]) {
  return questions.reduce(
    (counts, question) => {
      counts[question.correctAction] += 1;
      return counts;
    },
    { OPEN: 0, FOLD: 0 },
  );
}

function expectMoreEducational(
  better: StartingHandClass,
  worse: StartingHandClass,
  referenceStrategy: PreflopReferenceStrategy,
): void {
  const betterDiagnostic = getTrainingCandidateDiagnostic(better, referenceStrategy);
  const worseDiagnostic = getTrainingCandidateDiagnostic(worse, referenceStrategy);

  expect(betterDiagnostic.educationalPriority).toBeLessThanOrEqual(
    worseDiagnostic.educationalPriority,
  );
  expect(betterDiagnostic.boundaryDistance).not.toBeNull();
  expect(worseDiagnostic.boundaryDistance).not.toBeNull();
  expect(betterDiagnostic.boundaryDistance!).toBeLessThan(worseDiagnostic.boundaryDistance!);
}

const STANDARD_ENTRIES = [
  ["AA", 1], ["KK", 0.95], ["QQ", 0.9], ["JJ", 0.85],
  ["AKs", 0.7], ["AQs", 0.6], ["AJs", 0.5], ["KQs", 0.4],
  ["AJo", 0.39], ["KQo", 0.3], ["ATs", 0.2], ["KJs", 0.1],
  ["ATo", 0.09], ["KJo", 0.05], ["QJo", 0.01],
] as const satisfies readonly (readonly [StartingHandClass, number])[];

describe("Academy curriculum sampler", () => {
  it("creates a canonical, unique 10-question session with derived answers", () => {
    const session = createTrainingSession({
      position: "UTG",
      referenceStrategy: ACADEMY_PREFLOP_RANGES.UTG.referenceStrategy,
      rng: seededRng(11),
    });

    expect(session.questions).toHaveLength(ACADEMY_TRAINING_QUESTION_COUNT);
    expect(new Set(session.questions.map((question) => question.hand))).toHaveLength(10);
    expect(session.questions.every((question) => isCanonicalStartingHand(question.hand))).toBe(true);
    expect(session.questions.every(
      (question) => question.correctAction === getTeachingAction(question.referenceFrequency),
    )).toBe(true);
  });

  it("uses the exact target composition when every bucket is large enough", () => {
    const referenceStrategy = strategy(STANDARD_ENTRIES);
    const session = createTrainingSession({
      position: "MP1",
      referenceStrategy,
      candidateHands: STANDARD_ENTRIES.map(([hand]) => hand),
      rng: seededRng(22),
    });

    expect(bucketCounts(session.questions)).toEqual(ACADEMY_TRAINING_BUCKET_TARGETS);
    expect(actionCounts(session.questions)).toEqual({ OPEN: 5, FOLD: 5 });
  });

  it.each(["UTG", "BTN"] as const)("creates a balanced real %s session", (position) => {
    const session = createTrainingSession({
      position,
      referenceStrategy: ACADEMY_PREFLOP_RANGES[position].referenceStrategy,
      rng: seededRng(position === "UTG" ? 31 : 32),
    });

    expect(session.questions).toHaveLength(10);
    expect(new Set(session.questions.map((question) => question.hand))).toHaveLength(10);
    expect(actionCounts(session.questions)).toEqual({ OPEN: 5, FOLD: 5 });
  });

  it("uses the position-specific reference strategy", () => {
    const hands = ["A2o", "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66"] as const;
    const utg = createTrainingSession({
      position: "UTG",
      referenceStrategy: ACADEMY_PREFLOP_RANGES.UTG.referenceStrategy,
      candidateHands: hands,
      rng: seededRng(40),
    });
    const btn = createTrainingSession({
      position: "BTN",
      referenceStrategy: ACADEMY_PREFLOP_RANGES.BTN.referenceStrategy,
      candidateHands: hands,
      rng: seededRng(40),
    });

    expect(utg.questions.find((question) => question.hand === "A2o")?.correctAction).toBe("FOLD");
    expect(btn.questions.find((question) => question.hand === "A2o")?.correctAction).toBe("OPEN");
  });

  it("can produce different sessions with different RNG streams", () => {
    const create = (seed: number) => createTrainingSession({
      position: "CO" as const,
      referenceStrategy: ACADEMY_PREFLOP_RANGES.CO.referenceStrategy,
      rng: seededRng(seed),
    }).questions.map((question) => question.hand);

    expect(create(51)).not.toEqual(create(52));
  });

  it("prefers the highest non-zero CLEAR_FOLD frequency over zero-frequency trash", () => {
    const entries = [
      ["AA", 1], ["KK", 1], ["AKs", 0.7], ["AQs", 0.6], ["AJs", 0.5],
      ["AJo", 0.39], ["KQo", 0.3], ["ATs", 0.2], ["KJs", 0.1],
      ["ATo", 0.09], ["KJo", 0],
    ] as const satisfies readonly (readonly [StartingHandClass, number])[];
    const session = createTrainingSession({
      position: "CO",
      referenceStrategy: strategy(entries),
      candidateHands: entries.map(([hand]) => hand),
      rng: seededRng(53),
    });

    const clearFoldQuestions = session.questions.filter(
      (question) => question.bucket === "CLEAR_FOLD",
    );
    expect(clearFoldQuestions).toHaveLength(1);
    expect(clearFoldQuestions[0].hand).toBe("ATo");
  });

  it("prefers lower pure opens over premium pairs for EASY_OPEN", () => {
    const entries = [
      ["AA", 1], ["KK", 1], ["QQ", 1], ["77", 1], ["AJs", 1], ["KQs", 1],
      ["66", 0.7], ["ATs", 0.6], ["KJs", 0.5], ["QJs", 0.4],
      ["55", 0.3], ["ATo", 0.3], ["KJo", 0.2], ["QJo", 0.1], ["54s", 0],
    ] as const satisfies readonly (readonly [StartingHandClass, number])[];
    const session = createTrainingSession({
      position: "UTG",
      referenceStrategy: strategy(entries),
      candidateHands: entries.map(([hand]) => hand),
      rng: seededRng(54),
    });
    const easyOpen = session.questions.filter((question) => question.bucket === "CORE_OPEN");

    expect(easyOpen).toHaveLength(1);
    expect(["77", "AJs", "KQs"]).toContain(easyOpen[0].hand);
    expect(["AA", "KK", "QQ"]).not.toContain(easyOpen[0].hand);
  });

  it("ranks pair boundary folds from the Teaching OPEN range", () => {
    const referenceStrategy = strategy([
      ["AA", 1], ["KK", 1], ["QQ", 1], ["JJ", 1], ["TT", 1],
      ["99", 1], ["88", 1], ["77", 1], ["66", 1], ["55", 1], ["44", 1],
    ]);

    expectMoreEducational("33", "22", referenceStrategy);
  });

  it("ranks offsuit ace boundary folds by kicker distance", () => {
    const referenceStrategy = strategy([
      ["AKo", 1], ["AQo", 1], ["AJo", 1],
    ]);

    expectMoreEducational("ATo", "A9o", referenceStrategy);
    expectMoreEducational("A9o", "A2o", referenceStrategy);
  });

  it("ranks suited king boundary folds by kicker distance", () => {
    const referenceStrategy = strategy([
      ["KQs", 1], ["KJs", 1], ["KTs", 1], ["K9s", 1],
    ]);

    expectMoreEducational("K8s", "K7s", referenceStrategy);
  });

  it("recognizes the next suited connector as a structural neighbour", () => {
    const referenceStrategy = strategy([["65s", 1]]);

    expect(getTrainingCandidateDiagnostic("54s", referenceStrategy)).toMatchObject({
      boundaryDistance: 1,
      educationalPriority: 2,
    });
  });

  it.each(["UTG", "BTN"] as const)(
    "keeps real %s sessions concentrated near the Teaching Range boundary",
    (position) => {
      for (const seed of [101, 202, 303]) {
        const session = createTrainingSession({
          position,
          referenceStrategy: ACADEMY_PREFLOP_RANGES[position].referenceStrategy,
          rng: seededRng(seed),
        });
        const folds = session.questions.filter((question) => question.correctAction === "FOLD");
        const obviousTrash = folds.filter(
          (question) => question.referenceFrequency === 0 &&
            (question.boundaryDistance === null || question.boundaryDistance > 2),
        );
        const educationalFolds = folds.filter(
          (question) => question.referenceFrequency > 0 ||
            (question.boundaryDistance !== null && question.boundaryDistance <= 2),
        );
        const obviousQuestions = session.questions.filter(
          (question) => question.educationalPriority === 4,
        );

        expect(actionCounts(session.questions)).toEqual({ OPEN: 5, FOLD: 5 });
        expect(obviousTrash.length).toBeLessThanOrEqual(1);
        expect(educationalFolds.length).toBeGreaterThanOrEqual(4);
        expect(obviousQuestions.length).toBeLessThanOrEqual(2);
      }
    },
  );
});

describe("Academy curriculum fallback", () => {
  it.each([
    {
      name: "OPEN_BOUNDARY is empty",
      entries: [
        ["AA", 1], ["KK", 1], ["QQ", 1], ["JJ", 1], ["TT", 1],
        ["AJo", 0.3], ["KQo", 0.3], ["ATs", 0.2], ["KJs", 0.1], ["ATo", 0.05],
      ],
    },
    {
      name: "FOLD_BOUNDARY is empty",
      entries: [
        ["AA", 1], ["KK", 1], ["AKs", 0.7], ["AQs", 0.6], ["AJs", 0.5],
        ["ATo", 0.09], ["KJo", 0.08], ["QJo", 0.07], ["JTo", 0.06], ["T9o", 0.05],
      ],
    },
    {
      name: "CLEAR_FOLD is empty",
      entries: [
        ["AA", 1], ["KK", 1], ["AKs", 0.7], ["AQs", 0.6], ["AJs", 0.5],
        ["AJo", 0.39], ["KQo", 0.3], ["ATs", 0.2], ["KJs", 0.15], ["QJs", 0.1],
      ],
    },
    {
      name: "both boundary buckets are empty",
      entries: [
        ["AA", 1], ["KK", 1], ["QQ", 1], ["JJ", 1], ["TT", 1],
        ["ATo", 0.05], ["KJo", 0.05], ["QJo", 0.05], ["JTo", 0.05], ["T9o", 0.05],
      ],
    },
  ] as const)("fills 10 unique questions when $name", ({ entries }) => {
    const typedEntries = entries as readonly (readonly [StartingHandClass, number])[];
    const session = createTrainingSession({
      position: "HJ",
      referenceStrategy: strategy(typedEntries),
      candidateHands: typedEntries.map(([hand]) => hand),
      rng: seededRng(61),
    });

    expect(session.questions).toHaveLength(10);
    expect(new Set(session.questions.map((question) => question.hand))).toHaveLength(10);
    expect(actionCounts(session.questions)).toEqual({ OPEN: 5, FOLD: 5 });
    expect(session.questions.every((question) => typedEntries.some(([hand]) => hand === question.hand))).toBe(true);
  });

  it("keeps as much action balance as the candidate universe permits", () => {
    const entries = [
      ["AA", 1], ["KK", 1],
      ["AJo", 0.3], ["KQo", 0.3], ["ATs", 0.2], ["KJs", 0.2],
      ["QJs", 0.1], ["ATo", 0.05], ["KJo", 0.05], ["QJo", 0.05],
    ] as const satisfies readonly (readonly [StartingHandClass, number])[];
    const session = createTrainingSession({
      position: "EP",
      referenceStrategy: strategy(entries),
      candidateHands: entries.map(([hand]) => hand),
      rng: seededRng(62),
    });

    expect(session.questions).toHaveLength(10);
    expect(actionCounts(session.questions)).toEqual({ OPEN: 2, FOLD: 8 });
  });

  it("returns every available unique hand when fewer than 10 exist", () => {
    const entries = [["AA", 1], ["AJo", 0.3], ["ATo", 0.05]] as const;
    const session = createTrainingSession({
      position: "EP",
      referenceStrategy: strategy(entries),
      candidateHands: entries.map(([hand]) => hand),
      rng: seededRng(63),
    });

    expect(session.questions).toHaveLength(3);
    expect(new Set(session.questions.map((question) => question.hand)).size).toBe(3);
  });
});

describe("Academy answer, card and score helpers", () => {
  it("classifies all curriculum boundaries", () => {
    expect(classifyTrainingBucket(0.8)).toBe("CORE_OPEN");
    expect(classifyTrainingBucket(0.4)).toBe("OPEN_BOUNDARY");
    expect(classifyTrainingBucket(0.399)).toBe("FOLD_BOUNDARY");
    expect(classifyTrainingBucket(0.1)).toBe("FOLD_BOUNDARY");
    expect(classifyTrainingBucket(0.099)).toBe("CLEAR_FOLD");
  });

  it("evaluates OPEN and FOLD answers against the question answer key", () => {
    const [openQuestion, foldQuestion] = [...createTrainingSession({
      position: "UTG",
      referenceStrategy: { AA: 1, ATo: 0 },
      candidateHands: ["AA", "ATo"],
      rng: seededRng(71),
    }).questions].sort((left, right) => right.referenceFrequency - left.referenceFrequency);

    expect(evaluateTrainingAnswer(openQuestion, "OPEN")).toBe(true);
    expect(evaluateTrainingAnswer(openQuestion, "FOLD")).toBe(false);
    expect(evaluateTrainingAnswer(foldQuestion, "FOLD")).toBe(true);
    expect(evaluateTrainingAnswer(foldQuestion, "OPEN")).toBe(false);
  });

  it("renders suited, offsuit and pair classes as valid physical cards", () => {
    const suited = renderStartingHand("AJs", () => 0);
    const offsuit = renderStartingHand("AJo", () => 0);
    const pair = renderStartingHand("88", () => 0);

    expect(suited[0].suit).toBe(suited[1].suit);
    expect(offsuit[0].suit).not.toBe(offsuit[1].suit);
    expect(pair[0].rank).toBe(pair[1].rank);
    expect(pair[0].suit).not.toBe(pair[1].suit);
  });

  it.each([
    [10, true, "Отлично"],
    [9, true, "Отлично"],
    [8, true, "Пройдено"],
    [7, false, "Стоит повторить диапазон"],
    [0, false, "Стоит повторить диапазон"],
  ] as const)("scores %i/10", (correct, passed, feedback) => {
    const result = scoreTrainingSession(correct, 10);
    expect(ACADEMY_PASS_THRESHOLD).toBe(0.8);
    expect(result.passed).toBe(passed);
    expect(result.feedback).toBe(feedback);
  });
});
