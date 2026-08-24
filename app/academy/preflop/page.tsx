"use client";

import Link from "next/link";
import { useAcademyProgress } from "@/components/academy/use-academy-progress";
import { BackButton } from "@/components/ui/back-button";
import { ACADEMY_PREFLOP_LESSONS } from "@/config/academy/lessons";
import { ACADEMY_PREFLOP_POSITIONS } from "@/lib/academy/preflop";

export default function AcademyPreflopPage() {
  const { data, error, retry } = useAcademyProgress();
  const progressByLesson = new Map(
    data?.lessons.map((progress) => [progress.lessonCode, progress]) ?? [],
  );

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#09100d_0%,#080a09_45%,#070707_100%)] px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-md">
        <BackButton href="/academy" />

        <p className="mt-7 text-xs font-semibold uppercase tracking-[0.18em] text-[#d7b55a]">
          Префлоп
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Позиции за столом</h1>
        <p className="mt-3 text-sm leading-6 text-white/55">
          Начни с первой позиции и постепенно двигайся ближе к баттону.
        </p>

        <section className="mt-5 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-white/75">Прогресс курса</span>
            <span className="text-white/50">
              {data ? `${data.course.passedLessons} из ${data.course.totalLessons}` : "Загрузка..."}
            </span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className="h-full rounded-full bg-[#568b70] transition-[width] duration-300"
              style={{ width: `${data?.course.progressPercent ?? 0}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-white/40">
            <span>{data?.course.progressPercent ?? 0}%</span>
            {error ? (
              <button type="button" onClick={retry} className="text-[#d7b55a]">
                Повторить загрузку
              </button>
            ) : null}
          </div>
        </section>

        <div className="mt-6 space-y-2.5">
          {ACADEMY_PREFLOP_POSITIONS.map((position, index) => {
            const lesson = ACADEMY_PREFLOP_LESSONS[position];
            const progress = progressByLesson.get(lesson.code);

            return (
              <Link
                key={position}
                href={`/academy/preflop/${position.toLowerCase()}`}
                className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3.5 active:bg-white/[0.09]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#315f48] text-sm font-semibold text-white">
                  {index + 1}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="text-lg font-semibold text-white">{lesson.displayLabel}</span>
                    <span className="truncate text-xs text-white/35">
                      {position !== lesson.displayLabel ? `${position} · ` : ""}{lesson.fullName}
                    </span>
                  </span>
                  <span className={`mt-0.5 block text-sm ${progress?.passed ? "text-[#90c9a8]" : "text-white/45"}`}>
                    {progress?.passed
                      ? `Пройдено · ${progress.bestScorePercent}%`
                      : progress
                        ? `Лучший результат: ${progress.bestScorePercent}%`
                        : "Не начато"}
                  </span>
                </span>

                <span aria-hidden="true" className="text-lg text-white/35">→</span>
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}
