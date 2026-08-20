import Link from "next/link";
import { notFound } from "next/navigation";
import { PreflopRangeGrid } from "@/components/academy/preflop-range-grid";
import { AcademyLessonProgressStatus } from "@/components/academy/academy-lesson-progress-status";
import { getAcademyPreflopLesson } from "@/config/academy/lessons";
import { getAcademyPreflopRange } from "@/config/academy/preflop-ranges";
import {
  ACADEMY_PREFLOP_POSITIONS,
  buildPreflopMatrix,
  calculateTeachingRangeStats,
  isPreflopPosition,
} from "@/lib/academy/preflop";

type AcademyLessonPageProps = {
  params: Promise<{ position: string }>;
};

export function generateStaticParams() {
  return ACADEMY_PREFLOP_POSITIONS.map((position) => ({
    position: position.toLowerCase(),
  }));
}

export default async function AcademyLessonPage({ params }: AcademyLessonPageProps) {
  const { position } = await params;
  const canonicalPosition = position.toUpperCase();
  if (!isPreflopPosition(canonicalPosition)) notFound();

  const range = getAcademyPreflopRange(canonicalPosition);
  const lesson = getAcademyPreflopLesson(canonicalPosition);
  const matrix = buildPreflopMatrix(range.referenceStrategy);
  const { teachingOpenPercentage } = calculateTeachingRangeStats(range.referenceStrategy);
  const positionNumber = ACADEMY_PREFLOP_POSITIONS.indexOf(canonicalPosition) + 1;

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_85%_28%_at_50%_-4%,rgba(76,116,95,0.18),transparent_65%),linear-gradient(180deg,#09100d_0%,#080a09_36%,#070707_100%)] px-3 py-6 pb-28 text-white min-[375px]:px-4">
      <div className="mx-auto max-w-md">
        <Link
          href="/academy/preflop"
          className="inline-flex items-center rounded-full border border-white/[0.08] px-3.5 py-2 text-sm text-white/65"
        >
          ← Назад
        </Link>

        <header className="mt-7">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d7b55a]">
            Префлоп · Позиция {positionNumber}
          </p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">{lesson.displayLabel}</h1>
          <p className="mt-1 text-sm text-white/45">
            {canonicalPosition !== lesson.displayLabel ? `${canonicalPosition} · ` : ""}
            {lesson.fullName}
          </p>
          <AcademyLessonProgressStatus lessonCode={lesson.code} />
        </header>

        <section className="mt-6 rounded-[24px] border border-white/[0.08] bg-white/[0.04] p-4">
          {lesson.theory.map((paragraph, index) => (
            <p key={paragraph} className={`${index > 0 ? "mt-3 " : ""}text-[15px] leading-6 text-white/75`}>
              {paragraph}
            </p>
          ))}
        </section>

        <section className="mt-7">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Примерный диапазон открытия</h2>
              <p className="mt-1 text-sm text-white/45">9-max MTT · ~100 BB</p>
            </div>
            <p className="shrink-0 text-sm font-semibold text-[#a8d5bb]">
              ≈{Math.round(teachingOpenPercentage)}%
            </p>
          </div>

          <PreflopRangeGrid
            matrix={matrix}
            label={`Диапазон открытия ${lesson.displayLabel}`}
          />

          <div className="mt-4 flex items-center gap-5 text-xs text-white/55">
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#315f48]" />
              Открываем
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full border border-white/15 bg-[#101312]" />
              Фолд
            </span>
          </div>
        </section>

        <p className="mt-6 text-xs leading-5 text-white/38">
          Это упрощённый учебный диапазон для глубокого стека около 100 BB в 9-max MTT.
          Реальная стратегия зависит от структуры турнира, размера открытия, стеков и игры
          соперников.
        </p>

        <details className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-sm">
          <summary className="cursor-pointer list-none font-medium text-white/65">
            О диапазоне
          </summary>
          <p className="mt-3 leading-5 text-white/45">
            Диапазоны Academy основаны на solver-backed reference strategy и упрощены для
            обучения. Редкие смешанные решения сведены к одному базовому действию.
          </p>
        </details>

        <Link
          href={`/academy/preflop/${position.toLowerCase()}/train`}
          className="mt-6 flex min-h-14 items-center justify-center rounded-2xl bg-[#d7b55a] px-5 py-4 text-base font-semibold text-[#11120f] active:bg-[#e2c66f]"
        >
          Проверить себя
        </Link>
      </div>
    </main>
  );
}
