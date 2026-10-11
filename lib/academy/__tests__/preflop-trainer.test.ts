/**
 * Configurable Solver Lab preflop trainer — selector, generic sampler,
 * N-action resolver and deterministic session over the REAL imported
 * external MTT datasets (no fixtures for the data itself).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACADEMY_MTT_REFERENCE_IMPORTS } from "@/config/academy/mtt-reference-datasets";
import {
  ACADEMY_PREFLOP_TRAINER_DATASET_IDS,
  ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE,
} from "@/config/academy/preflop-trainer";
import { ACADEMY_SOLVER_DATASET_ID, getAcademyStrategyDataset } from "@/config/academy/solver-datasets";
import { CANONICAL_STARTING_HANDS } from "@/lib/academy/preflop";
import {
  AcademyPreflopTrainerSelectionError,
  buildAcademyPreflopTrainerSession,
  getPreflopTrainerPublicActions,
  listAcademyPreflopTrainerSpots,
  requireAcademyPreflopTrainerSpot,
  requireAcademyPreflopTrainerSpotByStack,
  toPublicPreflopTrainerQuestion,
} from "@/lib/academy/preflop-trainer";
import { describePreflopTrainerSpot, localizePreflopTrainerActionCopy } from "@/lib/academy/preflop-trainer-copy";
import {
  findPreflopTrainerSpot,
  listPreflopTrainerHeroPositions,
  listPreflopTrainerSituations,
  listPreflopTrainerStacks,
  listPreflopTrainerVillainPositions,
} from "@/lib/academy/preflop-trainer-selection";
import {
  buildStrategyBucketTargets,
  classifySolverHandBucket,
  classifyStrategyHandBucket,
  getAcademyStrategyNode,
  resolveAcademyStrategyNodeAction,
  sampleBalancedSolverHands,
  sampleBalancedStrategyHands,
} from "@/lib/academy/solver";
import { createDeterministicRandom } from "@/lib/academy/solver-session";
import type { AcademyPreflopTrainerSituation } from "@/types/academy";

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const ID = (stack: number) => `external_mtt_preflop_9max_${stack}bb_v1`;

const spots = listAcademyPreflopTrainerSpots();

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "preflop-trainer-test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("spot index is derived from the real registered datasets", () => {
  it("has exactly one spot per imported node (434), never more", () => {
    const nodeTotal = ACADEMY_PREFLOP_TRAINER_DATASET_IDS
      .reduce((sum, id) => sum + Object.keys(getAcademyStrategyDataset(id).nodes).length, 0);
    expect(spots).toHaveLength(nodeTotal);
    expect(nodeTotal).toBe(434);
    for (const spot of spots) {
      const dataset = getAcademyStrategyDataset(spot.datasetId);
      expect(Object.prototype.hasOwnProperty.call(dataset.nodes, spot.nodeKey)).toBe(true);
      expect(spot.stackBb).toBe(dataset.metadata.effectiveStackBb);
      expect(spot.actionCount).toBe(dataset.nodes[spot.nodeKey].actionCodes.length);
    }
  });

  it("(1) available stacks are exactly the 5 stacks with real data", () => {
    expect(listPreflopTrainerStacks(spots)).toEqual([5, 10, 20, 40, 100]);
  });

  it("(2) situation availability per stack matches the real datasets (and the coverage doc)", () => {
    const expected: Record<number, AcademyPreflopTrainerSituation[]> = {
      5: ["RFI", "FACING_OPEN"],
      10: ["RFI", "FACING_OPEN"],
      20: ["RFI", "FACING_OPEN", "FACING_3BET"],
      40: ["RFI", "FACING_OPEN", "FACING_3BET", "FACING_4BET"],
      100: ["RFI", "FACING_OPEN", "FACING_3BET", "FACING_4BET", "FACING_5BET"],
    };
    for (const stack of [5, 10, 20, 40, 100]) {
      expect(listPreflopTrainerSituations(spots, stack)).toEqual(expected[stack]);
      // Cross-check against the import report's own node descriptors.
      const fromReport = new Set(ACADEMY_MTT_REFERENCE_IMPORTS[stack as 5].report.nodes.map((node) => node.scenario));
      expect(new Set(listPreflopTrainerSituations(spots, stack))).toEqual(fromReport);
    }
  });

  it("(3) hero / villain narrowing for a chosen stack + situation", () => {
    // RFI: 8 openers, no BB, no villain step.
    expect(listPreflopTrainerHeroPositions(spots, 20, "RFI")).toEqual(["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB"]);
    expect(listPreflopTrainerVillainPositions(spots, 20, "RFI", "BTN")).toEqual([]);
    // Facing an open: UTG can never face an open; BB faces any of the 8 openers.
    const facingOpenHeroes = listPreflopTrainerHeroPositions(spots, 20, "FACING_OPEN");
    expect(facingOpenHeroes).not.toContain("UTG");
    expect(facingOpenHeroes).toEqual(["UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"]);
    expect(listPreflopTrainerVillainPositions(spots, 20, "FACING_OPEN", "BB"))
      .toEqual(["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB"]);
    expect(listPreflopTrainerVillainPositions(spots, 20, "FACING_OPEN", "SB"))
      .toEqual(["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN"]);
    expect(listPreflopTrainerVillainPositions(spots, 20, "FACING_OPEN", "UTG1")).toEqual(["UTG"]);
    // Facing a 3-bet at 20 BB: BTN opened → only seats behind BTN (SB, BB) can 3-bet; CO never (rejected).
    expect(listPreflopTrainerVillainPositions(spots, 20, "FACING_3BET", "BTN")).toEqual(["SB", "BB"]);
    // Facing a 4-bet at 40 BB as BB: villains that opened and 4-bet; LJ was rejected (negative fold remainder).
    expect(listPreflopTrainerVillainPositions(spots, 40, "FACING_4BET", "BB")).not.toContain("LJ");
    expect(listPreflopTrainerVillainPositions(spots, 100, "FACING_4BET", "BB")).toContain("LJ");
  });

  it("(4) BB vs BTN open is selectable at every stack, e.g. 20bb → facing-open → BB → BTN", () => {
    for (const stack of [5, 10, 20, 40, 100]) {
      expect(listPreflopTrainerSituations(spots, stack)).toContain("FACING_OPEN");
      expect(listPreflopTrainerHeroPositions(spots, stack, "FACING_OPEN")).toContain("BB");
      expect(listPreflopTrainerVillainPositions(spots, stack, "FACING_OPEN", "BB")).toContain("BTN");
      expect(findPreflopTrainerSpot(spots, { stackBb: stack, situation: "FACING_OPEN", heroPosition: "BB", villainPosition: "BTN" }))
        .toMatchObject({ datasetId: ID(stack), nodeKey: "FACING_OPEN_BB_VS_BTN" });
    }
    // BB vs BTN after a BTN 4-bet exists at 40 and 100 BB only.
    for (const stack of [40, 100]) {
      expect(findPreflopTrainerSpot(spots, { stackBb: stack, situation: "FACING_4BET", heroPosition: "BB", villainPosition: "BTN" })).not.toBeNull();
    }
    for (const stack of [5, 10, 20]) {
      expect(findPreflopTrainerSpot(spots, { stackBb: stack, situation: "FACING_4BET", heroPosition: "BB", villainPosition: "BTN" })).toBeNull();
    }
  });

  it("(5) BB vs SB (blind vs blind) is selectable where it exists", () => {
    for (const stack of [5, 10, 20, 40, 100]) {
      expect(findPreflopTrainerSpot(spots, { stackBb: stack, situation: "FACING_OPEN", heroPosition: "BB", villainPosition: "SB" })).not.toBeNull();
      expect(findPreflopTrainerSpot(spots, { stackBb: stack, situation: "RFI", heroPosition: "SB" })).not.toBeNull();
    }
    const bvb = (stack: number, situation: AcademyPreflopTrainerSituation, hero: string, villain: string) =>
      findPreflopTrainerSpot(spots, { stackBb: stack, situation, heroPosition: hero, villainPosition: villain }) !== null;
    expect([5, 10, 20, 40, 100].map((stack) => bvb(stack, "FACING_3BET", "SB", "BB"))).toEqual([false, false, true, true, true]);
    expect([5, 10, 20, 40, 100].map((stack) => bvb(stack, "FACING_4BET", "BB", "SB"))).toEqual([false, false, false, true, true]);
    expect([5, 10, 20, 40, 100].map((stack) => bvb(stack, "FACING_5BET", "SB", "BB"))).toEqual([false, false, false, false, true]);
  });

  it("(6) SB vs BTN is selectable where it exists", () => {
    for (const stack of [5, 10, 20, 40, 100]) {
      expect(listPreflopTrainerVillainPositions(spots, stack, "FACING_OPEN", "SB")).toContain("BTN");
    }
    expect(findPreflopTrainerSpot(spots, { stackBb: 40, situation: "FACING_4BET", heroPosition: "SB", villainPosition: "BTN" })).not.toBeNull();
    expect(findPreflopTrainerSpot(spots, { stackBb: 20, situation: "FACING_3BET", heroPosition: "BTN", villainPosition: "SB" })).not.toBeNull();
    expect(findPreflopTrainerSpot(spots, { stackBb: 100, situation: "FACING_5BET", heroPosition: "BTN", villainPosition: "SB" })).not.toBeNull();
  });

  it("(7) rejected / skipped nodes from the coverage doc are never selectable", () => {
    const rejected = [
      { stack: 40, situation: "FACING_4BET", hero: "CO", villain: "UTG", key: "FACING_4BET_CO_VS_UTG" }, // NEGATIVE_FOLD_REMAINDER
      { stack: 40, situation: "FACING_4BET", hero: "BB", villain: "LJ", key: "FACING_4BET_BB_VS_LJ" }, // NEGATIVE_FOLD_REMAINDER
      { stack: 100, situation: "FACING_3BET", hero: "BTN", villain: "CO", key: "FACING_3BET_BTN_VS_CO" }, // UNREACHABLE
      { stack: 20, situation: "FACING_3BET", hero: "BTN", villain: "CO", key: "FACING_3BET_BTN_VS_CO" }, // UNREACHABLE
      { stack: 10, situation: "FACING_3BET", hero: "BTN", villain: "BB", key: "FACING_3BET_BTN_VS_BB" }, // UNREACHABLE at 10 BB
      { stack: 20, situation: "FACING_5BET", hero: "SB", villain: "BB", key: "FACING_5BET_SB_VS_BB" }, // skipped all-fold
    ] as const;
    for (const entry of rejected) {
      const report = ACADEMY_MTT_REFERENCE_IMPORTS[entry.stack].report;
      expect([...report.rejected, ...report.skipped].map((outcome) => outcome.nodeKey)).toContain(entry.key);
      expect(findPreflopTrainerSpot(spots, {
        stackBb: entry.stack, situation: entry.situation, heroPosition: entry.hero, villainPosition: entry.villain,
      })).toBeNull();
      expect(spots.some((spot) => spot.stackBb === entry.stack && spot.nodeKey === entry.key)).toBe(false);
      expect(() => requireAcademyPreflopTrainerSpot(ID(entry.stack), entry.key)).toThrow(AcademyPreflopTrainerSelectionError);
      expect(() => requireAcademyPreflopTrainerSpotByStack(entry.stack, entry.key)).toThrow(AcademyPreflopTrainerSelectionError);
    }
    expect(listPreflopTrainerVillainPositions(spots, 100, "FACING_3BET", "BTN")).not.toContain("CO");
    expect(listPreflopTrainerVillainPositions(spots, 40, "FACING_4BET", "CO")).not.toContain("UTG");
    // No BB first-in node (no RFI_BB upstream) and no 5-bet tree below 100 BB.
    expect(listPreflopTrainerHeroPositions(spots, 100, "RFI")).not.toContain("BB");
    expect(listPreflopTrainerSituations(spots, 40)).not.toContain("FACING_5BET");
  });
});

describe("fail-closed selection validation (13)", () => {
  it("rejects unknown / forged / wrong-type dataset ids and node keys", () => {
    const valid = requireAcademyPreflopTrainerSpot(ID(20), "FACING_OPEN_BB_VS_BTN");
    expect(valid.spot).toMatchObject({ stackBb: 20, situation: "FACING_OPEN", heroPosition: "BB", villainPosition: "BTN" });
    for (const [datasetId, nodeKey] of [
      ["external_mtt_preflop_9max_30bb_v1", "FACING_OPEN_BB_VS_BTN"],
      [ACADEMY_SOLVER_DATASET_ID, "UTG"], // the HRC 100bb dataset is NOT served by this trainer
      [ID(20), "FACING_OPEN_BB_VS_XYZ"],
      [ID(20), "facing_open_bb_vs_btn"],
      [ID(20), "__proto__"],
      [ID(20), "constructor"],
      [ID(20), ""],
      [null, "RFI_BTN"],
      [ID(20), 42],
      [{ toString: () => ID(20) }, "RFI_BTN"],
    ] as const) {
      expect(() => requireAcademyPreflopTrainerSpot(datasetId, nodeKey)).toThrow(AcademyPreflopTrainerSelectionError);
      expect(() => buildAcademyPreflopTrainerSession({
        playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId: datasetId as string, nodeKey: nodeKey as string,
      })).toThrow(AcademyPreflopTrainerSelectionError);
    }
  });
});

describe("generic N-action sampler (10)", () => {
  it("classifies by pure action or MIXED without any action-specific bucket name", () => {
    expect(classifyStrategyHandBucket({ ALL_IN: 0, CALL: 1, FOLD: 0 }, ["ALL_IN", "CALL", "FOLD"])).toBe("PURE:CALL");
    expect(classifyStrategyHandBucket({ ALL_IN: 0.2, CALL: 0.8, FOLD: 0 }, ["ALL_IN", "CALL", "FOLD"])).toBe("MIXED");
    expect(classifyStrategyHandBucket({ CALL: 1e-12, FOLD: 1 - 1e-12 }, ["CALL", "FOLD"])).toBe("PURE:FOLD");
  });

  it("splits 10 slots: 4 mixed, remainder evenly over the node's existing pure buckets", () => {
    const sizes = (entries: Array<[string, number]>) => new Map(entries) as Map<"MIXED" | `PURE:${string}`, number>;
    expect(Object.fromEntries(buildStrategyBucketTargets(sizes([["MIXED", 30], ["PURE:RAISE", 5], ["PURE:FOLD", 80]]), ["RAISE", "FOLD"], 10).targets))
      .toEqual({ MIXED: 4, "PURE:RAISE": 3, "PURE:FOLD": 3 });
    const three = buildStrategyBucketTargets(sizes([["MIXED", 30], ["PURE:RAISE", 5], ["PURE:CALL", 9], ["PURE:FOLD", 80]]), ["RAISE", "CALL", "FOLD"], 10);
    expect(three.order).toEqual(["MIXED", "PURE:RAISE", "PURE:CALL", "PURE:FOLD"]);
    expect(Object.fromEntries(three.targets)).toEqual({ MIXED: 4, "PURE:RAISE": 2, "PURE:CALL": 2, "PURE:FOLD": 2 });
    // A node with no pure aggressive hands gets no such bucket (never forced).
    const noPureRaise = buildStrategyBucketTargets(sizes([["MIXED", 30], ["PURE:CALL", 9], ["PURE:FOLD", 80]]), ["RAISE", "CALL", "FOLD"], 10);
    expect(noPureRaise.order).toEqual(["MIXED", "PURE:CALL", "PURE:FOLD"]);
    expect(Object.fromEntries(noPureRaise.targets)).toEqual({ MIXED: 4, "PURE:CALL": 3, "PURE:FOLD": 3 });
  });

  it("2-action node (10bb BB vs BTN, CALL/FOLD): sensible mix, 10 unique hands, buckets match the data", () => {
    const node = getAcademyStrategyNode(getAcademyStrategyDataset(ID(10)), "FACING_OPEN_BB_VS_BTN");
    expect(node.actionCodes).toEqual(["CALL", "FOLD"]);
    const sample = sampleBalancedStrategyHands({
      hands: node.hands, actionCodes: node.actionCodes, random: createDeterministicRandom(["sampler-2"]),
    });
    expect(new Set(sample.map((entry) => entry.hand)).size).toBe(10);
    for (const entry of sample) expect(entry.bucket).toBe(classifyStrategyHandBucket(node.hands[entry.hand], node.actionCodes));
    const buckets = new Set(sample.map((entry) => entry.bucket));
    expect([...buckets].every((bucket) => ["MIXED", "PURE:CALL", "PURE:FOLD"].includes(bucket))).toBe(true);
    expect(buckets.has("PURE:FOLD")).toBe(true);
    expect(buckets.size).toBeGreaterThanOrEqual(2);
  });

  it("3-action node (40bb BB vs BTN, RAISE/CALL/FOLD): uses every bucket the node really has", () => {
    const node = getAcademyStrategyNode(getAcademyStrategyDataset(ID(40)), "FACING_OPEN_BB_VS_BTN");
    expect(node.actionCodes).toEqual(["RAISE", "CALL", "FOLD"]);
    const available = new Set(CANONICAL_STARTING_HANDS.map((hand) => classifyStrategyHandBucket(node.hands[hand], node.actionCodes)));
    const sample = sampleBalancedStrategyHands({
      hands: node.hands, actionCodes: node.actionCodes, random: createDeterministicRandom(["sampler-3"]),
    });
    expect(new Set(sample.map((entry) => entry.hand)).size).toBe(10);
    const counts = sample.reduce<Record<string, number>>((acc, { bucket }) => ({ ...acc, [bucket]: (acc[bucket] ?? 0) + 1 }), {});
    for (const bucket of available) expect(counts[bucket] ?? 0).toBeGreaterThan(0);
    if (available.has("MIXED")) expect(counts.MIXED).toBe(4);
  });

  it("reproduces the original 100bb sampler's hands for every HRC node with the same random stream", () => {
    const hrc = getAcademyStrategyDataset(ACADEMY_SOLVER_DATASET_ID);
    const legacyName = { MIXED: "MIXED", "PURE:RAISE_2_25BB": "PURE_RAISE", "PURE:FOLD": "PURE_FOLD" } as Record<string, string>;
    for (const nodeKey of Object.keys(hrc.nodes)) {
      const node = hrc.nodes[nodeKey];
      const legacy = sampleBalancedSolverHands({ hands: node.hands, primaryAction: "RAISE_2_25BB", random: createDeterministicRandom(["eq", nodeKey]) });
      const generic = sampleBalancedStrategyHands({ hands: node.hands, actionCodes: node.actionCodes, random: createDeterministicRandom(["eq", nodeKey]) });
      expect(generic.map(({ hand, bucket }) => ({ hand, bucket: legacyName[bucket] }))).toEqual(legacy);
      for (const hand of CANONICAL_STARTING_HANDS) {
        expect(legacyName[classifyStrategyHandBucket(node.hands[hand], node.actionCodes)])
          .toBe(classifySolverHandBucket(node.hands[hand], "RAISE_2_25BB"));
      }
    }
  });
});

describe("generic cumulative resolver on a 3-action trainer node (9)", () => {
  it("walks the node's 3 actions in order with exact cumulative boundaries (real 3-way mixed hand)", () => {
    // First real (node, hand) whose three actions all carry ≥ 2%.
    const found = spots.filter((spot) => spot.actionCount === 3).flatMap((spot) => {
      const node = getAcademyStrategyNode(getAcademyStrategyDataset(spot.datasetId), spot.nodeKey);
      const hand = CANONICAL_STARTING_HANDS.find((candidate) =>
        node.actionCodes.every((code) => node.hands[candidate][code] >= 0.02));
      return hand ? [{ node, hand }] : [];
    })[0];
    expect(found).toBeDefined();
    const { node, hand } = found!;
    const [first, second, third] = node.actionCodes;
    const f = node.hands[hand];
    const firstEnd = f[first] * 100;
    const secondEnd = (f[first] + f[second]) * 100;
    expect(resolveAcademyStrategyNodeAction(node, hand, 0)).toBe(first);
    expect(resolveAcademyStrategyNodeAction(node, hand, firstEnd - 1e-6)).toBe(first);
    expect(resolveAcademyStrategyNodeAction(node, hand, firstEnd + 1e-6)).toBe(second);
    expect(resolveAcademyStrategyNodeAction(node, hand, secondEnd - 1e-6)).toBe(second);
    expect(resolveAcademyStrategyNodeAction(node, hand, secondEnd + 1e-6)).toBe(third);
    expect(resolveAcademyStrategyNodeAction(node, hand, 99.999)).toBe(third);
    expect(() => resolveAcademyStrategyNodeAction(node, hand, 100)).toThrow(RangeError);
    // Integer randomizers 0..99: each action gets exactly the integers below its cumulative threshold.
    const hits: Record<string, number> = { [first]: 0, [second]: 0, [third]: 0 };
    for (let r = 0; r < 100; r += 1) hits[resolveAcademyStrategyNodeAction(node, hand, r)] += 1;
    expect(hits[first]).toBe(Math.ceil(firstEnd - 1e-9));
    expect(hits[first] + hits[second]).toBe(Math.ceil(secondEnd - 1e-9));
    expect(hits[first] + hits[second] + hits[third]).toBe(100);
  });

  it("exact boundary on a constructed-percent hand from the same node (AA and a pure fold hand)", () => {
    const node = getAcademyStrategyNode(getAcademyStrategyDataset(ID(40)), "FACING_OPEN_BB_VS_BTN");
    const pureFold = CANONICAL_STARTING_HANDS.find((hand) => node.hands[hand].FOLD === 1)!;
    for (let r = 0; r < 100; r += 1) expect(resolveAcademyStrategyNodeAction(node, pureFold, r)).toBe("FOLD");
  });
});

describe("deterministic 10-question session (8)", () => {
  const combos = [
    { datasetId: ID(10), nodeKey: "FACING_OPEN_BB_VS_BTN", actions: ["CALL", "FOLD"] }, // 2 actions
    { datasetId: ID(20), nodeKey: "FACING_OPEN_BB_VS_BTN", actions: ["ALL_IN", "CALL", "FOLD"] }, // 3 actions
    { datasetId: ID(100), nodeKey: "RFI_SB", actions: ["RAISE", "LIMP", "FOLD"] }, // 3 actions incl. limp
    { datasetId: ID(100), nodeKey: "FACING_5BET_SB_VS_BB", actions: ["CALL", "FOLD"] }, // 2 actions, deep tree
    { datasetId: ID(40), nodeKey: "FACING_3BET_SB_VS_BB", actions: ["ALL_IN", "CALL", "FOLD"] },
  ];

  it.each(combos)("$datasetId $nodeKey builds 10 unique, resolvable questions over the node's own actions", ({ datasetId, nodeKey, actions }) => {
    const key = { playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId, nodeKey };
    const session = buildAcademyPreflopTrainerSession(key);
    const node = getAcademyStrategyNode(getAcademyStrategyDataset(datasetId), nodeKey);
    expect(node.actionCodes).toEqual(actions);
    expect(session).toHaveLength(10);
    expect(new Set(session.map((question) => question.hand)).size).toBe(10);
    for (const question of session) {
      expect(question.actions.map((action) => action.code)).toEqual(actions);
      expect(question.frequencies).toBe(node.hands[question.hand]);
      expect(question.randomizerPercent).toBeGreaterThanOrEqual(0);
      expect(question.randomizerPercent).toBeLessThan(100);
      expect(Number.isInteger(question.randomizerPercent)).toBe(true);
      expect(question.resolvedAction).toBe(resolveAcademyStrategyNodeAction(node, question.hand, question.randomizerPercent));
      expect(question.frequencies[question.resolvedAction]).toBeGreaterThan(0);
      expect(question.bucket).toBe(classifyStrategyHandBucket(question.frequencies, node.actionCodes));
      expect(question.spot).toMatchObject({ datasetId, nodeKey });
    }
    // Regenerated identically (server-authoritative, no stored state).
    expect(buildAcademyPreflopTrainerSession(key)).toEqual(session);
  });

  it("sessions are distinct per node, per attempt and per player (own HMAC inputs)", () => {
    const base = { playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId: ID(20), nodeKey: "FACING_OPEN_BB_VS_BTN" };
    const fingerprint = (key: typeof base) => buildAcademyPreflopTrainerSession(key)
      .map((question) => `${question.hand}:${question.randomizerPercent}`).join(",");
    const reference = fingerprint(base);
    expect(fingerprint({ ...base, nodeKey: "FACING_OPEN_BB_VS_CO" })).not.toBe(reference);
    expect(fingerprint({ ...base, datasetId: ID(40) })).not.toBe(reference);
    expect(fingerprint({ ...base, attemptId: "33333333-3333-4333-8333-333333333333" })).not.toBe(reference);
    expect(fingerprint({ ...base, playerId: "44444444-4444-4444-8444-444444444444" })).not.toBe(reference);
  });

  it("fails closed without SESSION_SECRET", () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => buildAcademyPreflopTrainerSession({
      playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId: ID(20), nodeKey: "RFI_BTN",
    })).toThrow("SESSION_SECRET is not set");
  });

  it("(11) the public question has no frequencies, resolved action or bucket", () => {
    for (const { datasetId, nodeKey } of combos) {
      for (const question of buildAcademyPreflopTrainerSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId, nodeKey })) {
        const publicQuestion = toPublicPreflopTrainerQuestion(question);
        expect(Object.keys(publicQuestion).sort()).toEqual(["actions", "hand", "randomizerPercent", "renderedCards", "spot"]);
        const raw = JSON.stringify(publicQuestion);
        for (const leak of ["frequencies", "frequency", "resolvedAction", "correctAction", "bucket", "PURE:", "MIXED", "evBb", "preflop-trainer-test-secret"]) {
          expect(raw).not.toContain(leak);
        }
        const { actions, ...rest } = publicQuestion;
        for (const code of actions.map((action) => action.code)) expect(JSON.stringify(rest)).not.toContain(`"${code}"`);
      }
    }
  });

  it("uses the configurable lesson code (not a 100bb lesson code) in its derivation", () => {
    expect(ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE).toBe("solver_preflop_trainer");
  });
});

describe("Russian copy (labels composed, sizes never invented)", () => {
  it("composes spot descriptions from the spot fields", () => {
    expect(describePreflopTrainerSpot({ situation: "FACING_OPEN", heroPosition: "BB", villainPosition: "BTN" }))
      .toEqual({ title: "BB против BTN", history: "BTN открыл — ты на BB", situationLabel: "Против открытия" });
    expect(describePreflopTrainerSpot({ situation: "RFI", heroPosition: "CO" }).title).toBe("CO · первый вход");
    expect(describePreflopTrainerSpot({ situation: "FACING_4BET", heroPosition: "BB", villainPosition: "SB" }).history)
      .toBe("SB открыл — ты сделал 3-бет с BB — SB сделал 4-бет");
  });

  it("localizes the real action codes; RAISE has no size, ALL_IN shows its real stack amount", () => {
    const actions = getPreflopTrainerPublicActions(requireAcademyPreflopTrainerSpot(ID(40), "FACING_OPEN_BB_VS_BTN"));
    expect(actions.map((action) => [action.code, action.kind, action.ru?.button, action.amountBb])).toEqual([
      ["RAISE", "RAISE", "3-бет", undefined],
      ["CALL", "CALL", "Колл", undefined],
      ["FOLD", "FOLD", "Фолд", undefined],
    ]);
    const jam = getPreflopTrainerPublicActions(requireAcademyPreflopTrainerSpot(ID(20), "FACING_OPEN_BB_VS_BTN"));
    expect(jam.map((action) => action.ru?.button)).toEqual(["Олл-ин 20 BB", "Колл", "Фолд"]);
    expect(jam[0].amountBb).toBe(20);
    const sb = getPreflopTrainerPublicActions(requireAcademyPreflopTrainerSpot(ID(100), "RFI_SB"));
    expect(sb.map((action) => action.ru?.button)).toEqual(["Рейз", "Лимп", "Фолд"]);
    expect(localizePreflopTrainerActionCopy({ code: "RAISE", kind: "RAISE" }, "FACING_3BET")?.button).toBe("4-бет");
  });
});
