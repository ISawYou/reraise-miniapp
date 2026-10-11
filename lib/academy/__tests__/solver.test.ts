import { describe, expect, it } from "vitest";
import { getAcademySolverDataset } from "@/config/academy/solver-datasets";
import { ACADEMY_PREFLOP_POSITIONS, CANONICAL_STARTING_HANDS } from "@/lib/academy/preflop";
import {
  ACADEMY_SOLVER_BUCKET_TARGETS,
  classifySolverHandBucket,
  resolveActionFromFrequencies,
  sampleBalancedSolverHands,
} from "@/lib/academy/solver";
import type { AcademyStrategyPositionFrequencies, StartingHandClass } from "@/types/academy";

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function composition(sample: readonly { bucket: string }[]) {
  return sample.reduce<Record<string, number>>((acc, { bucket }) => {
    acc[bucket] = (acc[bucket] ?? 0) + 1;
    return acc;
  }, {});
}

const dataset = getAcademySolverDataset();

function syntheticHands(mixed: number, pureRaise: number): AcademyStrategyPositionFrequencies {
  const hands = {} as Record<StartingHandClass, { RAISE_2_25BB: number; FOLD: number }>;
  CANONICAL_STARTING_HANDS.forEach((hand, index) => {
    const raise = index < mixed ? 0.5 : index < mixed + pureRaise ? 1 : 0;
    hands[hand] = { RAISE_2_25BB: raise, FOLD: 1 - raise };
  });
  return hands;
}

describe("balanced Solver Lab sampler", () => {
  it.each(ACADEMY_PREFLOP_POSITIONS)("(9)(10) %s: 10 unique hands, 4 mixed / 3 pure-raise / 3 pure-fold", (position) => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const hands = dataset.nodes[position].hands;
      const sample = sampleBalancedSolverHands({ hands, primaryAction: "RAISE_2_25BB", random: seeded(seed) });
      expect(sample).toHaveLength(10);
      expect(new Set(sample.map((entry) => entry.hand)).size).toBe(10);
      expect(composition(sample)).toEqual({ MIXED: 4, PURE_RAISE: 3, PURE_FOLD: 3 });
      for (const entry of sample) {
        expect(classifySolverHandBucket(hands[entry.hand], "RAISE_2_25BB")).toBe(entry.bucket);
      }
    }
  });

  it("targets sum to the 10-question session", () => {
    expect(ACADEMY_SOLVER_BUCKET_TARGETS).toEqual({ MIXED: 4, PURE_RAISE: 3, PURE_FOLD: 3 });
  });

  it("(11) falls back deterministically to the bucket with the most remaining candidates", () => {
    // 2 mixed, 10 pure-raise, 157 pure-fold: after the first pass the fold pool
    // (154 left) beats the raise pool (7 left), so both missing slots go to fold.
    const hands = syntheticHands(2, 10);
    const first = sampleBalancedSolverHands({ hands, primaryAction: "RAISE_2_25BB", random: seeded(7) });
    const second = sampleBalancedSolverHands({ hands, primaryAction: "RAISE_2_25BB", random: seeded(7) });
    expect(first).toEqual(second);
    expect(first).toHaveLength(10);
    expect(new Set(first.map((entry) => entry.hand)).size).toBe(10);
    expect(composition(first)).toEqual({ MIXED: 2, PURE_RAISE: 3, PURE_FOLD: 5 });
  });

  it("(11) breaks fallback ties in the fixed order MIXED, PURE_RAISE, PURE_FOLD", () => {
    // 20 hands: 10 pure-raise, 10 pure-fold, 0 mixed. Targets ask for 4 mixed
    // only, so all 4 slots come from the fallback with equal raise/fold pools.
    const hands = {} as Record<StartingHandClass, { RAISE_2_25BB: number; FOLD: number }>;
    CANONICAL_STARTING_HANDS.slice(0, 20).forEach((hand, index) => {
      const raise = index < 10 ? 1 : 0;
      hands[hand] = { RAISE_2_25BB: raise, FOLD: 1 - raise };
    });
    const sample = sampleBalancedSolverHands({
      hands,
      primaryAction: "RAISE_2_25BB",
      random: seeded(3),
      targets: { MIXED: 4, PURE_RAISE: 0, PURE_FOLD: 0 },
    });
    // Steps alternate: tie 10/10 -> RAISE, then FOLD (10 > 9), then tie -> RAISE, ...
    expect(composition(sample)).toEqual({ PURE_RAISE: 2, PURE_FOLD: 2 });
  });

  it("throws instead of returning a short session when there are too few hands", () => {
    const hands = {} as Record<StartingHandClass, { RAISE_2_25BB: number; FOLD: number }>;
    CANONICAL_STARTING_HANDS.slice(0, 9).forEach((hand) => { hands[hand] = { RAISE_2_25BB: 1, FOLD: 0 }; });
    expect(() => sampleBalancedSolverHands({ hands, primaryAction: "RAISE_2_25BB", random: seeded(1) }))
      .toThrow(/Need 10 candidate hands/);
  });

  it("(12) is deterministic for the same random source and (13) varies across seeds", () => {
    const hands = dataset.nodes.CO.hands;
    const a = sampleBalancedSolverHands({ hands, primaryAction: "RAISE_2_25BB", random: seeded(11) });
    const b = sampleBalancedSolverHands({ hands, primaryAction: "RAISE_2_25BB", random: seeded(11) });
    const c = sampleBalancedSolverHands({ hands, primaryAction: "RAISE_2_25BB", random: seeded(12) });
    expect(a).toEqual(b);
    expect(c.map((entry) => entry.hand)).not.toEqual(a.map((entry) => entry.hand));
  });
});

