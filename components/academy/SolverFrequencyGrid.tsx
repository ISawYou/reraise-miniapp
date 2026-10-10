import { CANONICAL_STARTING_HANDS } from "@/lib/academy/preflop";
import { formatSolverFrequencyPercent } from "@/lib/academy/solver-feedback";
import type { AcademyStrategyPositionFrequencies, StartingHandClass } from "@/types/academy";

type SolverFrequencyGridProps = {
  hands: AcademyStrategyPositionFrequencies;
  label: string;
  raiseAction?: string;
};

export type SolverGridCellKind = "PURE_RAISE" | "MIXED" | "PURE_FOLD";

export function describeSolverGridCell(
  hand: StartingHandClass,
  raiseFrequency: number,
): { kind: SolverGridCellKind; ariaLabel: string } {
  if (raiseFrequency >= 1) return { kind: "PURE_RAISE", ariaLabel: `${hand}: рейз 100%` };
  if (raiseFrequency <= 0) return { kind: "PURE_FOLD", ariaLabel: `${hand}: фолд 100%` };
  return {
    kind: "MIXED",
    ariaLabel:
      `${hand}: рейз ${formatSolverFrequencyPercent(raiseFrequency)}, ` +
      `фолд ${formatSolverFrequencyPercent(1 - raiseFrequency)}`,
  };
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
  raiseAction = "RAISE_2_25BB",
}: SolverFrequencyGridProps) {
  return (
    <div
      role="grid"
      aria-label={label}
      className="grid w-full grid-cols-[repeat(13,minmax(0,1fr))] gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 shadow-[0_18px_60px_rgba(0,0,0,0.28)]"
    >
      {CANONICAL_STARTING_HANDS.map((hand) => {
        const raise = hands[hand]?.[raiseAction] ?? 0;
        const { kind, ariaLabel } = describeSolverGridCell(hand, raise);
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
