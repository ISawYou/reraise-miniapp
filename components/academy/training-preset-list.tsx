"use client";

import Link from "next/link";
import { useAcademyProgress } from "@/components/academy/use-academy-progress";
import type { AcademySpotProgress } from "@/features/academy";

/** One ready-made training as resolved on the server (real node only). */
export type TrainingPresetCard = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly href: string;
  readonly stackBb: number;
  readonly hero: string;
  readonly villain?: string;
  /** false = study only (Push/Fold), nothing is scored. */
  readonly scored: boolean;
  /** Spot-progress code when this preset's practice is tracked. */
  readonly progressCode?: string;
};

function Chip({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-white/60">
      {children}
    </span>
  );
}

function presetStatus(progress: AcademySpotProgress | undefined): { text: string; passed: boolean } | null {
  if (!progress || progress.attemptsCount === 0) return null;
  return progress.passed
    ? { text: `Пройдено · ${progress.bestScorePercent}%`, passed: true }
    : { text: `Лучший: ${progress.bestScorePercent}%`, passed: false };
}

/**
 * "Готовые тренировки": each card is ONE link into the existing trainer route
 * of its node. Facts (stack, seats) come from the server-resolved node, so the
 * player sees at a glance how the trainings differ.
 */
export function TrainingPresetList({ presets }: { presets: readonly TrainingPresetCard[] }) {
  const { data } = useAcademyProgress();
  const byCode = new Map((data?.spots ?? []).map((spot) => [spot.code, spot]));
  return (
    <ul className="mt-3 space-y-2" data-testid="training-presets">
      {presets.map((preset) => {
        const status = preset.progressCode ? presetStatus(byCode.get(preset.progressCode)) : null;
        return (
          <li key={preset.id}>
            <Link
              href={preset.href}
              data-training-preset={preset.id}
              data-preset-scored={preset.scored ? "true" : "false"}
              className="flex items-center gap-3 rounded-[20px] border border-white/10 bg-white/[0.045] px-4 py-3.5 active:bg-white/[0.08]"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[16px] font-semibold leading-5">{preset.title}</span>
                  {status ? (
                    <span
                      data-preset-status={status.passed ? "passed" : "started"}
                      className={`shrink-0 text-[11px] font-semibold ${status.passed ? "text-[#90c9a8]" : "text-white/45"}`}
                    >
                      {status.text}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[13px] leading-5 text-white/55">{preset.description}</span>
                <span className="mt-2 flex flex-wrap gap-1.5">
                  <Chip>{`${preset.stackBb} BB`}</Chip>
                  <Chip>{`ты: ${preset.hero}`}</Chip>
                  {preset.villain ? <Chip>{`соперник: ${preset.villain}`}</Chip> : null}
                  {preset.scored ? null : <Chip>без оценки</Chip>}
                </span>
              </span>
              <span aria-hidden="true" className="shrink-0 text-lg text-white/35">→</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
