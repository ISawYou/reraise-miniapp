import {
  ACHIEVEMENT_METRIC,
  ACHIEVEMENT_TYPE,
  type AchievementDefinition,
} from "@/config/achievements";
import type { AchievementEvaluator, PlayerAchievementMetrics } from "../types";
import { evaluateCappedMetric } from "./helpers";

// Owns "Headhunter": NOT cumulative -- completed only if the player ever
// made >= target ORDINARY knockouts in a single tournament/result
// (max_knockouts_single_tournament, see features/achievements.ts). Boss
// knockouts and Mystery Bounty never count toward this. Single-tier
// achievement (target 10), same evaluateCappedMetric pattern as every
// other metric-based evaluator -- no special-casing needed since the
// metric itself is already "max", not "sum".
export const HeadhunterEvaluator: AchievementEvaluator = {
  name: "headhunter",

  supports(definition: AchievementDefinition): boolean {
    return (
      definition.type === ACHIEVEMENT_TYPE.AUTOMATIC &&
      definition.metric === ACHIEVEMENT_METRIC.MAX_KNOCKOUTS_SINGLE_TOURNAMENT
    );
  },

  evaluate(definition: AchievementDefinition, metrics: PlayerAchievementMetrics) {
    return evaluateCappedMetric(
      definition,
      metrics[ACHIEVEMENT_METRIC.MAX_KNOCKOUTS_SINGLE_TOURNAMENT] ?? 0
    );
  },
};
