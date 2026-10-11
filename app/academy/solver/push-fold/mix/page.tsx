import { PushFoldQuickMix } from "@/components/academy/push-fold-trainer";

/**
 * "Быстрая Push/Fold тренировка": no configuration — the server picks 10
 * nodes across stacks, seats and both families for (player, attempt).
 */
export default function AcademyPushFoldQuickMixPage() {
  return <PushFoldQuickMix />;
}
