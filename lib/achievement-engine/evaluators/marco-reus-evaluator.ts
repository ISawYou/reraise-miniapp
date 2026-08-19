import {
  ACHIEVEMENT_METRIC,
  ACHIEVEMENT_TYPE,
  type AchievementDefinition,
} from "@/config/achievements";
import type { AchievementEvaluator, PlayerAchievementMetrics } from "../types";
import { evaluateCappedMetric } from "./helpers";

// Owns "Marco Reus": lifetime count of times the player finished exactly
// one place after a tournament's rating zone (the "bubble"). Single-tier
// (target 1) -- same evaluateCappedMetric pattern as every other
// metric-based evaluator. The bubble determination itself (rating-zone
// size via getExpectedPrizePlaces) happens once, in
// features/achievements.ts's metrics collection -- this evaluator only
// reads the already-computed bubble_count metric, never touches
// Rating Engine logic directly.
export const MarcoReusEvaluator: AchievementEvaluator = {
  name: "marco-reus",

  supports(definition: AchievementDefinition): boolean {
    return (
      definition.type === ACHIEVEMENT_TYPE.AUTOMATIC &&
      definition.metric === ACHIEVEMENT_METRIC.BUBBLE_COUNT
    );
  },

  evaluate(definition: AchievementDefinition, metrics: PlayerAchievementMetrics) {
    return evaluateCappedMetric(
      definition,
      metrics[ACHIEVEMENT_METRIC.BUBBLE_COUNT] ?? 0
    );
  },
};
