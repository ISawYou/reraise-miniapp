"use client";

import Link from "next/link";
import { type ReactNode, useId, useState } from "react";
import { AcademyPlayingCard } from "@/components/academy/academy-playing-card";
import { PokerPositionTable } from "@/components/academy/poker-position-table";
import { BackButton } from "@/components/ui/back-button";
import type {
  AcademyPreflopTableScene,
  AcademySolverAction,
  AcademySolverPublicAction,
  AcademyTrainingResult,
  RenderedPlayingCard,
} from "@/types/academy";
import { solverActionButtonLabel } from "@/lib/academy/solver-feedback";

/**
 * Presentation shared by the configurable preflop trainer (fixed node + Quick
 * Mix) and the Push/Fold trainer (manual + Quick). Session state, requests and
 * scoring stay in each trainer; this module only renders. Visual order of a
 * question: compact context → big table with the hero's cards on the felt →
 * "Твой ход" → decision buttons.
 */

export const TRAINER_PRIMARY_BUTTON_CLASS =
  "flex min-h-14 w-full items-center justify-center rounded-2xl bg-[#d7b55a] px-5 py-4 text-base font-semibold text-[#11120f] active:bg-[#e2c66f]";
export const TRAINER_SECONDARY_LINK_CLASS =
  "mt-3 flex min-h-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-4 text-base font-medium text-white/75 active:bg-white/[0.07]";

export type TrainerFeedbackTone = "correct" | "incorrect" | "mixed";

