"use client";

import { useAcademyBeginnerOnly } from "@/components/academy/academy-access-context";
import { BackButton } from "@/components/ui/back-button";
import { ACADEMY_BEGINNER_STEP2_ROUTE } from "@/config/academy/navigation-routes";

/**
 * Back link of a page a BEGINNER_ONLY player may open (a beginner-curriculum
 * spot): for FULL it is exactly the given back link; for BEGINNER_ONLY it
 * leads to "Новичкам · Шаг 2" instead of a hub the server would lock.
 */
export function AcademyAccessBackButton({ href, label }: { href: string; label?: string }) {
  const beginnerOnly = useAcademyBeginnerOnly();
  return beginnerOnly
    ? <BackButton href={ACADEMY_BEGINNER_STEP2_ROUTE} label="Новичкам" />
    : <BackButton href={href} {...(label ? { label } : {})} />;
}
