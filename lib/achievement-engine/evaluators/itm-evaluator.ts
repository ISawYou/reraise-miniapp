import {
  ACHIEVEMENT_METRIC,
  ACHIEVEMENT_TYPE,
  type AchievementDefinition,
} from "@/config/achievements";
import type { AchievementEvaluator, PlayerAchievementMetrics } from "../types";
import { evaluateCappedMetric } from "./helpers";

// Owns achievements tracked against the "itm_finishes" metric (first_itm,
// ten_itm, twenty_five_itm, hundred_itm). itm_finishes is sourced
// exclusively from results.itm_points > 0 (Rating Breakdown) -- see
// ResultRepository.countItmFinishesByPlayerId / features/achievements.ts.
export const ITMEvaluator: AchievementEvaluator = {
  name: "itm",

  supports(definition: AchievementDefinition): boolean {
    return (
      definition.type === ACHIEVEMENT_TYPE.AUTOMATIC &&
      definition.metric === ACHIEVEMENT_METRIC.ITM_FINISHES
    );
  },

  evaluate(definition: AchievementDefinition, metrics: PlayerAchievementMetrics) {
    return evaluateCappedMetric(
      definition,
      metrics[ACHIEVEMENT_METRIC.ITM_FINISHES] ?? 0
    );
  },
};
