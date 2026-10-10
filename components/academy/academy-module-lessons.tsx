"use client";

import Link from "next/link";
import { useAcademyProgress } from "@/components/academy/use-academy-progress";
import type { AcademyCourse, AcademyModule } from "@/types/academy";

/**
 * Generic module landing body: course progress (read from the course's OWN
 * entry in the additive `courses` progress list) + the module's lesson list.
 */
export function AcademyModuleLessons({
  course,
  courseModule,
}: {
  course: AcademyCourse;
  courseModule: AcademyModule;
}) {
  const { data, error, retry } = useAcademyProgress();
  const coursePayload = data?.courses?.find((entry) => entry.courseCode === course.code)
    ?? (data && data.courseCode === course.code ? data : null);
  const progressByLesson = new Map(
    coursePayload?.lessons.map((progress) => [progress.lessonCode, progress]) ?? [],
  );
  const progress = coursePayload?.course ?? null;

  return (
    <>
      <section className="mt-5 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3.5">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium text-white/75">Прогресс курса</span>
          <span className="text-white/50">
            {progress ? `${progress.passedLessons} из ${progress.totalLessons}` : "Загрузка..."}
          </span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="h-full rounded-full bg-[#568b70] transition-[width] duration-300"
            style={{ width: `${progress?.progressPercent ?? 0}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-white/40">
          <span>{progress?.progressPercent ?? 0}%</span>
          {error ? (
            <button type="button" onClick={retry} className="text-[#d7b55a]">
              Повторить загрузку
            </button>
          ) : null}
        </div>
      </section>

      <div className="mt-6 space-y-2.5">
        {courseModule.lessons.map((lesson, index) => {
          const lessonProgress = progressByLesson.get(lesson.code);

          return (
            <Link
              key={lesson.code}
              href={lesson.route}
              className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3.5 active:bg-white/[0.09]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#315f48] text-sm font-semibold text-white">
                {index + 1}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-lg font-semibold text-white">{lesson.title}</span>
                  <span className="truncate text-xs text-white/35">{lesson.subtitle}</span>
                </span>
                <span className={`mt-0.5 block text-sm ${lessonProgress?.passed ? "text-[#90c9a8]" : "text-white/45"}`}>
                  {lessonProgress?.passed
                    ? `Пройдено · ${lessonProgress.bestScorePercent}%`
                    : lessonProgress
                      ? `Лучший результат: ${lessonProgress.bestScorePercent}%`
                      : "Не начато"}
                </span>
              </span>

              <span aria-hidden="true" className="text-lg text-white/35">→</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
