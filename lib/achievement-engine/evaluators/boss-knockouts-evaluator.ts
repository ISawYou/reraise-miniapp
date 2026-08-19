import {
  ACHIEVEMENT_METRIC,
  ACHIEVEMENT_TYPE,
  type AchievementDefinition,
} from "@/config/achievements";
import type { AchievementEvaluator, PlayerAchievementMetrics } from "../types";
import { evaluateCappedMetric } from "./helpers";

// Owns the "Boss Hunter" progression (boss_knockouts metric): cumulative
// lifetime results.boss_knockouts, separate from ordinary knockouts
// (Terminator/KnockoutsEvaluator) and Mystery Bounty envelope points -- see
// ResultRepository.findBossKnockoutsByPlayerId.
export const BossKnockoutsEvaluator: AchievementEvaluator = {
  name: "boss-knockouts",

  supports(definition: AchievementDefinition): boolean {
    return (
      definition.type === ACHIEVEMENT_TYPE.AUTOMATIC &&
      definition.metric === ACHIEVEMENT_METRIC.BOSS_KNOCKOUTS
    );
  },

  evaluate(definition: AchievementDefinition, metrics: PlayerAchievementMetrics) {
    return evaluateCappedMetric(
      definition,
      metrics[ACHIEVEMENT_METRIC.BOSS_KNOCKOUTS] ?? 0
    );
  },
};
