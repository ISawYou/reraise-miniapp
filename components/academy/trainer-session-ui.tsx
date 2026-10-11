"use client";

import Link from "next/link";
import { forwardRef, type ReactNode, useId, useState } from "react";
import { AcademyPlayingCard } from "@/components/academy/academy-playing-card";
import { PokerPositionTable } from "@/components/academy/poker-position-table";
import { BackButton } from "@/components/ui/back-button";
import type {
  AcademyPreflopTableScene,
  AcademySolverAction,
  AcademySolverPublicAction,
  AcademyStrategyHandFrequencies,
  AcademyTrainingResult,
  RenderedPlayingCard,
} from "@/types/academy";
import { formatSolverFrequencyPercent, solverActionButtonLabel } from "@/lib/academy/solver-feedback";

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

/**
 * `valid` = a mixed-strategy action other than the randomizer's pick: counted
 * as correct and styled like "correct" (never red). `mixed` is kept for the
 * legacy gold look.
 */
export type TrainerFeedbackTone = "correct" | "valid" | "incorrect" | "mixed";

/**
 * Bottom clearance of the app's fixed bottom nav (its 10px offset + ~68px
 * height + 8px gap) plus the device's bottom safe area. The sticky next-step
 * bar sits exactly above it.
 */
export const TRAINER_BOTTOM_NAV_CLEARANCE = "calc(env(safe-area-inset-bottom, 0px) + 86px)";

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
        fitViewport
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

/** What the action buttons show after the server revealed the answer. */
export type TrainerActionReveal = {
  readonly selectedAction: AcademySolverAction;
  readonly frequencies: AcademyStrategyHandFrequencies;
  /** Server-computed: the verifier counts the selected action as correct. */
  readonly countsAsCorrect: boolean;
};

/**
 * Decision buttons. After the answer every button shows its strategy
 * frequency (the primary feedback); actions the strategy plays get a green
 * outline, the chosen one is filled — green when it counts as correct, red
 * only when the strategy never plays it (0%). The randomizer's pick is not
 * highlighted here: it is secondary information in the feedback text.
 */
