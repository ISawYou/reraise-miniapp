import { PushFoldAttribution } from "@/components/academy/push-fold-attribution";
import { PushFoldHome } from "@/components/academy/push-fold-home";
import { BackButton } from "@/components/ui/back-button";
import { ACADEMY_SOLVER_LAB_COURSE_CODE, getAcademyCourse } from "@/config/academy/catalog";
import { ACADEMY_PUSH_FOLD_STRATEGY_NAME } from "@/lib/academy/push-fold-copy";
import { listAcademyPushFoldSpots } from "@/lib/academy/push-fold-trainer";

/**
 * Solver Lab · "Push/Fold" home: "Быстрая Push/Fold тренировка" first, then
 * the manual family → stack → seat picker. Options are derived on the server
 * from the whitelisted datasets' real nodes (descriptors only, no ranges).
 */
export default function AcademySolverPushFoldPage() {
  const course = getAcademyCourse(ACADEMY_SOLVER_LAB_COURSE_CODE);
  const spots = listAcademyPushFoldSpots();

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#09100d_0%,#080a09_45%,#070707_100%)] px-4 py-6 pb-40 text-white">
      <div className="mx-auto max-w-md">
        <BackButton href="/academy" />

        <p className="mt-7 text-xs font-semibold uppercase tracking-[0.18em] text-[#d7b55a]">
          {course?.title ?? "Solver Lab"}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Push/Fold</h1>
        <p className="mt-3 text-sm leading-6 text-white/55">
          {ACADEMY_PUSH_FOLD_STRATEGY_NAME} для короткого стека 4–15 BB за столом 9-max: когда идти
          олл-ин первым и когда коллировать чужой пуш.
        </p>

        <PushFoldHome spots={spots} />

        <PushFoldAttribution className="mt-8" />
      </div>
    </main>
  );
}
