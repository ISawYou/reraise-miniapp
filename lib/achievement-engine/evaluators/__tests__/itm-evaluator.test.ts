import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENT_METRIC,
  ACHIEVEMENTS_CATALOG,
  type AchievementDefinition,
} from "@/config/achievements";
import { ITMEvaluator } from "../itm-evaluator";
import type { PlayerAchievementMetrics } from "../../types";

// Tested against the actual, approved catalog entries (not hand-built
// fixtures) so a threshold/code change in config/achievements.ts would
// break these tests instead of silently drifting from what's really
// deployed. Returns the general AchievementDefinition shape (not the
// narrower literal union) so `.target` -- absent on manual/Legendary
// entries -- is at least `number | undefined` for every caller here.
function findDefinition(code: string): AchievementDefinition {
  const definition = ACHIEVEMENTS_CATALOG.find((entry) => entry.code === code);
  if (!definition) {
    throw new Error(`Fixture error: "${code}" not found in ACHIEVEMENTS_CATALOG`);
  }
  return definition;
}

const firstItm = findDefinition("first_itm"); // target 1
const tenItm = findDefinition("ten_itm"); // target 10
const twentyFiveItm = findDefinition("twenty_five_itm"); // target 25
const hundredItm = findDefinition("hundred_itm"); // target 100

function metricsWith(itmFinishes: number | undefined): PlayerAchievementMetrics {
  return itmFinishes === undefined ? {} : { [ACHIEVEMENT_METRIC.ITM_FINISHES]: itmFinishes };
}

describe("ITMEvaluator.supports", () => {
  it("supports all four automatic itm_finishes achievements from the catalog", () => {
    expect(ITMEvaluator.supports(firstItm)).toBe(true);
    expect(ITMEvaluator.supports(tenItm)).toBe(true);
    expect(ITMEvaluator.supports(twentyFiveItm)).toBe(true);
    expect(ITMEvaluator.supports(hundredItm)).toBe(true);
  });

  it("does not support an automatic achievement on a different metric", () => {
    const firstTournament = findDefinition("first_tournament");
    expect(ITMEvaluator.supports(firstTournament)).toBe(false);
  });

  it("does not support a manual (Legendary) achievement", () => {
    const royalFlush = findDefinition("royal_flush");
    expect(ITMEvaluator.supports(royalFlush)).toBe(false);
  });
});

describe("ITMEvaluator.evaluate", () => {
  it("itm_finishes = 0 -> currentValue 0, not completed", () => {
    const progress = ITMEvaluator.evaluate(firstItm, metricsWith(0));
    expect(progress).toEqual({ code: "first_itm", currentValue: 0, completed: false });
  });

  it("missing metric (undefined) behaves the same as 0", () => {
    const progress = ITMEvaluator.evaluate(firstItm, metricsWith(undefined));
    expect(progress).toEqual({ code: "first_itm", currentValue: 0, completed: false });
  });

  it("progress below the first target is not completed", () => {
    // ten_itm target = 10
    const progress = ITMEvaluator.evaluate(tenItm, metricsWith(5));
    expect(progress).toEqual({ code: "ten_itm", currentValue: 5, completed: false });
  });

  it("exact target reached -> completed true, currentValue === target", () => {
    const progress = ITMEvaluator.evaluate(tenItm, metricsWith(10));
    expect(progress).toEqual({ code: "ten_itm", currentValue: 10, completed: true });
  });

  it("value between tier thresholds: below the next tier's target still not completed for that tier", () => {
    // Between ten_itm's target (10) and twenty_five_itm's target (25).
    const progress = ITMEvaluator.evaluate(twentyFiveItm, metricsWith(15));
    expect(progress).toEqual({ code: "twenty_five_itm", currentValue: 15, completed: false });

    // The same raw value already completes the lower tier.
    const lowerTierProgress = ITMEvaluator.evaluate(tenItm, metricsWith(15));
    expect(lowerTierProgress.completed).toBe(true);
    expect(lowerTierProgress.currentValue).toBe(10); // capped, see below
  });

  it("value above the maximum target caps currentValue at target and completes", () => {
    // hundred_itm target = 100
    const progress = ITMEvaluator.evaluate(hundredItm, metricsWith(197));
    expect(progress).toEqual({ code: "hundred_itm", currentValue: 100, completed: true });
  });

  it("currentValue is never reported above the achievement's own target (capped)", () => {
    const progress = ITMEvaluator.evaluate(firstItm, metricsWith(197));
    expect(progress.currentValue).toBe(1);
    expect(progress.currentValue).toBeLessThanOrEqual(firstItm.target as number);
  });

  it("completed is true exactly at and above target, false strictly below, for every catalog tier", () => {
    for (const definition of [firstItm, tenItm, twentyFiveItm, hundredItm]) {
      const target = definition.target as number;

      expect(ITMEvaluator.evaluate(definition, metricsWith(target - 1)).completed).toBe(false);
      expect(ITMEvaluator.evaluate(definition, metricsWith(target)).completed).toBe(true);
      expect(ITMEvaluator.evaluate(definition, metricsWith(target + 50)).completed).toBe(true);
    }
  });
});
