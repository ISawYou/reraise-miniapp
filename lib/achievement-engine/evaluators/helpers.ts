import type { AchievementDefinition } from "@/config/achievements";
import type { AchievementProgress } from "../types";

// Shared by every evaluator whose achievements are "reach N of metric X" —
// current value capped at the target, completed once it's reached. Not a
// coupling between evaluators: it's a pure formatting helper any of them
// may use, or skip entirely for a category that needs different rules.
export function evaluateCappedMetric(
  definition: AchievementDefinition,
  rawValue: number
): AchievementProgress {
  // `target` is optional on AchievementDefinition to accommodate manual
  // (Legendary) achievements, which never reach this helper — every
  // automatic achievement (the only ones this is called for) always sets
  // it. The `?? 0` is a type-compatibility fallback, not a real case.
  const target = definition.target ?? 0;
  const currentValue = Math.min(rawValue, target);
  return {
    code: definition.code,
    currentValue,
    completed: currentValue >= target,
  };
}
