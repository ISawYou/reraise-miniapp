"use client";

import { useAcademyBeginnerOnly } from "@/components/academy/academy-access-context";
import { AcademyMembershipPanel } from "@/components/academy/academy-membership-panel";
import { AcademyNextStepLink } from "@/components/academy/academy-page-header";
import { ACADEMY_INTERMEDIATE_ROUTE, ACADEMY_TRAINERS_ROUTE } from "@/config/academy/navigation-routes";

/**
 * "Новичкам · Что дальше". FULL: the existing onward links, unchanged.
 * BEGINNER_ONLY: the club-participation CTA instead of links into content
 * the server would lock (presentation only — the server enforces access).
 */
export function AcademyBeginnerNextSteps() {
  const beginnerOnly = useAcademyBeginnerOnly();
  return (
    <section className="mt-8" aria-label="Что дальше">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">Что дальше</p>
      {beginnerOnly ? (
        <AcademyMembershipPanel className="mt-3" />
      ) : (
        <>
          <AcademyNextStepLink href={ACADEMY_TRAINERS_ROUTE} eyebrow="Практика" title="Проверь себя в тренажёрах" testId="trainers" />
          <AcademyNextStepLink href={ACADEMY_INTERMEDIATE_ROUTE} eyebrow="Следующий уровень" title="Продолжающим: диапазоны по позициям" testId="intermediate" />
        </>
      )}
    </section>
  );
}
