import {
  ACHIEVEMENT_METRIC,
  ACHIEVEMENT_TYPE,
  type AchievementDefinition,
} from "@/config/achievements";
import type { AchievementEvaluator, PlayerAchievementMetrics } from "../types";
import { evaluateCappedMetric } from "./helpers";

// Owns the "Tournament Streak" progression (max_tournament_streak metric):
// the longest run of consecutive completed club tournaments a player
// attended, out of ALL club tournaments in chronological order -- not
// calendar weeks. Already-reached maxima are never lost after a later
// miss (see lib/tournament-streak.ts::computeMaxTournamentStreak, which
// features/achievements.ts calls to produce this metric).
export const TournamentStreakEvaluator: AchievementEvaluator = {
  name: "tournament-streak",

  supports(definition: AchievementDefinition): boolean {
    return (
      definition.type === ACHIEVEMENT_TYPE.AUTOMATIC &&
      definition.metric === ACHIEVEMENT_METRIC.MAX_TOURNAMENT_STREAK
    );
  },

  evaluate(definition: AchievementDefinition, metrics: PlayerAchievementMetrics) {
    return evaluateCappedMetric(
      definition,
      metrics[ACHIEVEMENT_METRIC.MAX_TOURNAMENT_STREAK] ?? 0
    );
  },
};
