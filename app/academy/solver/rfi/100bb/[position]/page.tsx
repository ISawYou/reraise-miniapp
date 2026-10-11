import Link from "next/link";
import { notFound } from "next/navigation";
import { AcademyLessonProgressStatus } from "@/components/academy/academy-lesson-progress-status";
import { PokerPositionTable } from "@/components/academy/poker-position-table";
import { SolverFrequencyGrid } from "@/components/academy/SolverFrequencyGrid";
import { BackButton } from "@/components/ui/back-button";
import { getAcademyLessonByCode } from "@/config/academy/catalog";
import { getAcademyPreflopLesson } from "@/config/academy/lessons";
import { getAcademyStrategyDataset } from "@/config/academy/solver-datasets";
import {
  ACADEMY_SOLVER_RFI_MODULE_ROUTE,
  getAcademySolverLessonBinding,
  getAcademySolverRfiLesson,
} from "@/config/academy/solver-lessons";
import {
  ACADEMY_PREFLOP_POSITIONS,
  CANONICAL_STARTING_HANDS,
  calculateWeightedRangePercentage,
  isPreflopPosition,
} from "@/lib/academy/preflop";
import {
  classifySolverHandBucket,
  getAcademyStrategyNode,
  getAcademyStrategyNodeActions,
} from "@/lib/academy/solver";

type SolverLessonPageProps = {
  params: Promise<{ position: string }>;
};

export function generateStaticParams() {
  return ACADEMY_PREFLOP_POSITIONS.map((position) => ({ position: position.toLowerCase() }));
}

export default async function AcademySolverLessonPage({ params }: SolverLessonPageProps) {
  const { position } = await params;
  const canonicalPosition = position.toUpperCase();
  if (!isPreflopPosition(canonicalPosition)) notFound();

  const copy = getAcademyPreflopLesson(canonicalPosition);
  const solverLesson = getAcademySolverRfiLesson(canonicalPosition);
  const lesson = getAcademyLessonByCode(solverLesson.code);
  const binding = getAcademySolverLessonBinding(solverLesson.code);
  if (!lesson || !binding) notFound();

  // Strategy comes only from the lesson's canonical dataset/node binding.
  const dataset = getAcademyStrategyDataset(binding.datasetId);
  const node = getAcademyStrategyNode(dataset, binding.selector.nodeKey);
  const nodeActions = getAcademyStrategyNodeActions(dataset, node);
  const primaryAction = binding.primaryActionCode;
  const hands = node.hands;
  const raiseStrategy = Object.fromEntries(
    CANONICAL_STARTING_HANDS.map((hand) => [hand, hands[hand][primaryAction]]),
  );
  const weightedRaisePercentage = calculateWeightedRangePercentage(raiseStrategy);
  const mixedHandCount = CANONICAL_STARTING_HANDS.filter(
    (hand) => classifySolverHandBucket(hands[hand], primaryAction) === "MIXED",
  ).length;
  const positionNumber = ACADEMY_PREFLOP_POSITIONS.indexOf(canonicalPosition) + 1;

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_85%_28%_at_50%_-4%,rgba(76,116,95,0.18),transparent_65%),linear-gradient(180deg,#09100d_0%,#080a09_36%,#070707_100%)] px-3 py-6 pb-28 text-white min-[375px]:px-4">
      <div className="mx-auto max-w-md">
        <BackButton href={ACADEMY_SOLVER_RFI_MODULE_ROUTE} />

        <header className="mt-7">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d7b55a]">
            Solver Lab · Позиция {positionNumber}
          </p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">{lesson.title}</h1>
          <p className="mt-1 text-sm text-white/45">{lesson.subtitle}</p>
          <AcademyLessonProgressStatus lessonCode={lesson.code} />
        </header>

        <section className="mt-6">
          <PokerPositionTable activePosition={canonicalPosition} />
        </section>

        <section className="mt-4 rounded-[24px] border border-white/[0.08] bg-white/[0.04] p-4">
          <p className="text-[15px] leading-6 text-white/75">{lesson.description}</p>
          <p className="mt-3 text-[15px] leading-6 text-white/75">
            В тренировке у каждой раздачи есть рандомайзер от 0 до 99. Если он ниже частоты
            рейза руки — играем рейз, иначе фолд. Так смешанная стратегия превращается в
            конкретное действие.
          </p>
        </section>

        <section className="mt-7">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Частоты открытия {copy.displayLabel}</h2>
              <p className="mt-1 text-sm text-white/45">9-max MTT · 100 BB · рейз 2.25 BB</p>
            </div>
            <p className="shrink-0 text-sm font-semibold text-[#a8d5bb]">
              ≈{Math.round(weightedRaisePercentage)}%
            </p>
          </div>

          <SolverFrequencyGrid
            hands={hands}
            label={`Частоты открытия ${copy.displayLabel}`}
            actions={nodeActions}
            primaryAction={primaryAction}
          />

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/55">
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#315f48]" />
              Рейз 100%
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[linear-gradient(to_top,#4b7a61_50%,#1a221e_50%)]" />
              Смешанная ({mixedHandCount})
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full border border-white/15 bg-[#101312]" />
              Фолд 100%
            </span>
          </div>
        </section>

        <details className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-sm">
          <summary className="cursor-pointer list-none font-medium text-white/65">
            Об источнике частот
          </summary>
          <p className="mt-3 leading-5 text-white/45">
            Солверные частоты {dataset.provenance.provider} · {dataset.provenance.scenario}
            {" "}(9-max, 100 BB, анте, рейз 2.25 BB). HRC описывает эти диапазоны как
            приближение к общей структуре диапазонов открытия, а не как окончательную
            стратегию. Версия данных: {dataset.id}.
          </p>
        </details>

        <Link
          href={solverLesson.trainRoute}
          className="mt-6 flex min-h-14 items-center justify-center rounded-2xl bg-[#d7b55a] px-5 py-4 text-base font-semibold text-[#11120f] active:bg-[#e2c66f]"
        >
          Тренировать частоты
        </Link>
      </div>
    </main>
  );
}
