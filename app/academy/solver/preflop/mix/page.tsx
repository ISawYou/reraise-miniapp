import { PreflopQuickMix } from "@/components/academy/preflop-trainer";

/**
 * "Быстрая тренировка": no configuration — the server picks 10 nodes across
 * stacks and situations for (player, attempt). Stable route
 * `ACADEMY_PREFLOP_QUICK_MIX_ROUTE`.
 */
export default function AcademyPreflopQuickMixPage() {
  return <PreflopQuickMix />;
}
