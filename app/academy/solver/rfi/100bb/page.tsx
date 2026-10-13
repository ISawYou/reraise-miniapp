import { AcademyPageAccessGate } from "@/components/academy/academy-page-access-gate";
import { academyAreaTarget } from "@/config/academy/access-policy";
import { AcademyModuleLessons } from "@/components/academy/academy-module-lessons";
import { BackButton } from "@/components/ui/back-button";
import { ACADEMY_INTERMEDIATE_ROUTE, requireAcademyDestination } from "@/config/academy/navigation";
import {
  ACADEMY_SOLVER_LAB_COURSE_CODE,
  ACADEMY_SOLVER_RFI_MODULE_CODE,
  getAcademyCourse,
  getAcademyModule,
} from "@/config/academy/catalog";

const solverCourse = getAcademyCourse(ACADEMY_SOLVER_LAB_COURSE_CODE);
const solverModule = getAcademyModule(ACADEMY_SOLVER_RFI_MODULE_CODE);
if (!solverCourse || !solverModule) {
  throw new Error(`Academy catalog is missing Solver Lab module ${ACADEMY_SOLVER_RFI_MODULE_CODE}`);
}

export default function AcademySolverRfiModulePage() {
  return (
    <AcademyPageAccessGate target={academyAreaTarget("solver-rfi")}>
      <main className="min-h-screen bg-[linear-gradient(180deg,#09100d_0%,#080a09_45%,#070707_100%)] px-4 py-6 pb-28 text-white">
        <div className="mx-auto max-w-md">
          <BackButton href={ACADEMY_INTERMEDIATE_ROUTE} label={requireAcademyDestination("intermediate").title} />

          <p className="mt-7 text-xs font-semibold uppercase tracking-[0.18em] text-[#d7b55a]">
            {requireAcademyDestination("intermediate").title}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Диапазоны по позициям</h1>
          <p className="mt-1 text-xs text-white/40">{solverModule!.title}</p>
          <p className="mt-3 text-sm leading-6 text-white/55">
            Здесь диапазоны не упрощены до «открываем / фолд». Многие руки разыгрываются
            смешанно: часть раздач рейзим, часть сбрасываем. Рандомайзер подскажет, какая
            часть стратегии выпала в конкретной раздаче.
          </p>

          <AcademyModuleLessons course={solverCourse!} courseModule={solverModule!} />
        </div>
      </main>
    </AcademyPageAccessGate>
  );
}
