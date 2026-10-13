"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAcademyBeginnerOnly } from "@/components/academy/academy-access-context";
import { AcademyLockIcon, AcademyMembershipPanel } from "@/components/academy/academy-membership-panel";
import { useAcademyProgress } from "@/components/academy/use-academy-progress";
import { ACADEMY_ACCESS_COPY } from "@/config/academy/access-copy";
import { getAcademyCourse, listAcademyCourseLessonCodes } from "@/config/academy/catalog";
import {
  ACADEMY_DESTINATIONS,
  type AcademyDestination,
  type AcademyDestinationCode,
} from "@/config/academy/navigation";
import type { AcademyProgressResponse } from "@/features/academy";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const ICONS: Record<AcademyDestinationCode, ReactNode> = {
  beginner: <Icon><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="M6 10.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5" /></Icon>,
  intermediate: <Icon><path d="M4 19V9" /><path d="M10 19V5" /><path d="M16 19v-7" /><path d="M22 19H2" /></Icon>,
  advanced: <Icon><circle cx="11" cy="11" r="6.5" /><path d="m20.5 20.5-4.9-4.9" /><path d="M8.5 11h5M11 8.5v5" /></Icon>,
  trainers: <Icon><ellipse cx="12" cy="12" rx="9" ry="6" /><path d="M8.5 12h7" /><path d="M12 9v6" /></Icon>,
};

/** "2 из 7 уроков" from the destination's OWN catalog course entry; null while loading. */
function lessonProgressText(destination: AcademyDestination, data: AcademyProgressResponse | null): string | null {
  if (!destination.courseCode) return null;
  const course = getAcademyCourse(destination.courseCode);
  if (!course) return null;
  const total = listAcademyCourseLessonCodes(course).length;
  if (!data) return "Загрузка...";
  const payload = data.courses?.find((entry) => entry.courseCode === course.code)
    ?? (data.courseCode === course.code ? data : null);
  return `${payload?.course.passedLessons ?? 0} из ${total} уроков`;
}

/**
 * A destination a BEGINNER_ONLY player cannot open yet: still visible (never
 * hidden), visibly locked, with the reason, no progress promise, and a tap
 * target that only scrolls to the membership panel.
 */
function LockedCard({ destination, practice = false }: { destination: AcademyDestination; practice?: boolean }) {
  return (
    <a
      href="#academy-membership"
      data-destination={destination.code}
      data-destination-locked
      aria-label={`${destination.title} — ${ACADEMY_ACCESS_COPY.lockedCardReason}`}
      className={`${practice ? "mt-2.5 rounded-[24px] py-4" : "rounded-[22px] py-3.5"} flex items-center gap-3.5 border border-white/[0.07] bg-white/[0.025] px-4 transition-opacity active:opacity-80`}
    >
      <span className={`${practice ? "h-12 w-12" : "h-11 w-11"} flex shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] text-white/40`}>
        {ICONS[destination.code]}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block ${practice ? "text-xl font-bold" : "text-lg font-semibold"} leading-6 text-white/55`}>{destination.title}</span>
        <span className="mt-0.5 block text-[13px] leading-5 text-white/35">{destination.description}</span>
        <span className="mt-1 flex items-center gap-1.5 text-xs font-medium text-[#d7b55a]/80" data-destination-lock-reason>
          <AcademyLockIcon className="h-3.5 w-3.5" />
          {ACADEMY_ACCESS_COPY.lockedCardReason}
        </span>
      </span>
    </a>
  );
}

function LearnCard({ destination, step, progress }: { destination: AcademyDestination; step: number; progress: string | null }) {
  return (
    <Link
      href={destination.route}
      data-destination={destination.code}
      className="flex items-center gap-3.5 rounded-[22px] border border-white/10 bg-white/[0.05] px-4 py-3.5 transition-opacity active:opacity-80"
    >
      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#315f48] text-white">
        {ICONS[destination.code]}
        <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#0b100d] text-[10px] font-bold text-[#d7b55a] ring-1 ring-[#d7b55a]/50">
          {step}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-lg font-semibold leading-6">{destination.title}</span>
          {progress ? <span className="shrink-0 text-xs font-medium text-[#90c9a8]" data-destination-progress>{progress}</span> : null}
        </span>
        <span className="mt-0.5 block text-[13px] leading-5 text-white/55">{destination.description}</span>
      </span>
      <span aria-hidden="true" className="text-xl text-white/35">→</span>
    </Link>
  );
}

/**
 * Academy landing: three "learn" levels (each mapped onto existing catalog
 * content) and a separate "Тренажёры" practice destination. Progress is
 * fetched ONCE for the whole landing.
 */
export function AcademyDestinations() {
  const { data, error, retry } = useAcademyProgress();
  // Presentation only (server-resolved tier from AcademyAuthGate); pages and APIs enforce on the server.
  const beginnerOnly = useAcademyBeginnerOnly();
  const locked = (destination: AcademyDestination) => beginnerOnly && destination.code !== "beginner";
  const learn = ACADEMY_DESTINATIONS.filter((entry) => entry.kind === "learn");
  const practice = ACADEMY_DESTINATIONS.filter((entry) => entry.kind === "practice");

  return (
    <>
      <section className="mt-5" aria-labelledby="academy-learn-heading">
        <h2 id="academy-learn-heading" className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">
          Учиться
        </h2>
        <div className="mt-2.5 space-y-2">
          {learn.map((destination, index) => (locked(destination)
            ? <LockedCard key={destination.code} destination={destination} />
            : <LearnCard key={destination.code} destination={destination} step={index + 1} progress={lessonProgressText(destination, data)} />
          ))}
        </div>
        {error ? (
          <button type="button" onClick={retry} className="mt-2 text-xs text-[#d7b55a]">
            Не удалось загрузить прогресс · Повторить
          </button>
        ) : null}
      </section>

      <section className="mt-5" aria-labelledby="academy-practice-heading">
        <h2 id="academy-practice-heading" className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">
          Практиковаться
        </h2>
        {practice.map((destination) => locked(destination) ? (
          <LockedCard key={destination.code} destination={destination} practice />
        ) : (
          <Link
            key={destination.code}
            href={destination.route}
            data-destination={destination.code}
            className="mt-2.5 flex items-center gap-3.5 rounded-[24px] border border-[#d7b55a]/35 bg-[radial-gradient(ellipse_90%_80%_at_100%_0%,rgba(215,181,90,0.18),transparent_70%),rgba(255,255,255,0.045)] px-4 py-4 transition-opacity active:opacity-80"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#d7b55a] text-[#11120f]">
              {ICONS[destination.code]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xl font-bold leading-6">{destination.title}</span>
              <span className="mt-0.5 block text-sm leading-5 text-white/60">{destination.description}</span>
            </span>
            <span aria-hidden="true" className="text-xl text-[#d7b55a]">→</span>
          </Link>
        ))}
      </section>

      {beginnerOnly ? <AcademyMembershipPanel className="mt-5" /> : null}
    </>
  );
}
