import { AcademyModuleLessons } from "@/components/academy/academy-module-lessons";
import { AcademyNextStepLink, AcademyPageHeader } from "@/components/academy/academy-page-header";
import { getAcademyCourse, getAcademyModule } from "@/config/academy/catalog";
import {
  ACADEMY_HOME_ROUTE,
  ACADEMY_INTERMEDIATE_ROUTE,
  ACADEMY_TRAINERS_ROUTE,
  requireAcademyDestination,
} from "@/config/academy/navigation";

const destination = requireAcademyDestination("beginner");
const course = getAcademyCourse(destination.courseCode!);
const courseModule = getAcademyModule(destination.moduleCode!);
if (!course || !courseModule) {
  throw new Error(`Academy catalog is missing ${destination.courseCode} / ${destination.moduleCode}`);
}

/**
 * "Новичкам": the existing База MTT Open Raise lessons (same lesson codes,
 * same `/academy/preflop/[position]` URLs, same progress), framed in plain words.
 */
export default function AcademyBeginnerPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#09100d_0%,#080a09_45%,#070707_100%)] px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-md">
        <AcademyPageHeader backHref={ACADEMY_HOME_ROUTE} backLabel="Академия" eyebrow={destination.title} title="Позиции за столом">
          <p>
            Семь коротких уроков о первом решении в раздаче: какие руки открывать рейзом,
            если до тебя все сбросили. Начни с первой позиции и постепенно двигайся к баттону.
          </p>
        </AcademyPageHeader>

        <AcademyModuleLessons course={course!} courseModule={courseModule!} />

        <section className="mt-8" aria-label="Что дальше">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">Что дальше</p>
          <AcademyNextStepLink href={ACADEMY_TRAINERS_ROUTE} eyebrow="Практика" title="Проверь себя в тренажёрах" testId="trainers" />
          <AcademyNextStepLink href={ACADEMY_INTERMEDIATE_ROUTE} eyebrow="Следующий уровень" title="Продолжающим: диапазоны по позициям" testId="intermediate" />
        </section>
      </div>
    </main>
  );
}
