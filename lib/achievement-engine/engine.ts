import type { AchievementDefinition } from "@/config/achievements";
import type { AchievementProgress, PlayerAchievementMetrics } from "./types";
import { evaluatorRegistry } from "./evaluators/registry";

// The single place that turns (achievement definitions + player metrics)
// into achievement progress. Delegates the actual computation to whichever
// evaluator the registry resolves for each definition — this function never
// needs to change when a new achievement category is added, only the
// registry does.
//
// Knows nothing about persistence: callers decide what to do with the
// returned AchievementProgress[] (e.g. map it into repository upsert rows).
export function runAchievementEngine(
  definitions: AchievementDefinition[],
  metrics: PlayerAchievementMetrics
): AchievementProgress[] {
  return definitions.reduce<AchievementProgress[]>((results, definition) => {
    const evaluator = evaluatorRegistry.resolve(definition);

    if (!evaluator) {
      // Some achievement categories may not have evaluators yet.
      // They are intentionally skipped until implemented — the catalog
      // (config/achievements.ts) can list an achievement well before its
      // evaluator exists, so it can develop independently of the engine.
      // Not logged: with the full catalog in place, this is the expected
      // steady state for every not-yet-implemented category, not an error
      // — logging it here would just be per-achievement console spam on
      // every sync. Skip rather than throw either way, so one
      // unsupported catalog entry never takes down the whole sync for
      // every other achievement.
      return results;
    }

    results.push(evaluator.evaluate(definition, metrics));
    return results;
  }, []);
}
