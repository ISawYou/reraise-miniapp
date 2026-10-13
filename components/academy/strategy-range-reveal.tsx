"use client";

import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { SolverActionMixGrid } from "@/components/academy/SolverActionMixGrid";
import { TRAINER_NEXT_BAR_SCROLL_MARGIN_BOTTOM } from "@/components/academy/trainer-session-ui";
import { formatStrategyHandFrequencyLine, type AcademySolverActionCopySource } from "@/lib/academy/solver-feedback";
import type {
  AcademySolverPublicAction,
  AcademyStrategyNodeHands,
  StartingHandClass,
} from "@/types/academy";

type RangeAction = Pick<AcademySolverPublicAction, "code" | "kind" | "label" | "ru"> & AcademySolverActionCopySource;

/**
 * Post-answer range of the spot just answered: the node's REAL 13x13 strategy
 * (the reveal's `rangeHands`, i.e. the server-resolved node — never fetched or
 * recomputed on the client) in the one shared `SolverActionMixGrid` model,
 * with the dealt hand gold-ringed and a tap-to-inspect summary. Mount it with
 * a per-question `key` so the inspector starts on the dealt hand.
 */
export function StrategyRangeReveal({
  hands,
  actions,
  dealtHand,
  spotTitle,
  stackBb,
}: {
  hands: AcademyStrategyNodeHands;
  /** The node's actions in resolver order (same objects the action buttons use). */
  actions: readonly RangeAction[];
  dealtHand: StartingHandClass;
  /** Human-readable spot title from the existing spot copy (e.g. "BB против BTN"). */
  spotTitle: string;
  stackBb: number;
}) {
  const [inspected, setInspected] = useState<StartingHandClass>(dealtHand);
  const inspectingDealt = inspected === dealtHand;
  const inspectorRef = useRef<HTMLDivElement>(null);
  const tapped = useRef(false);
  // After a tap (never on mount), make sure the updated summary is visible
  // above the sticky next-step bar — a minimal scroll, only when hidden.
  useEffect(() => {
    const inspector = inspectorRef.current;
    if (tapped.current && inspector && typeof inspector.scrollIntoView === "function") {
      inspector.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [inspected]);
  const inspect = (hand: StartingHandClass) => {
    tapped.current = true;
    setInspected(hand);
  };
  const line = formatStrategyHandFrequencyLine(hands[inspected] ?? {}, actions, "strategy");

  return (
    <section className="mt-4" data-testid="answer-range" aria-label="Диапазон этого спота">
      <h2 className="text-base font-semibold leading-6 text-white">Диапазон этого спота</h2>
      <p className="mb-2.5 text-[13px] leading-5 text-white/55" data-testid="answer-range-spot">
        {spotTitle} · {stackBb} BB
      </p>
      <SolverActionMixGrid
        hands={hands}
        label={`Диапазон: ${spotTitle} · ${stackBb} BB. Нажми на руку, чтобы увидеть её частоты`}
        actions={actions}
        dealtHand={dealtHand}
        inspectedHand={inspected}
        onInspect={inspect}
        belowGrid={(
          <div
            ref={inspectorRef}
            style={{ scrollMarginBottom: TRAINER_NEXT_BAR_SCROLL_MARGIN_BOTTOM }}
            className="mt-2.5 flex min-h-[52px] items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2"
            data-testid="range-inspector"
            data-inspected-hand={inspected}
            aria-live="polite"
          >
            <div className="min-w-0">
              <p className="flex items-baseline gap-2">
                <span className="text-base font-semibold text-white" data-testid="range-inspector-hand">{inspected}</span>
                {inspectingDealt ? <span className="text-[11px] font-medium text-[#e4c97a]">твоя рука</span> : null}
              </p>
              <p className="text-[13px] leading-5 tabular-nums text-white/80" data-testid="range-inspector-frequencies">
                {line || "—"}
              </p>
            </div>
            {inspectingDealt ? null : (
              <button
                type="button"
                onClick={() => inspect(dealtHand)}
                data-testid="range-inspector-reset"
                className="shrink-0 rounded-full border border-[#d7b55a]/35 px-3 py-1.5 text-xs font-semibold text-[#e4c97a] active:bg-[#d7b55a]/10"
              >
                К {dealtHand}
              </button>
            )}
          </div>
        )}
      />
      <p className="mt-2 flex items-center gap-2 text-xs text-white/55" data-testid="answer-range-dealt-legend">
        <span aria-hidden="true" className="inline-block h-3 w-3 rounded-[3px] shadow-[inset_0_0_0_2px_#e4c97a]" />
        Золотая рамка — твоя рука
      </p>
    </section>
  );
}

/**
 * Compact "Подробнее" / "Скрыть подробности" disclosure around the post-answer
 * range. Presentation only: the parent owns `open` (closed after every answer
 * and reset on "Следующая рука"), and the 169-cell `StrategyRangeReveal` is
 * not mounted at all while closed, so the normal flow stays fast.
 */
export function StrategyRangeDetails({
  open,
  onToggle,
  ...range
}: { open: boolean; onToggle: () => void } & ComponentProps<typeof StrategyRangeReveal>) {
  const detailsId = useId();
  return (
    <div data-testid="answer-range-details" data-open={open ? "true" : "false"}>
      <button
        type="button"
        data-testid="answer-range-toggle"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={onToggle}
        className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[13px] font-semibold text-white/75 active:bg-white/[0.08]"
      >
        {open ? "Скрыть подробности" : "Подробнее"}
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={`h-3.5 w-3.5 ${open ? "rotate-180" : ""}`}
          data-testid="answer-range-chevron"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open ? (
        <div id={detailsId}>
          <StrategyRangeReveal {...range} />
        </div>
      ) : null}
    </div>
  );
}
