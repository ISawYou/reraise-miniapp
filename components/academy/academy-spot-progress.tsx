"use client";

import Link from "next/link";
import { useAcademyProgress } from "@/components/academy/use-academy-progress";
import type { AcademySpotProgress } from "@/features/academy";

/** Passed / total over an explicit list of tracked spot codes (no defaults). */
export function countPassedSpots(spots: readonly AcademySpotProgress[] | undefined, codes: readonly string[]): { passed: number; total: number } {
  const wanted = new Set(codes);
  const passed = new Set((spots ?? []).filter((spot) => spot.passed && wanted.has(spot.code)).map((spot) => spot.code));
  return { passed: passed.size, total: wanted.size };
}

export function spotStatusLabel(progress: AcademySpotProgress | undefined): { text: string; tone: "passed" | "started" | "new" } {
  if (!progress || progress.attemptsCount === 0) return { text: "Не начато", tone: "new" };
  return progress.passed
    ? { text: `Пройдено · ${progress.bestScorePercent}%`, tone: "passed" }
    : { text: `Лучший результат: ${progress.bestScorePercent}%`, tone: "started" };
}

const TONE_CLASS = { passed: "text-[#90c9a8]", started: "text-white/55", new: "text-white/40" } as const;

type SpotProgressState = {
  readonly spots: readonly AcademySpotProgress[] | undefined;
  readonly loaded: boolean;
  readonly error: string | null;
  readonly retry: () => void;
};

/** "X из N" bar over tracked spot codes (pure view; data comes from the caller). */
function SpotProgressSummaryView({ state, codes, label, testId }: { state: SpotProgressState; codes: readonly string[]; label: string; testId: string }) {
  const { passed, total } = countPassedSpots(state.spots, codes);
  const percent = total === 0 ? 0 : Math.round((passed / total) * 100);
  return (
    <section
      className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3.5"
      data-testid={testId}
      data-spot-passed={state.loaded ? passed : undefined}
      data-spot-total={total}
    >
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-white/75">{label}</span>
        <span className="text-white/55">{state.loaded ? `${passed} из ${total}` : state.error ? "" : "Загрузка..."}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div className="h-full rounded-full bg-[#568b70] transition-[width] duration-300" style={{ width: `${state.loaded ? percent : 0}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-white/40">
        <span>Засчитывается после тренировки на 80% и выше</span>
        {state.error ? <button type="button" onClick={state.retry} className="shrink-0 text-[#d7b55a]">Повторить</button> : null}
      </div>
    </section>
  );
}

function useSpotProgressState(): SpotProgressState {
  const { data, error, retry } = useAcademyProgress();
  return { spots: data?.spots, loaded: Boolean(data), error, retry };
}

/** "Пройдено X из N" bar fed by the additive `spots` progress list. */
export function AcademySpotProgressSummary({ codes, label, testId }: { codes: readonly string[]; label: string; testId: string }) {
  return <SpotProgressSummaryView state={useSpotProgressState()} codes={codes} label={label} testId={testId} />;
}

export type AcademyAdvancedSpotCard = {
  readonly code: string;
  readonly topic: string;
  readonly meta: string;
  readonly studyHref: string;
  readonly trainHref: string;
  readonly nodeKey: string;
};

/** "Продвинутым": progress summary + one card per real tracked spot (train + range). */
export function AcademyAdvancedSpotList({ spots }: { spots: readonly AcademyAdvancedSpotCard[] }) {
  const state = useSpotProgressState();
  const byCode = new Map((state.spots ?? []).map((spot) => [spot.code, spot]));
  return (
    <>
      <SpotProgressSummaryView state={state} codes={spots.map((spot) => spot.code)} label="Твой прогресс" testId="advanced-progress" />
      <ul className="mt-4 space-y-2.5">
        {spots.map((spot) => {
          const status = state.loaded ? spotStatusLabel(byCode.get(spot.code)) : null;
          return (
            <li
              key={spot.code}
              data-advanced-study={spot.nodeKey}
              data-spot-status={status?.tone}
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3.5"
            >
              <p className="text-[15px] font-semibold leading-5">{spot.topic}</p>
              <p className="mt-0.5 text-xs text-white/45">{spot.meta}</p>
              {status ? <p className={`mt-1.5 text-xs font-medium ${TONE_CLASS[status.tone]}`}>{status.text}</p> : null}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Link
                  href={spot.trainHref}
                  data-advanced-train={spot.nodeKey}
                  className="flex min-h-11 items-center justify-center rounded-xl bg-[#d7b55a] px-3 text-sm font-semibold text-[#11120f] active:bg-[#e2c66f]"
                >
                  Тренироваться
                </Link>
                <Link
                  href={spot.studyHref}
                  data-advanced-range={spot.nodeKey}
                  className="flex min-h-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-white/75 active:bg-white/[0.08]"
                >
                  Диапазон
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export type AcademyStepLessonCard = {
  readonly slug: string;
  readonly order: number;
  readonly title: string;
  readonly subtitle: string;
  readonly href: string;
  /** Spot-progress code of the lesson's practice node. */
  readonly progressCode: string;
};

/**
 * "Новичкам · Шаг 2" lesson list with progress: a lesson counts once its own
 * ready-made training (the lesson's node) scored ≥ 80%. These lessons stay
 * OUTSIDE the catalog, so База MTT's "X из 7" never changes.
 */
export function AcademyStepLessonList({ lessons }: { lessons: readonly AcademyStepLessonCard[] }) {
  const state = useSpotProgressState();
  const byCode = new Map((state.spots ?? []).map((spot) => [spot.code, spot]));
  return (
    <>
      <div className="mt-5">
        <SpotProgressSummaryView state={state} codes={lessons.map((lesson) => lesson.progressCode)} label="Прогресс шага" testId="step-two-progress" />
      </div>
      <div className="mt-4 space-y-2.5">
        {lessons.map((lesson) => {
          const status = state.loaded ? spotStatusLabel(byCode.get(lesson.progressCode)) : null;
          return (
            <Link
              key={lesson.slug}
              href={lesson.href}
              data-after-open-lesson={lesson.slug}
              data-spot-status={status?.tone}
              className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3.5 active:bg-white/[0.09]"
            >
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${status?.tone === "passed" ? "bg-[#4f8f6c]" : "bg-[#315f48]"}`}>
                {status?.tone === "passed" ? "✓" : lesson.order}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-semibold leading-6 text-white">{lesson.title}</span>
                <span className="mt-0.5 block text-[13px] leading-5 text-white/50">{lesson.subtitle}</span>
                {status && status.tone !== "new" ? (
                  <span className={`mt-0.5 block text-xs font-medium ${TONE_CLASS[status.tone]}`}>{status.text}</span>
                ) : null}
              </span>
              <span aria-hidden="true" className="text-lg text-white/35">→</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
