import { AcademyPageAccessGate } from "@/components/academy/academy-page-access-gate";
import { academyPreflopQuickMixTarget } from "@/lib/academy/access-targets";
import { PreflopQuickMix } from "@/components/academy/preflop-trainer";

/**
 * "Быстрая тренировка": no configuration — the server picks 10 nodes across
 * stacks and situations for (player, attempt). Stable route
 * `ACADEMY_PREFLOP_QUICK_MIX_ROUTE`.
 */
export default function AcademyPreflopQuickMixPage() {
  return (
    <AcademyPageAccessGate target={academyPreflopQuickMixTarget()}>
      <PreflopQuickMix />
    </AcademyPageAccessGate>
  );
}
