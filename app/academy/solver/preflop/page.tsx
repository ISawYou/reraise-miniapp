import { PreflopTrainerHome } from "@/components/academy/preflop-trainer-home";
import { BackButton } from "@/components/ui/back-button";
import { ACADEMY_SOLVER_LAB_COURSE_CODE, getAcademyCourse } from "@/config/academy/catalog";
import { listAcademyPreflopTrainerSpots } from "@/lib/academy/preflop-trainer";

/**
 * Solver Lab · "Префлоп-тренажёр" home: "Быстрая тренировка" (no setup) first,
 * "Настроить спот" second. The manual picker's options are derived on the
 * server from the registered datasets' real nodes (spot descriptors only —
 * no frequencies).
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
          Решения по частотам стратегии для стеков 5–100 BB. В каждой раздаче рандомайзер
          покажет, какая часть смешанной стратегии выпала.
        </p>

        <PreflopTrainerHome spots={spots} />
      </div>
    </main>
  );
}
