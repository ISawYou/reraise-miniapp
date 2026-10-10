"use client";

import Link from "next/link";
import { useAcademyProgress } from "@/components/academy/use-academy-progress";
import { listAcademyCourseLessonCodes } from "@/config/academy/catalog";
import type { AcademyCourse } from "@/types/academy";

function CourseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="12" cy="12" rx="8.5" ry="5.5" />
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="5" cy="10" r="1.5" />
      <circle cx="19" cy="10" r="1.5" />
      <circle cx="8" cy="18" r="1.5" />
      <circle cx="16" cy="18" r="1.5" />
    </svg>
  );
}

export function AcademyCourseCard({ course }: { course: AcademyCourse }) {
  const { data, error, retry } = useAcademyProgress();
  const [firstModule] = course.modules;
  // Lesson count always comes from the catalog; the server supplies passed counts.
  const totalLessons = listAcademyCourseLessonCodes(course).length;
  const progress = data && data.courseCode === course.code ? data.course : null;
  const progressPercent = progress?.progressPercent ?? 0;

  return (
    <section
      aria-label={course.title}
      className="mt-3 rounded-[26px] border border-white/10 bg-white/[0.055] p-5"
      data-course-code={course.code}
    >
      <Link
        href={firstModule?.route ?? "/academy"}
        className="flex items-start gap-4 transition-opacity active:opacity-80"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#315f48] text-white">
          <CourseIcon />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-xl font-semibold">{course.title}</span>
          <span className="mt-1 block text-sm leading-5 text-white/50">{course.description}</span>
        </span>

        <span aria-hidden="true" className="pt-3 text-xl text-white/35">
          →
        </span>
      </Link>

      {firstModule ? (
        <Link
          href={firstModule.route}
          className="mt-4 block rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3 active:bg-white/[0.06]"
        >
          <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d7b55a]">
            Модуль {firstModule.order}
          </span>
          <span className="mt-1 block text-[15px] font-medium text-white/85">{firstModule.title}</span>
          <span className="mt-0.5 block text-xs leading-5 text-white/45">
            {firstModule.description}
          </span>
        </Link>
      ) : null}

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium text-white/75">Прогресс курса</span>
          <span className="text-white/50">
            {progress ? `${progress.passedLessons} из ${totalLessons}` : "Загрузка..."}
          </span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="h-full rounded-full bg-[#568b70] transition-[width] duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-white/40">
          <span>{progressPercent}%</span>
          {error ? (
            <button type="button" onClick={retry} className="text-[#d7b55a]">
              Повторить загрузку
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
