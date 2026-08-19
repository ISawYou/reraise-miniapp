import {
  ACHIEVEMENT_METRIC,
  ACHIEVEMENT_TYPE,
  type AchievementDefinition,
} from "@/config/achievements";
import type { AchievementEvaluator, PlayerAchievementMetrics } from "../types";
import { evaluateCappedMetric } from "./helpers";

// Owns achievements tracked against the "knockouts" metric (ten_knockouts,
// fifty_knockouts, hundred_knockouts, two_hundred_fifty_knockouts).
export const KnockoutsEvaluator: AchievementEvaluator = {
  name: "knockouts",

  supports(definition: AchievementDefinition): boolean {
    return (
      definition.type === ACHIEVEMENT_TYPE.AUTOMATIC &&
      definition.metric === ACHIEVEMENT_METRIC.KNOCKOUTS
    );
  },

  evaluate(definition: AchievementDefinition, metrics: PlayerAchievementMetrics) {
    return evaluateCappedMetric(
      definition,
      metrics[ACHIEVEMENT_METRIC.KNOCKOUTS] ?? 0
    );
  },
};
