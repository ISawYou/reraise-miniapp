"use client";

import Link from "next/link";
import { forwardRef, type ReactNode, useId, useState } from "react";
import { AcademyPlayingCard } from "@/components/academy/academy-playing-card";
import { type AcademyTablePresentation, PokerPositionTable } from "@/components/academy/poker-position-table";
import { BackButton } from "@/components/ui/back-button";
import type {
  AcademyPreflopTableMoney,
  AcademyPreflopTableScene,
  AcademySolverAction,
  AcademySolverPublicAction,
  AcademyStrategyAnswerOutcome,
  AcademyStrategyAnswerPoints,
  AcademyStrategyHandFrequencies,
  AcademyTrainingResult,
  RenderedPlayingCard,
} from "@/types/academy";
import { formatSolverFrequencyPercent, solverActionButtonLabel } from "@/lib/academy/solver-feedback";
import { isWeightedTrainingResult } from "@/lib/academy/strategy-answer";

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
 * `correct` = primary action (+1, green). `valid` = a supported alternative
 * (+0.5): a calm steel-blue state — never red, and deliberately not gold,
 * which already marks the hero's seat ("Ты") and the primary CTA. `mixed` is
 * kept for the legacy gold look.
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
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/[0.08] px-3 py-1.5 text-sm text-white/65 active:bg-white/[0.06]"
        >
          <span aria-hidden="true">←</span>
          <span>{backLabel}</span>
        </Link>
        <p className="flex min-w-0 items-baseline whitespace-nowrap text-sm text-white/50">
          {eyebrow ? <span className="mr-2 min-w-0 truncate text-[#d7b55a]" data-testid="trainer-eyebrow">{eyebrow}</span> : null}
          <span className="shrink-0">{questionIndex + 1} из {total}</span>
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

/**
 * The hand scene: the shared table in TRAINING_SCENE mode with the hero's
 * cards on the felt. `presentation` defaults to BASIC (plain table); only an
 * explicit ADVANCED caller with a trusted `table` gets stacks / chips / pot.
 */