export function TrainerSessionTopBar({
  backHref,
  backLabel,
  eyebrow,
  questionIndex,
  total,
}: {
  backHref: string;
  backLabel: string;
  eyebrow?: string;
  questionIndex: number;
  total: number;
}) {
  return (
    <div data-testid="trainer-top-bar">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={backHref}
          data-testid="trainer-back"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/[0.08] px-3 py-1.5 text-sm text-white/65 active:bg-white/[0.06]"
        >
          <span aria-hidden="true">←</span>
          <span>{backLabel}</span>
        </Link>
        <p className="whitespace-nowrap text-sm text-white/50">
          {eyebrow ? <span className="mr-2 text-[#d7b55a]">{eyebrow}</span> : null}
          {questionIndex + 1} из {total}
        </p>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className="h-full rounded-full bg-[#568b70] transition-[width] duration-300"
          style={{ width: `${((questionIndex + 1) / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

/** One compact block of context above the table: title + history, stack as a chip. */
export function TrainerSpotContext({ title, history, stackBb, tag }: { title: string; history: string; stackBb: number; tag?: string }) {
  return (
    <div className="mt-4 flex items-start justify-between gap-3" data-testid="spot-facts">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold leading-6 tracking-tight">{title}</h1>
        <p className="mt-0.5 text-[13px] leading-5 text-white/55">{history}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="rounded-full border border-[#d7b55a]/30 bg-[#d7b55a]/10 px-2.5 py-1 text-xs font-semibold text-[#e4c97a]">
          Стек {stackBb} BB
        </span>
        {tag ? <span className="text-[11px] text-white/45">{tag}</span> : null}
      </div>
    </div>
  );
}

/** The hand scene: the shared table in TRAINING_SCENE mode with the hero's cards on the felt. */
export function TrainerHandScene({
  scene,
  stackBb,
  cards,
  hand,
}: {
  scene: AcademyPreflopTableScene;
  stackBb: number;
  cards: readonly [RenderedPlayingCard, RenderedPlayingCard];
  hand: string;
}) {
  return (
    <div className="-mx-1 mt-2" data-testid="hand-scene">
      <PokerPositionTable
        mode="TRAINING_SCENE"
        scene={scene}
        stackBb={stackBb}
        heroCards={(
          <div className="flex gap-1.5" aria-label={`Рука ${hand}`}>
            <AcademyPlayingCard card={cards[0]} size="sm" />
            <AcademyPlayingCard card={cards[1]} size="sm" />
          </div>
        )}
      />
    </div>
  );
}

export function TrainerDecisionHeader({ hand, children }: { hand: string; children?: ReactNode }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-3">
      <p className="flex items-baseline gap-2">
        <span className="text-base font-semibold text-white" data-testid="your-move">Твой ход</span>
        <span className="text-sm font-medium text-white/45">{hand}</span>
      </p>
      {children}
    </div>
  );
}

export function TrainerActionButtons({
  actions,
  columnsClass,
  reveal,
  mixedTone,
  disabled,
  onAnswer,
}: {
  actions: readonly AcademySolverPublicAction[];
  columnsClass: string;
  reveal: { readonly selectedAction: AcademySolverAction; readonly resolvedAction: AcademySolverAction } | null;
  /** The selected-but-not-resolved button is styled as "mixed" (gold) instead of "wrong" (red). */
  mixedTone?: boolean;
  disabled: boolean;
  onAnswer: (action: AcademySolverAction) => void;
}) {
  return (
    <div className={`mt-3 grid ${columnsClass} gap-3`} data-action-count={actions.length}>
      {actions.map((action) => {
        const isSelected = reveal?.selectedAction === action.code;
        const isResolved = reveal?.resolvedAction === action.code;
        return (
          <button
            key={action.code}
            type="button"
            data-action-code={action.code}
            disabled={Boolean(reveal) || disabled}
            onClick={() => onAnswer(action.code)}
            className={`min-h-16 min-w-0 break-words rounded-2xl border px-3 py-4 text-base font-semibold transition-colors disabled:cursor-default ${
              reveal
                ? isResolved
                  ? "border-[#72b28e] bg-[#315f48] text-white"
                  : isSelected
                    ? mixedTone
                      ? "border-[#d7b55a]/60 bg-[#d7b55a]/15 text-white"
                      : "border-[#b95b5f] bg-[#5b292c] text-white"
                    : "border-white/10 bg-white/[0.045] text-white/45"
                : "border-white/10 bg-white/[0.06] text-white/85 active:bg-white/[0.1]"
            }`}
          >
            {solverActionButtonLabel(action)}
          </button>
        );
      })}
    </div>
  );
}

const TONE_BOX: Record<TrainerFeedbackTone, string> = {
  correct: "border-[#5f9a77]/35 bg-[#315f48]/20",
  mixed: "border-[#d7b55a]/30 bg-[#d7b55a]/10",
  incorrect: "border-[#b95b5f]/30 bg-[#5b292c]/20",
};
const TONE_TITLE: Record<TrainerFeedbackTone, string> = {
  correct: "text-[#9dd2b3]",
  mixed: "text-[#e4c97a]",
  incorrect: "text-[#e0a4a6]",
};

export function TrainerFeedbackPanel({ tone, title, summary, detail }: { tone: TrainerFeedbackTone; title: string; summary: string; detail: string }) {
  return (
    <section className={`mt-5 rounded-[22px] border p-4 ${TONE_BOX[tone]}`} data-feedback-tone={tone}>
      <p className={`text-lg font-semibold ${TONE_TITLE[tone]}`}>{title}</p>
      <p className="mt-2 text-sm font-medium text-white/80">{summary}</p>
      <p className="mt-2 text-sm leading-5 text-white/55">{detail}</p>
    </section>
  );
}

/**
 * One answered question that did not count as correct, built on the client
 * from the reveal the server already returned for it during the session
 * (nothing is stored or fetched for the review).
 */
export type TrainerReviewEntry = {
  readonly questionNumber: number;
  readonly title: string;
  readonly stackBb: number;
  readonly hand: string;
  readonly tone: Exclude<TrainerFeedbackTone, "correct">;
  readonly verdict: string;
  readonly yourAnswer: string;
  readonly expectedLabel: string;
  readonly expectedAnswer: string;
  readonly detail: string;
};

function TrainerReviewList({ entries, id }: { entries: readonly TrainerReviewEntry[]; id: string }) {
  return (
    <ol id={id} className="mt-3 space-y-2.5" data-testid="trainer-review">
      {entries.map((entry) => (
        <li
          key={entry.questionNumber}
          data-review-question={entry.questionNumber}
          data-review-tone={entry.tone}
          className={`rounded-2xl border p-3.5 ${TONE_BOX[entry.tone]}`}
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-white/85">
              Раздача {entry.questionNumber} · {entry.hand}
            </p>
            <p className={`text-xs font-semibold ${TONE_TITLE[entry.tone]}`}>{entry.verdict}</p>
          </div>
          <p className="mt-0.5 text-xs text-white/45">{entry.title} · {entry.stackBb} BB</p>
          <p className="mt-2 text-sm text-white/75">
            Твой ответ: <span className="font-semibold text-white">{entry.yourAnswer}</span>
            {" · "}
            {entry.expectedLabel}: <span className="font-semibold text-[#9dd2b3]">{entry.expectedAnswer}</span>
          </p>
          <p className="mt-1.5 text-xs leading-5 text-white/50">{entry.detail}</p>
        </li>
      ))}
    </ol>
  );
}

export type TrainerCompletionLink = { readonly href: string; readonly label: string; readonly testId: string };

/**
 * Completion screen with an explicit way forward: primary "Пройти ещё раз",
 * secondary "К тренажёрам", optional extra links (e.g. "Настроить ситуацию"),
 * a back button, and "Разобрать ошибки" when there is something to review.
 */
export function TrainerCompletionScreen({
  result,
  passedLabel,
  attemptsLabel,
  newBest,
  onRestart,
  back,
  trainers,
  links = [],
  review,
  footer,
}: {
  result: AcademyTrainingResult;
  passedLabel: string;
  attemptsLabel?: string | null;
  newBest: boolean;
  onRestart: () => void;
  back: { readonly href: string; readonly label: string };
  trainers: TrainerCompletionLink;
  links?: readonly TrainerCompletionLink[];
  review: readonly TrainerReviewEntry[];
  footer?: ReactNode;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewId = useId();
  return (
    <div className="mx-auto max-w-md" data-testid="trainer-completion">
      <BackButton href={back.href} label={back.label} />
      <p className={`mt-6 text-xs font-semibold uppercase tracking-[0.18em] ${result.passed ? "text-[#90c9a8]" : "text-[#d7b55a]"}`}>
        {result.passed ? passedLabel : "Продолжим тренировку"}
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Тренировка завершена</h1>
      <p className="mt-2 text-base text-white/60">{result.feedback}</p>

      <div className="mt-6 flex items-center justify-between rounded-[26px] border border-white/10 bg-white/[0.055] px-6 py-5">
        <div>
          <p className="text-4xl font-bold tracking-tight">
            {result.correctAnswers} <span className="text-white/25">/</span> {result.totalQuestions}
          </p>
          {attemptsLabel ? <p className="mt-1 text-xs text-white/40">{attemptsLabel}</p> : null}
        </div>
        <div className="text-right">
          <p className={`text-2xl font-semibold ${result.passed ? "text-[#90c9a8]" : "text-[#e0c477]"}`}>{result.percentage}%</p>
          {newBest ? <p className="mt-1 text-xs text-[#d7b55a]">Новый лучший результат</p> : null}
        </div>
      </div>

      <button type="button" onClick={onRestart} data-completion-action="restart" className={`mt-6 ${TRAINER_PRIMARY_BUTTON_CLASS}`}>
        Пройти ещё раз
      </button>
      <Link href={trainers.href} data-completion-action={trainers.testId} className={TRAINER_SECONDARY_LINK_CLASS}>
        {trainers.label}
      </Link>
      {links.map((link) => (
        <Link
          key={link.testId}
          href={link.href}
          data-completion-action={link.testId}
          className="mt-2 flex min-h-12 items-center justify-center rounded-2xl px-5 py-3 text-sm font-medium text-white/60 active:bg-white/[0.05]"
        >
          {link.label}
        </Link>
      ))}

      <section className="mt-6 border-t border-white/[0.07] pt-5" aria-label="Разбор раздач">
        {review.length > 0 ? (
          <>
            <button
              type="button"
              data-completion-action="review"
              aria-expanded={reviewOpen}
              aria-controls={reviewId}
              onClick={() => setReviewOpen((open) => !open)}
              className="flex min-h-12 w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm font-semibold text-white/85 active:bg-white/[0.07]"
            >
              <span>Разобрать ошибки · {review.length}</span>
              <span aria-hidden="true" className="text-white/40">{reviewOpen ? "▲" : "▼"}</span>
            </button>
            {reviewOpen ? <TrainerReviewList entries={review} id={reviewId} /> : null}
          </>
        ) : (
          <p className="text-center text-sm text-white/50" data-testid="trainer-review-empty">
            Все решения совпали со стратегией — разбирать нечего.
          </p>
        )}
      </section>

      {footer}
    </div>
  );
}
