import Link from "next/link";
import { AcademyNextStepLink, AcademyPageHeader } from "@/components/academy/academy-page-header";
import {
  ACADEMY_ADVANCED_STUDY_SPOTS,
  ACADEMY_HOME_ROUTE,
  ACADEMY_PREFLOP_SETUP_ROUTE,
  ACADEMY_TRAINERS_ROUTE,
  requireAcademyDestination,
} from "@/config/academy/navigation";
import { preflopTrainerSpotRoute } from "@/config/academy/preflop-trainer";
import { describePreflopTrainerSpot } from "@/lib/academy/preflop-trainer-copy";
import { listAcademyPreflopTrainerSpots } from "@/lib/academy/preflop-trainer";

const destination = requireAcademyDestination("advanced");

/**
 * "Продвинутым": no new lessons — links to the existing range-study pages of
 * real, harder nodes (mixed 3-bet / 4-bet decisions). Resolved on the server
 * from the registered datasets' spot descriptors (no frequencies are sent);
 * a curated entry that does not exist is simply not shown.
 */
export default function AcademyAdvancedPage() {
  const spots = listAcademyPreflopTrainerSpots();
  const studies = ACADEMY_ADVANCED_STUDY_SPOTS.flatMap((entry) => {
    const spot = spots.find((candidate) => candidate.stackBb === entry.stackBb && candidate.nodeKey === entry.nodeKey);
    if (!spot) return [];
    const copy = describePreflopTrainerSpot(spot);
    return [{ ...entry, href: preflopTrainerSpotRoute(spot.stackBb, spot.nodeKey), title: copy.title, situation: copy.situationLabel }];
  });

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#09100d_0%,#080a09_45%,#070707_100%)] px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-md">
        <AcademyPageHeader backHref={ACADEMY_HOME_ROUTE} backLabel="Академия" eyebrow={destination.title} title="Сложные ситуации">
          <p>
            Разбор диапазонов там, где решение не очевидно: защита блайндов, ответ на 3-бет и 4-бет.
            Каждая клетка сетки — рука; цвет показывает, как часто стратегия выбирает каждое действие.
            Смешанная клетка значит, что рука играется по-разному в разных раздачах.
          </p>
        </AcademyPageHeader>

        <section className="mt-6" aria-label="Разборы">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">Разборы диапазонов</p>
          <div className="mt-3 space-y-2.5">
            {studies.map((study) => (
              <Link
                key={`${study.stackBb}-${study.nodeKey}`}
                href={study.href}
                data-advanced-study={study.nodeKey}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3.5 active:bg-white/[0.09]"
              >
                <span className="flex h-11 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-[#315f48] text-white">
                  <span className="text-sm font-bold leading-4">{study.stackBb}</span>
                  <span className="text-[10px] leading-3 text-white/70">BB</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold leading-5">{study.topic}</span>
                  <span className="mt-0.5 block text-xs text-white/45">{study.title} · {study.situation}</span>
                </span>
                <span aria-hidden="true" className="text-lg text-white/35">→</span>
              </Link>
            ))}
          </div>
          <AcademyNextStepLink
            href={ACADEMY_PREFLOP_SETUP_ROUTE}
            eyebrow="Любая другая ситуация"
            title="Выбери стек и позиции — и открой диапазон"
            testId="setup"
          />
        </section>

        <section className="mt-8" aria-label="Что дальше">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">Что дальше</p>
          <AcademyNextStepLink href={ACADEMY_TRAINERS_ROUTE} eyebrow="Практика" title="Проверь решения в тренажёрах" testId="trainers" />
          <p className="mt-4 text-xs leading-5 text-white/35">Новые материалы для продвинутых появятся в этом разделе позже.</p>
        </section>
      </div>
    </main>
  );
}
