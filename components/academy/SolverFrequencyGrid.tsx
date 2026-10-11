import { CANONICAL_STARTING_HANDS } from "@/lib/academy/preflop";
import {
  formatSolverFrequencyPercent,
  solverActionShortLabel,
  type AcademySolverActionCopySource,
} from "@/lib/academy/solver-feedback";
import type {
  AcademyStrategyHandFrequencies,
  AcademyStrategyNodeHands,
  StartingHandClass,
} from "@/types/academy";

type SolverFrequencyGridProps = {
  hands: AcademyStrategyNodeHands;
  label: string;
  /** The node's action definitions, in resolver order (aria copy comes from here). */
  actions: readonly AcademySolverActionCopySource[];
  /** Action whose frequency fills the cell (the open-raise for RFI). */
  primaryAction?: string;
};

export type SolverGridCellKind = "PURE_RAISE" | "MIXED" | "PURE_FOLD";

/**
 * Cell kind from the primary action's frequency; aria-label lists every
 * action with a non-zero frequency, e.g. "AJo: рейз 41%, фолд 59%".
 */
export function describeSolverGridCell(
  hand: StartingHandClass,
  frequencies: AcademyStrategyHandFrequencies,
  actions: readonly AcademySolverActionCopySource[],
  primaryAction: string,
): { kind: SolverGridCellKind; ariaLabel: string } {
  const primary = frequencies[primaryAction] ?? 0;
  const kind: SolverGridCellKind = primary >= 1 ? "PURE_RAISE" : primary <= 0 ? "PURE_FOLD" : "MIXED";
  const parts = actions
    .filter((action) => (frequencies[action.code] ?? 0) > 0)
    .map((action) => `${solverActionShortLabel(action)} ${formatSolverFrequencyPercent(frequencies[action.code])}`);
  return { kind, ariaLabel: `${hand}: ${parts.join(", ")}` };
}

/**
 * 13x13 Solver Lab frequency grid. Separate from `PreflopRangeGrid` (which
 * renders the binary База MTT teaching range) but uses the same visual
 * language: green = raise, near-black = fold; mixed cells are filled from the
 * bottom proportionally to the raise frequency and print the percentage.
 */
export function SolverFrequencyGrid({
  hands,
  label,
  actions,
  primaryAction = actions[0]?.code ?? "",
}: SolverFrequencyGridProps) {
  return (
    <div
      role="grid"
      aria-label={label}
      className="grid w-full grid-cols-[repeat(13,minmax(0,1fr))] gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 shadow-[0_18px_60px_rgba(0,0,0,0.28)]"
    >
      {CANONICAL_STARTING_HANDS.map((hand) => {
        const frequencies = hands[hand] ?? {};
        const raise = frequencies[primaryAction] ?? 0;
        const { kind, ariaLabel } = describeSolverGridCell(hand, frequencies, actions, primaryAction);
        const fillPercent = Math.round(raise * 100);

        return (
          <div
            key={hand}
            role="gridcell"
            aria-label={ariaLabel}
            data-cell-kind={kind}
            className={`relative flex aspect-square min-w-0 flex-col items-center justify-center overflow-hidden font-semibold leading-none tracking-[-0.04em] ${
              kind === "PURE_RAISE"
                ? "bg-[#315f48] text-[#f7fbf8]"
                : kind === "PURE_FOLD"
                  ? "bg-[#101312] text-white/30"
                  : "bg-[#1a221e] text-[#f7fbf8]"
            }`}
            style={kind === "MIXED"
              ? { backgroundImage: `linear-gradient(to top, #4b7a61 ${fillPercent}%, transparent ${fillPercent}%)` }
              : undefined}
          >
            <span aria-hidden="true" className="relative text-[clamp(7px,2.45vw,11px)]">{hand}</span>
            {kind === "MIXED" ? (
              <span aria-hidden="true" className="relative mt-0.5 text-[clamp(5px,1.7vw,8px)] font-medium text-[#e4c97a]">
                {formatSolverFrequencyPercent(raise)}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
