import { describe, expect, it } from "vitest";
import { ACADEMY_PREFLOP_RANGES } from "@/config/academy/preflop-ranges";
import {
  ACADEMY_PREFLOP_POSITIONS,
  ACADEMY_TEACHING_OPEN_THRESHOLD,
  buildPreflopMatrix,
  calculateTeachingRangeStats,
  calculateWeightedRangePercentage,
  CANONICAL_STARTING_HANDS,
  getStartingHandCombinationCount,
  getTeachingAction,
  isCanonicalStartingHand,
  normalizeReferenceStrategy,
} from "@/lib/academy/preflop";

describe("Academy preflop dataset", () => {
  it("contains exactly the seven sourced 9-max positions", () => {
    expect(Object.keys(ACADEMY_PREFLOP_RANGES)).toEqual(ACADEMY_PREFLOP_POSITIONS);
  });

  it.each(ACADEMY_PREFLOP_POSITIONS)("normalizes %s to all 169 hand classes", (position) => {
    const range = ACADEMY_PREFLOP_RANGES[position];
    const normalized = normalizeReferenceStrategy(range.referenceStrategy);

    expect(Object.keys(normalized)).toHaveLength(169);
    expect(new Set(Object.keys(normalized))).toHaveLength(169);
    expect(Object.keys(normalized).every(isCanonicalStartingHand)).toBe(true);
    expect(Object.values(normalized).every((frequency) => frequency >= 0 && frequency <= 1)).toBe(true);
  });

  it.each(ACADEMY_PREFLOP_POSITIONS)("matches HRC's reported weighted range for %s", (position) => {
    const range = ACADEMY_PREFLOP_RANGES[position];
    expect(calculateWeightedRangePercentage(range.referenceStrategy)).toBeCloseTo(
      range.source.reportedWeightedRangePercentage,
      1,
    );
  });

  it("preserves mixed HRC frequencies instead of flattening the reference strategy", () => {
    expect(ACADEMY_PREFLOP_RANGES.UTG.referenceStrategy["44"]).toBe(0.61);
    expect(ACADEMY_PREFLOP_RANGES.UTG.referenceStrategy["AJo"]).toBe(0.41);
    expect(ACADEMY_PREFLOP_RANGES.UTG.referenceStrategy["KQo"]).toBe(0.87);
    expect(ACADEMY_PREFLOP_RANGES.UTG.referenceStrategy["T8s"]).toBe(0.32);
    expect(ACADEMY_PREFLOP_RANGES.UTG.referenceStrategy["65s"]).toBe(0.7);
    expect(ACADEMY_PREFLOP_RANGES.UTG.referenceStrategy["54s"]).toBe(0.26);
  });
});

describe("Academy teaching strategy", () => {
  it.each([
    ["UTG", 198],
    ["EP", 206],
    ["MP1", 252],
    ["MP2", 318],
    ["HJ", 362],
    ["CO", 474],
    ["BTN", 734],
  ] as const)("derives the stable teaching range for %s", (position, expectedComboCount) => {
    const stats = calculateTeachingRangeStats(ACADEMY_PREFLOP_RANGES[position].referenceStrategy);
    expect(stats.teachingOpenComboCount).toBe(expectedComboCount);
  });

  it("uses the named 40% threshold at the boundary", () => {
    expect(ACADEMY_TEACHING_OPEN_THRESHOLD).toBe(0.4);
    expect(getTeachingAction(0.399999)).toBe("FOLD");
    expect(getTeachingAction(0.4)).toBe("OPEN");
    expect(getTeachingAction(1)).toBe("OPEN");
    expect(getTeachingAction(0)).toBe("FOLD");
  });

  it("computes teaching percentages from physical combinations", () => {
    for (const position of ACADEMY_PREFLOP_POSITIONS) {
      const stats = calculateTeachingRangeStats(ACADEMY_PREFLOP_RANGES[position].referenceStrategy);
      expect(stats.teachingOpenComboCount).toBeGreaterThan(0);
      expect(stats.teachingOpenComboCount).toBeLessThanOrEqual(1326);
      expect(stats.teachingOpenPercentage).toBeCloseTo(
        (stats.teachingOpenComboCount / 1326) * 100,
        10,
      );
    }
  });
});

describe("canonical hand helpers", () => {
  it("builds a unique 13x13 standard matrix", () => {
    expect(CANONICAL_STARTING_HANDS).toHaveLength(169);
    expect(new Set(CANONICAL_STARTING_HANDS)).toHaveLength(169);

    const matrix = buildPreflopMatrix(ACADEMY_PREFLOP_RANGES.UTG.referenceStrategy);
    expect(matrix).toHaveLength(13);
    expect(matrix.every((row) => row.length === 13)).toBe(true);
    expect(matrix.flat().map((cell) => cell.hand)).toEqual(CANONICAL_STARTING_HANDS);
    expect(matrix[0][0].hand).toBe("AA");
    expect(matrix[0][1].hand).toBe("AKs");
    expect(matrix[1][0].hand).toBe("AKo");
  });

  it("rejects reversed and otherwise ambiguous hand classes", () => {
    expect(isCanonicalStartingHand("AKs")).toBe(true);
    expect(isCanonicalStartingHand("KAo")).toBe(false);
    expect(isCanonicalStartingHand("AAs")).toBe(false);
    expect(isCanonicalStartingHand("AK")).toBe(false);
  });

  it("returns physical combination counts", () => {
    expect(getStartingHandCombinationCount("AA")).toBe(6);
    expect(getStartingHandCombinationCount("AKs")).toBe(4);
    expect(getStartingHandCombinationCount("AKo")).toBe(12);
  });
});