export function TrainerHandScene({
  scene,
  stackBb,
  cards,
  hand,
  presentation = "BASIC",
  table,
}: {
  scene: AcademyPreflopTableScene;
  stackBb: number;
  cards: readonly [RenderedPlayingCard, RenderedPlayingCard];
  hand: string;
  presentation?: AcademyTablePresentation;
  table?: AcademyPreflopTableMoney;
}) {
  return (
    <div className="-mx-1 mt-2" data-testid="hand-scene">
      <PokerPositionTable
        mode="TRAINING_SCENE"
        fitViewport
        scene={scene}
        stackBb={stackBb}
        presentation={presentation}
        table={table}
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
  /** Server-computed: the selected action earns points (> 0%). */
  readonly countsAsCorrect: boolean;
  /** Server-computed weighted outcome (normal practice); absent → binary look. */
  readonly outcome?: AcademyStrategyAnswerOutcome;
  /** Server-computed highest-frequency action(s); labelled "основное" on mixed hands. */
  readonly primaryActions?: readonly AcademySolverAction[];
};

/** `data-action-selected` / colour of the chosen button. */
function selectedActionState(reveal: TrainerActionReveal): "correct" | "alternative" | "incorrect" {
  if (!reveal.countsAsCorrect) return "incorrect";
  return reveal.outcome === "SUPPORTED_ALTERNATIVE" ? "alternative" : "correct";
}

const SELECTED_ACTION_CLASS: Record<ReturnType<typeof selectedActionState>, string> = {
  correct: "border-[#72b28e] bg-[#315f48] text-white",
  alternative: "border-[#7ea3c4] bg-[#2c4358] text-white",
  incorrect: "border-[#b95b5f] bg-[#5b292c] text-white",
};

/**
 * Decision buttons. After the answer every button shows its strategy
 * frequency (the primary feedback); actions the strategy plays get a green
 * outline, and on a mixed hand the highest-frequency action(s) are labelled
 * "основное". The chosen one is filled — green for the primary action,
 * steel-blue for a supported alternative (+0.5), red only when the strategy
 * never plays it (0%). The randomizer's pick is not highlighted here: it is
 * secondary information in the feedback text.
 * `presentation="ADVANCED"` shows the trusted size ("3-бет до 9.2 BB",
 * "Колл 18 BB") where the action carries one; BASIC (default) and any action
 * without trusted sizing keep the generic label.
 */
export function trainerActionButtonLabel(action: AcademySolverPublicAction, presentation: AcademyTablePresentation = "BASIC"): string {
  return presentation === "ADVANCED" && action.sizing ? action.sizing.button : solverActionButtonLabel(action);
}

/**
 * Keeps a trailing amount ("1.3 BB", "до 9.2 BB") on one line so a wrapped
 * label never orphans "BB" (same text content; layout only).
 */
function TrainerActionLabel({ label }: { label: string }) {
  const match = label.match(/^(.*?)\s((?:до\s)?[\d.]+\sBB)$/);
  if (!match) return <span>{label}</span>;
  return <span>{match[1]} <span className="whitespace-nowrap">{match[2]}</span></span>;
}

export function TrainerActionButtons({
  actions,
  columnsClass,
  reveal,
  disabled,
  onAnswer,
  presentation = "BASIC",
}: {
  actions: readonly AcademySolverPublicAction[];
  columnsClass: string;
  reveal: TrainerActionReveal | null;
  disabled: boolean;
  onAnswer: (action: AcademySolverAction) => void;
  presentation?: AcademyTablePresentation;
}) {
  return (
    <div className={`mt-3 grid ${columnsClass} gap-3`} data-action-count={actions.length}>
      {actions.map((action) => {
        const isSelected = reveal?.selectedAction === action.code;
        const frequency = reveal ? reveal.frequencies[action.code] ?? 0 : 0;
        const inStrategy = frequency > 0;
        const mixedHand = reveal ? actions.filter((candidate) => (reveal.frequencies[candidate.code] ?? 0) > 0).length > 1 : false;
        const isPrimary = mixedHand && Boolean(reveal?.primaryActions?.includes(action.code));
        return (
          <button
            key={action.code}
            type="button"
            data-action-code={action.code}
            data-action-frequency={reveal ? frequency : undefined}
            data-action-selected={reveal && isSelected ? selectedActionState(reveal) : undefined}
            data-action-primary={isPrimary ? "true" : undefined}
            disabled={Boolean(reveal) || disabled}
            onClick={() => onAnswer(action.code)}
            className={`flex min-h-16 min-w-0 flex-col items-center justify-center break-words rounded-2xl border px-3 py-3 text-base font-semibold transition-colors disabled:cursor-default ${
              reveal
                ? isSelected
                  ? SELECTED_ACTION_CLASS[selectedActionState(reveal)]
                  : inStrategy
                    ? "border-[#72b28e]/45 bg-white/[0.045] text-white/80"
                    : "border-white/10 bg-white/[0.03] text-white/40"
                : "border-white/10 bg-white/[0.06] text-white/85 active:bg-white/[0.1]"
            }`}
          >
            <TrainerActionLabel label={trainerActionButtonLabel(action, presentation)} />
            {reveal ? (
              <span className="mt-0.5 text-xs font-semibold tabular-nums opacity-80" data-testid="action-frequency">
                {formatSolverFrequencyPercent(frequency)}
                {isPrimary ? <span className="font-medium" data-testid="action-primary"> · основное</span> : null}
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
  valid: "border-[#7ea3c4]/35 bg-[#2c4358]/25",
  mixed: "border-[#d7b55a]/30 bg-[#d7b55a]/10",
  incorrect: "border-[#b95b5f]/30 bg-[#5b292c]/20",
};
const TONE_TITLE: Record<TrainerFeedbackTone, string> = {
  correct: "text-[#9dd2b3]",
  valid: "text-[#b3cde4]",
  mixed: "text-[#e4c97a]",
  incorrect: "text-[#e0a4a6]",
};

/** The next-step button: a little lower than the primary CTA, so verdict + CTA fit without scrolling. */
export const TRAINER_NEXT_BUTTON_CLASS =
  "flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#d7b55a] px-5 py-3 text-base font-semibold text-[#11120f] active:bg-[#e2c66f] disabled:opacity-70";

const TONE_MARK: Record<TrainerFeedbackTone, string | null> = { correct: "✓", valid: "✓", mixed: null, incorrect: null };

const POINTS_BADGE: Record<TrainerFeedbackTone, string> = {
  correct: "bg-[#315f48]/70 text-[#cdebd9]",
  valid: "bg-[#2c4358]/80 text-[#d3e3f1]",
  mixed: "bg-[#d7b55a]/15 text-[#e4c97a]",
  incorrect: "bg-white/[0.07] text-white/60",
};

/** "+1" / "+0.5" / "+0". */
export function formatAnswerPoints(points: AcademyStrategyAnswerPoints): string {
  return `+${points}`;
}

/**
 * Compact post-answer feedback (v2): one title row (✓ + verdict, plus the
 * server-computed points badge "+1" / "+0.5" / "+0" when the trainer scores
 * with weighted points) and ONE short paragraph — the `summary` with the
 * optional randomizer `note` flowing inline after it. The longer `detail`
 * sits behind "Подробнее" (collapsed by default). Copy comes unchanged from
 * the feedback builders; only the layout is tighter, so the next-step bar is
 * reached with less scrolling.
 */
export const TrainerFeedbackPanel = forwardRef<HTMLElement, {
  tone: TrainerFeedbackTone;
  title: string;
  summary: string;
  note?: string | null;
  detail?: string | null;
  /** Server-computed points of the answer (weighted normal practice). */
  points?: AcademyStrategyAnswerPoints;
}>(function TrainerFeedbackPanel({ tone, title, summary, note, detail, points }, ref) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const mark = TONE_MARK[tone];
  return (
    <section
      ref={ref}
      className={`mt-3 rounded-[18px] border px-3.5 py-3 ${TONE_BOX[tone]}`}
      data-feedback-tone={tone}
      data-feedback-layout="compact"
      style={{ scrollMarginBottom: `calc(${TRAINER_BOTTOM_NAV_CLEARANCE} + 76px)` }}
    >
      <p className={`flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-base font-semibold leading-6 ${TONE_TITLE[tone]}`}>
        {mark ? <span aria-hidden="true" data-testid="feedback-mark">{mark}</span> : null}
        <span data-testid="feedback-title">{title}</span>
        {points !== undefined ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 tabular-nums ${POINTS_BADGE[tone]}`}
            data-testid="feedback-points"
          >
            {formatAnswerPoints(points)}
          </span>
        ) : null}
      </p>
      <p className="mt-1 text-[13px] leading-[18px] text-white/80">
        <span className="font-medium" data-testid="feedback-summary">{summary}</span>
        {note ? <>{" "}<span className="text-white/50" data-testid="feedback-note">{note}</span></> : null}
        {detail ? (
          <>
            {" "}
            <button
              type="button"
              data-testid="feedback-more"
              aria-expanded={open}
              aria-controls={detailId}
              onClick={() => setOpen((value) => !value)}
              className="inline text-xs font-semibold text-white/55 underline decoration-white/25 underline-offset-2"
            >
              {open ? "Свернуть" : "Подробнее"}
            </button>
          </>
        ) : null}
      </p>
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
 * buttons on arrival (the feedback is scrolled into view above it). v2: a
 * slimmer bar (shorter fade, 48px button).
 */
export function TrainerNextBar({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="trainer-next-bar"
      className="sticky z-20 -mx-4 mt-2 bg-[linear-gradient(180deg,rgba(7,7,7,0),rgba(7,7,7,0.94)_35%)] px-4 pb-1.5 pt-2.5"
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

/**
 * Completion summary of a weighted session: supported alternatives are listed
 * apart from mistakes and never framed as one.
 * e.g. "Допустимых альтернатив: 2 (по +0.5) · Ошибок: 1".
 */
export function weightedSessionBreakdown(supportedAlternatives: number, mistakes: number): string {
  return `Допустимых альтернатив: ${supportedAlternatives} (по +0.5) · Ошибок: ${mistakes}`;
}

/** "8.5" / "10" — the session score in points. */
export function formatSessionScore(result: AcademyTrainingResult): string {
  return String(isWeightedTrainingResult(result) ? result.scorePoints : result.correctAnswers);
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
  /** Only 0-point answers ("Не входит в стратегию"); never a supported alternative. */
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
          <p className="text-4xl font-bold tracking-tight" data-testid="trainer-score">
            {formatSessionScore(result)} <span className="text-white/25">/</span> {result.totalQuestions}
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

      {isWeightedTrainingResult(result) && result.supportedAlternativeAnswers > 0 ? (
        <p className="mt-5 text-center text-sm leading-5 text-white/55" data-testid="trainer-score-breakdown">
          {weightedSessionBreakdown(result.supportedAlternativeAnswers, result.notInStrategyAnswers)}
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
