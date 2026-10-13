import { AcademyPageAccessGate } from "@/components/academy/academy-page-access-gate";
import { academyPushFoldTarget } from "@/lib/academy/access-targets";
import { PushFoldTrainingPaused } from "@/components/academy/push-fold-reference";
import { PushFoldQuickMix } from "@/components/academy/push-fold-trainer";
import { isAcademyPushFoldScoredTrainingEnabled } from "@/lib/academy/push-fold-trainer";

/**
 * "Быстрая Push/Fold тренировка": no configuration — the server picks 10
 * nodes across stacks, seats and both families for (player, attempt).
 * Only served while a dataset is validated for SCORED training; until then
 * (docs/ACADEMY_PUSH_FOLD_AUDIT.md) the route stays and shows an honest
 * "paused" screen that links to the reference — no session is started.
 */
export default function AcademyPushFoldQuickMixPage() {
  return (
    <AcademyPageAccessGate target={academyPushFoldTarget()}>
      {isAcademyPushFoldScoredTrainingEnabled() ? <PushFoldQuickMix /> : <PushFoldTrainingPaused />}
    </AcademyPageAccessGate>
  );
}
