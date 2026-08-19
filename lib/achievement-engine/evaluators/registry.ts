import type { AchievementDefinition } from "@/config/achievements";
import type { AchievementEvaluator } from "../types";
import { PlayedEvaluator } from "./played-evaluator";
import { WinsEvaluator } from "./wins-evaluator";
import { RatingEvaluator } from "./rating-evaluator";
import { ReferralEvaluator } from "./referral-evaluator";
import { KnockoutsEvaluator } from "./knockouts-evaluator";
import { ITMEvaluator } from "./itm-evaluator";
import { BossKnockoutsEvaluator } from "./boss-knockouts-evaluator";
import { HeadhunterEvaluator } from "./headhunter-evaluator";
import { TournamentStreakEvaluator } from "./tournament-streak-evaluator";
import { MarcoReusEvaluator } from "./marco-reus-evaluator";
import { ManualEvaluator } from "./manual-evaluator";

// Where the engine looks up which evaluator owns a given achievement
// definition. Adding a new achievement category is: write its evaluator,
// call `.register()` here — nothing in engine.ts ever needs to change.
class AchievementEvaluatorRegistry {
  private readonly evaluators: AchievementEvaluator[] = [];

  register(evaluator: AchievementEvaluator): void {
    this.evaluators.push(evaluator);
  }

  resolve(definition: AchievementDefinition): AchievementEvaluator | undefined {
    return this.evaluators.find((evaluator) => evaluator.supports(definition));
  }

  list(): readonly AchievementEvaluator[] {
    return this.evaluators;
  }
}

export const evaluatorRegistry = new AchievementEvaluatorRegistry();

evaluatorRegistry.register(PlayedEvaluator);
evaluatorRegistry.register(WinsEvaluator);
evaluatorRegistry.register(RatingEvaluator);
evaluatorRegistry.register(ReferralEvaluator);
evaluatorRegistry.register(KnockoutsEvaluator);
evaluatorRegistry.register(ITMEvaluator);
evaluatorRegistry.register(BossKnockoutsEvaluator);
evaluatorRegistry.register(HeadhunterEvaluator);
evaluatorRegistry.register(TournamentStreakEvaluator);
evaluatorRegistry.register(MarcoReusEvaluator);
evaluatorRegistry.register(ManualEvaluator);
