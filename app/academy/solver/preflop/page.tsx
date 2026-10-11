import { PreflopTrainerSetup } from "@/components/academy/preflop-trainer-setup";
import { BackButton } from "@/components/ui/back-button";
import { ACADEMY_SOLVER_LAB_COURSE_CODE, getAcademyCourse } from "@/config/academy/catalog";
import { listAcademyPreflopTrainerSpots } from "@/lib/academy/preflop-trainer";

/**
 * Solver Lab · "Префлоп-тренажёр" setup. The selectable options are derived
 * on the server from the registered datasets' real nodes and handed to the
 * client picker (spot descriptors only — no frequencies).
 */
export default function AcademySolverPreflopTrainerPage() {
  const course = getAcademyCourse(ACADEMY_SOLVER_LAB_COURSE_CODE);
  const spots = listAcademyPreflopTrainerSpots();

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#09100d_0%,#080a09_45%,#070707_100%)] px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-md">
        <BackButton href="/academy" />

        <p className="mt-7 text-xs font-semibold uppercase tracking-[0.18em] text-[#d7b55a]">
          {course?.title ?? "Solver Lab"}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Префлоп-тренажёр</h1>
        <p className="mt-3 text-sm leading-6 text-white/55">
          Выбери стек, ситуацию и позиции. Доступны только споты, для которых есть частоты
          стратегии. В каждой раздаче рандомайзер покажет, какая часть смешанной стратегии
          выпала.
        </p>

        <PreflopTrainerSetup spots={spots} />
      </div>
    </main>
  );
}