describe("resolveActionFromFrequencies", () => {
  const order = ["RAISE_2_25BB", "FOLD"] as const;

  it("(14) uses [0, f) → first action, [f, 100) → next action on the percent scale", () => {
    const mixed = { RAISE_2_25BB: 0.41, FOLD: 0.59 };
    expect(resolveActionFromFrequencies(mixed, order, 0)).toBe("RAISE_2_25BB");
    expect(resolveActionFromFrequencies(mixed, order, 40)).toBe("RAISE_2_25BB");
    expect(resolveActionFromFrequencies(mixed, order, 40.999)).toBe("RAISE_2_25BB");
    expect(resolveActionFromFrequencies(mixed, order, 41)).toBe("FOLD");
    expect(resolveActionFromFrequencies(mixed, order, 99.999)).toBe("FOLD");
  });

  it("(14) snaps float drift so 2-decimal frequencies have exact integer boundaries", () => {
    // 0.57 * 100 === 56.99999999999999 in IEEE-754.
    const mixed = { RAISE_2_25BB: 0.57, FOLD: 1 - 0.57 };
    expect(resolveActionFromFrequencies(mixed, order, 56)).toBe("RAISE_2_25BB");
    expect(resolveActionFromFrequencies(mixed, order, 57)).toBe("FOLD");
    // Exactly 57 of the 100 integer randomizer values resolve to raise.
    const raises = Array.from({ length: 100 }, (_, r) => resolveActionFromFrequencies(mixed, order, r))
      .filter((action) => action === "RAISE_2_25BB").length;
    expect(raises).toBe(57);
  });

  it("(15) a 100%-raise hand always resolves RAISE", () => {
    for (let r = 0; r < 100; r += 0.5) {
      expect(resolveActionFromFrequencies({ RAISE_2_25BB: 1, FOLD: 0 }, order, r)).toBe("RAISE_2_25BB");
    }
  });

  it("(16) a 0%-raise hand always resolves FOLD", () => {
    for (let r = 0; r < 100; r += 0.5) {
      expect(resolveActionFromFrequencies({ RAISE_2_25BB: 0, FOLD: 1 }, order, r)).toBe("FOLD");
    }
  });

  it("(17) is generic over 3+ actions", () => {
    const frequencies = { RAISE: 0.2, CALL: 0.3, FOLD: 0.5 };
    const threeWay = ["RAISE", "CALL", "FOLD"];
    expect(resolveActionFromFrequencies(frequencies, threeWay, 0)).toBe("RAISE");
    expect(resolveActionFromFrequencies(frequencies, threeWay, 19.99)).toBe("RAISE");
    expect(resolveActionFromFrequencies(frequencies, threeWay, 20)).toBe("CALL");
    expect(resolveActionFromFrequencies(frequencies, threeWay, 49.99)).toBe("CALL");
    expect(resolveActionFromFrequencies(frequencies, threeWay, 50)).toBe("FOLD");
    expect(resolveActionFromFrequencies(frequencies, threeWay, 99)).toBe("FOLD");
    // Order is semantic: the same map walked in another order resolves differently.
    expect(resolveActionFromFrequencies(frequencies, ["FOLD", "CALL", "RAISE"], 0)).toBe("FOLD");
  });

  it("rejects randomizers outside [0, 100) and broken frequency maps", () => {
    const mixed = { RAISE_2_25BB: 0.41, FOLD: 0.59 };
    expect(() => resolveActionFromFrequencies(mixed, order, -1)).toThrow(RangeError);
    expect(() => resolveActionFromFrequencies(mixed, order, 100)).toThrow(RangeError);
    expect(() => resolveActionFromFrequencies(mixed, order, Number.NaN)).toThrow(RangeError);
    expect(() => resolveActionFromFrequencies({ RAISE_2_25BB: 0.3, FOLD: 0.3 }, order, 90)).toThrow(/sum/);
    expect(() => resolveActionFromFrequencies({ ...mixed, CALL: 0 }, order, 10)).toThrow(/unknown action/);
  });
});
