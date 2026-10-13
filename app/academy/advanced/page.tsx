import { AcademyPageAccessGate } from "@/components/academy/academy-page-access-gate";
import { academyAreaTarget } from "@/config/academy/access-policy";
import { AcademyNextStepLink, AcademyPageHeader } from "@/components/academy/academy-page-header";
import { type AcademyAdvancedSpotCard, AcademyAdvancedSpotList } from "@/components/academy/academy-spot-progress";
import {
  ACADEMY_ADVANCED_STUDY_SPOTS,
  ACADEMY_HOME_ROUTE,
  ACADEMY_PREFLOP_SETUP_ROUTE,
  ACADEMY_TRAINERS_ROUTE,
  requireAcademyDestination,
} from "@/config/academy/navigation";
import { preflopTrainerSpotRoute, preflopTrainerTrainRoute } from "@/config/academy/preflop-trainer";
import { getAcademySpotProgressUnit } from "@/config/academy/spot-progress";
import { describePreflopTrainerSpot } from "@/lib/academy/preflop-trainer-copy";
import { listAcademyPreflopTrainerSpots } from "@/lib/academy/preflop-trainer";

const destination = requireAcademyDestination("advanced");

/**
 * "Продвинутым": hand-picked REAL harder nodes (mixed 3-bet / 4-bet decisions)
 * with real progress. Each card trains the node in the EXISTING fixed-node
 * trainer (`?from=advanced` changes only the back link) and links to its range
 * page. Progress = per-spot practice progress (config/academy/spot-progress.ts):
 * a spot counts once a training of it scored ≥ 80%. Resolved on the server from
 * the registered datasets (no frequencies are sent); a curated entry that does
 * not exist is simply not shown.
 */
export default function AcademyAdvancedPage() {
  const spots = listAcademyPreflopTrainerSpots();
  const studies: AcademyAdvancedSpotCard[] = ACADEMY_ADVANCED_STUDY_SPOTS.flatMap((entry) => {
    const spot = spots.find((candidate) => candidate.stackBb === entry.stackBb && candidate.nodeKey === entry.nodeKey);
    const unit = spot ? getAcademySpotProgressUnit(spot) : null;
    if (!spot || !unit) return [];
    const copy = describePreflopTrainerSpot(spot);
    return [{
      code: unit.code,
      topic: entry.topic,
      meta: `${spot.stackBb} BB · ${copy.title}`,
      nodeKey: spot.nodeKey,
      studyHref: preflopTrainerSpotRoute(spot.stackBb, spot.nodeKey),
      trainHref: `${preflopTrainerTrainRoute(spot.stackBb, spot.nodeKey)}?from=advanced`,
    }];
  });

  return (
    <AcademyPageAccessGate target={academyAreaTarget("advanced")}>
      <main className="min-h-screen bg-[linear-gradient(180deg,#09100d_0%,#080a09_45%,#070707_100%)] px-4 py-6 pb-28 text-white">
        <div className="mx-auto max-w-md">
          <AcademyPageHeader backHref={ACADEMY_HOME_ROUTE} backLabel="Академия" eyebrow={destination.title} title="Сложные ситуации">
            <p>
              Решения, где нет одного верного действия: защита блайндов, ответ на 3-бет и 4-бет.
              Потренируй каждую ситуацию — и загляни в диапазон, если что-то непонятно.
            </p>
          </AcademyPageHeader>

          <section className="mt-6" aria-label="Ситуации">
            <AcademyAdvancedSpotList spots={studies} />
            <AcademyNextStepLink
              href={ACADEMY_PREFLOP_SETUP_ROUTE}
              eyebrow="Любая другая ситуация"
              title="Выбери стек и позиции сам"
              testId="setup"
            />
          </section>

          <section className="mt-8" aria-label="Что дальше">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">Что дальше</p>
            <AcademyNextStepLink href={ACADEMY_TRAINERS_ROUTE} eyebrow="Практика" title="Готовые тренировки и быстрая тренировка" testId="trainers" />
          </section>
        </div>
      </main>
    </AcademyPageAccessGate>
  );
}
