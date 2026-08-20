"use client";

import { useAcademyProgress } from "@/components/academy/use-academy-progress";
import type { AcademyLessonCode } from "@/types/academy";

export function AcademyLessonProgressStatus({ lessonCode }: { lessonCode: AcademyLessonCode }) {
  const { data, error, retry } = useAcademyProgress();
  const progress = data?.lessons.find((lesson) => lesson.lessonCode === lessonCode);

  if (error) {
    return (
      <button type="button" onClick={retry} className="mt-4 text-xs text-[#d7b55a]">
        Не удалось загрузить прогресс · Повторить
      </button>
    );
  }
  if (!data) return <div className="mt-4 h-5 w-36 animate-pulse rounded bg-white/[0.06]" />;
  if (!progress) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/55">
      <span className={progress.passed ? "font-medium text-[#90c9a8]" : ""}>
        {progress.passed ? "Пройдено" : `Лучший результат: ${progress.bestScorePercent}%`}
      </span>
      {progress.passed ? <span>Лучший результат: {progress.bestScorePercent}%</span> : null}
      <span>Попыток: {progress.attemptsCount}</span>
    </div>
  );
}
