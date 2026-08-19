import type { AchievementDefinition, AchievementMetric } from "@/config/achievements";

// Aggregated player stats the engine evaluates achievements against. One
// number per metric the catalog can reference — see config/achievements.ts.
//
// Partial, not a full Record: a metric can exist in the catalog before its
// stats collector does (was true historically for knockouts/itm_finishes/
// boss_knockouts, all wired up since). Evaluators already read through
// `metrics[...] ?? 0`, so a metric with no collected value simply behaves
// as "0 so far" instead of failing to compile.
export type PlayerAchievementMetrics = Partial<Record<AchievementMetric, number>>;

// What an evaluator hands back for one achievement. Deliberately narrow —
// no player_id, no completed_at, no timestamps. Turning this into a
// persistable row (AchievementUpsert) is the caller's job, not the
// engine's or an evaluator's.
export type AchievementProgress = {
  code: string;
  currentValue: number;
  completed: boolean;
};

// A single, independent achievement category. Each evaluator owns one
// slice of the catalog (e.g. "achievements tracked by tournaments played")
// and knows nothing about Repository, the database, the API, or the UI.
export interface AchievementEvaluator {
  readonly name: string;
  // Whether this evaluator is responsible for computing the given
  // definition's progress.
  supports(definition: AchievementDefinition): boolean;
  // Pure computation: definition + metrics in, progress out. No I/O.
  evaluate(
    definition: AchievementDefinition,
    metrics: PlayerAchievementMetrics
  ): AchievementProgress;
}
