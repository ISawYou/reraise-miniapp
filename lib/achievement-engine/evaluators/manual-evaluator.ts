import { ACHIEVEMENT_TYPE, type AchievementDefinition } from "@/config/achievements";
import type { AchievementEvaluator } from "../types";

// Placeholder for achievements granted directly (not computed from player
// stats) — no manual-issuance path exists yet. This evaluator exists so the
// engine already understands the "manual" achievement type architecturally.
//
// It deliberately never reports completion: today's automatic sync
// (features/achievements.ts::syncPlayerAchievements) only ever runs the
// engine over "automatic" definitions, so this evaluator isn't invoked in
// practice yet. It's registered so a future manual-issuance flow has
// something to plug into without the engine or registry changing shape.
export const ManualEvaluator: AchievementEvaluator = {
  name: "manual",

  supports(definition: AchievementDefinition): boolean {
    return definition.type === ACHIEVEMENT_TYPE.MANUAL;
  },

  evaluate(definition: AchievementDefinition) {
    return {
      code: definition.code,
      currentValue: 0,
      completed: false,
    };
  },
};
