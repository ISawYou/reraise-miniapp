import {
  ACHIEVEMENT_METRIC,
  ACHIEVEMENT_TYPE,
  type AchievementDefinition,
} from "@/config/achievements";
import type { AchievementEvaluator, PlayerAchievementMetrics } from "../types";
import { evaluateCappedMetric } from "./helpers";

// Owns achievements tracked against the "tournaments played" metric
// (first_tournament, ten_tournaments).
export const PlayedEvaluator: AchievementEvaluator = {
  name: "played",

  supports(definition: AchievementDefinition): boolean {
    return (
      definition.type === ACHIEVEMENT_TYPE.AUTOMATIC &&
      definition.metric === ACHIEVEMENT_METRIC.TOURNAMENTS_PLAYED
    );
  },

  evaluate(definition: AchievementDefinition, metrics: PlayerAchievementMetrics) {
    return evaluateCappedMetric(
      definition,
      metrics[ACHIEVEMENT_METRIC.TOURNAMENTS_PLAYED] ?? 0
    );
  },
};
