import { AcademyModuleLessons } from "@/components/academy/academy-module-lessons";
import { AcademyNextStepLink, AcademyPageHeader } from "@/components/academy/academy-page-header";
import { getAcademyCourse, getAcademyModule } from "@/config/academy/catalog";
import {
  ACADEMY_ADVANCED_ROUTE,
  ACADEMY_HOME_ROUTE,
  ACADEMY_TRAINERS_ROUTE,
  requireAcademyDestination,
} from "@/config/academy/navigation";

const destination = requireAcademyDestination("intermediate");
const course = getAcademyCourse(destination.courseCode!);
const courseModule = getAcademyModule(destination.moduleCode!);
if (!course || !courseModule) {
  throw new Error(`Academy catalog is missing ${destination.courseCode} / ${destination.moduleCode}`);
}

/**
 * "Продолжающим": the existing 100 BB positional lessons (Solver Lab RFI
 * module — same lesson codes, `/academy/solver/rfi/100bb/[position]` URLs and
 * progress), introduced in plain language.
 */
export default function AcademyIntermediatePage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#09100d_0%,#080a09_45%,#070707_100%)] px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-md">
        <AcademyPageHeader backHref={ACADEMY_HOME_ROUTE} backLabel="Академия" eyebrow={destination.title} title="Диапазоны по позициям">
          <p>
            Те же позиции, но точнее. Не каждая рука — это просто «рейз» или «фолд»: часть рук
            сильные игроки разыгрывают по-разному — в одних раздачах рейзят, в других сбрасывают.
            В уроках видно, какие руки играются всегда, а какие — смешанно.
          </p>
          <p className="mt-2 text-xs text-white/40">Стол на 9 игроков · стек 100 BB · первый вход в банк</p>
        </AcademyPageHeader>

        <AcademyModuleLessons course={course!} courseModule={courseModule!} />

        <section className="mt-8" aria-label="Что дальше">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">Что дальше</p>
          <AcademyNextStepLink href={ACADEMY_TRAINERS_ROUTE} eyebrow="Практика" title="Тренируй разные стеки и ситуации" testId="trainers" />
          <AcademyNextStepLink href={ACADEMY_ADVANCED_ROUTE} eyebrow="Следующий уровень" title="Продвинутым: сложные ситуации" testId="advanced" />
        </section>
      </div>
    </main>
  );
}