export function TrainerActionButtons({
  actions,
  columnsClass,
  reveal,
  disabled,
  onAnswer,
}: {
  actions: readonly AcademySolverPublicAction[];
  columnsClass: string;
  reveal: TrainerActionReveal | null;
  disabled: boolean;
  onAnswer: (action: AcademySolverAction) => void;
}) {
  return (
    <div className={`mt-3 grid ${columnsClass} gap-3`} data-action-count={actions.length}>
      {actions.map((action) => {
        const isSelected = reveal?.selectedAction === action.code;
        const frequency = reveal ? reveal.frequencies[action.code] ?? 0 : 0;
        const inStrategy = frequency > 0;
        return (
          <button
            key={action.code}
            type="button"
            data-action-code={action.code}
            data-action-frequency={reveal ? frequency : undefined}
            data-action-selected={reveal && isSelected ? (reveal.countsAsCorrect ? "correct" : "incorrect") : undefined}
            disabled={Boolean(reveal) || disabled}
            onClick={() => onAnswer(action.code)}
            className={`flex min-h-16 min-w-0 flex-col items-center justify-center break-words rounded-2xl border px-3 py-3 text-base font-semibold transition-colors disabled:cursor-default ${
              reveal
                ? isSelected
                  ? reveal.countsAsCorrect
                    ? "border-[#72b28e] bg-[#315f48] text-white"
                    : "border-[#b95b5f] bg-[#5b292c] text-white"
                  : inStrategy
                    ? "border-[#72b28e]/45 bg-white/[0.045] text-white/80"
                    : "border-white/10 bg-white/[0.03] text-white/40"
                : "border-white/10 bg-white/[0.06] text-white/85 active:bg-white/[0.1]"
            }`}
          >
            <span>{solverActionButtonLabel(action)}</span>
            {reveal ? (
              <span className="mt-0.5 text-xs font-semibold tabular-nums opacity-80" data-testid="action-frequency">
                {formatSolverFrequencyPercent(frequency)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

const TONE_BOX: Record<TrainerFeedbackTone, string> = {
  correct: "border-[#5f9a77]/35 bg-[#315f48]/20",
  valid: "border-[#5f9a77]/35 bg-[#315f48]/20",
  mixed: "border-[#d7b55a]/30 bg-[#d7b55a]/10",
  incorrect: "border-[#b95b5f]/30 bg-[#5b292c]/20",
};
const TONE_TITLE: Record<TrainerFeedbackTone, string> = {
  correct: "text-[#9dd2b3]",
  valid: "text-[#9dd2b3]",
  mixed: "text-[#e4c97a]",
  incorrect: "text-[#e0a4a6]",
};

/**
 * Compact post-answer feedback: a title and AT MOST ~2 short lines (`summary`,
 * plus an optional secondary `note`, e.g. the randomizer explanation). The
 * longer `detail` sits behind "Подробнее" (collapsed by default) so the
 * next-step button is never pushed off screen by an explanation.
 */
export const TrainerFeedbackPanel = forwardRef<HTMLElement, {
  tone: TrainerFeedbackTone;
  title: string;
  summary: string;
  note?: string | null;
  detail?: string | null;
}>(function TrainerFeedbackPanel({ tone, title, summary, note, detail }, ref) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return (
    <section
      ref={ref}
      className={`mt-4 rounded-[22px] border p-4 ${TONE_BOX[tone]}`}
      data-feedback-tone={tone}
      style={{ scrollMarginBottom: `calc(${TRAINER_BOTTOM_NAV_CLEARANCE} + 96px)` }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className={`text-lg font-semibold ${TONE_TITLE[tone]}`} data-testid="feedback-title">{title}</p>
        {detail ? (
          <button
            type="button"
            data-testid="feedback-more"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((value) => !value)}
            className="shrink-0 text-xs font-semibold text-white/55 underline decoration-white/25 underline-offset-2"
          >
            {open ? "Свернуть" : "Подробнее"}
          </button>
        ) : null}
      </div>
      <p className="mt-1.5 text-sm font-medium leading-5 text-white/85" data-testid="feedback-summary">{summary}</p>
      {note ? <p className="mt-1 text-[13px] leading-5 text-white/50" data-testid="feedback-note">{note}</p> : null}
      {detail && open ? (
        <p id={detailId} className="mt-2 text-[13px] leading-5 text-white/55" data-testid="feedback-detail">{detail}</p>
      ) : null}
    </section>
  );
});

/**
 * "Следующая рука" / "Посмотреть результат": sticky at the bottom of the
 * visible viewport, just above the app's bottom nav (and the bottom safe
 * area), so it is reachable right after answering however long the feedback
 * is. It sits after the feedback in the DOM and never overlaps the action
 * buttons on arrival (the feedback is scrolled into view above it).
 */
export function TrainerNextBar({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="trainer-next-bar"
      className="sticky z-20 -mx-4 mt-3 bg-[linear-gradient(180deg,rgba(7,7,7,0),rgba(7,7,7,0.92)_30%)] px-4 pb-2 pt-4"
      style={{ bottom: TRAINER_BOTTOM_NAV_CLEARANCE }}
    >
      {children}
    </div>
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
  readonly tone: Exclude<TrainerFeedbackTone, "correct" | "valid">;
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

function decisionsWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "решение";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "решения";
  return "решений";
}

/** "2 решения отличались от рандомайзера, но входили в стратегию." */
export function validMixedNote(count: number): string {
  return count === 1
    ? "1 решение отличалось от рандомайзера, но входило в стратегию — оно засчитано."
    : `${count} ${decisionsWord(count)} отличались от рандомайзера, но входили в стратегию — они засчитаны.`;
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
  validMixedCount = 0,
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
  /**
   * Answers that differed from the randomizer but were part of the strategy
   * (counted as correct). Shown as a neutral observation — never a mistake.
   */
  validMixedCount?: number;
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

      {validMixedCount > 0 ? (
        <p className="mt-5 text-center text-sm leading-5 text-white/55" data-testid="trainer-valid-mixed-note">
          {validMixedNote(validMixedCount)}
        </p>
      ) : null}

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
            Все решения входят в стратегию — разбирать нечего.
          </p>
        )}
      </section>

      {footer}
    </div>
  );
}
