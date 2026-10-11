import {
  CANONICAL_STARTING_HANDS,
  calculateWeightedRangePercentage,
} from "@/lib/academy/preflop";
import {
  formatSolverFrequencyPercent,
  solverActionButtonLabel,
  solverActionShortLabel,
} from "@/lib/academy/solver-feedback";
import type {
  AcademySolverPublicAction,
  AcademyStrategyActionKind,
  AcademyStrategyHandFrequencies,
  AcademyStrategyNodeHands,
  StartingHandClass,
} from "@/types/academy";

type MixAction = Pick<AcademySolverPublicAction, "code" | "kind" | "label" | "ru">;

/** Colour per generic action kind (LIMP is CALL-kind). */
const KIND_COLORS: Readonly<Record<AcademyStrategyActionKind, string>> = {
  RAISE: "#3f7f5c",
  BET: "#3f7f5c",
  ALL_IN: "#a8483f",
  CALL: "#3b6b9a",
  CHECK: "#55606a",
  FOLD: "#141917",
};

export function solverActionMixColor(action: Pick<MixAction, "kind">): string {
  return KIND_COLORS[action.kind] ?? "#55606a";
}

export type SolverActionMixSegment = {
  readonly code: string;
  readonly frequency: number;
  readonly color: string;
};

/**
 * One cell's real action mix: every node action in resolver order with its
 * exact frequency, the dominant action, and an aria label listing the
 * non-zero actions ("AJo: 3-бет 12%, колл 40%, фолд 48%").
 */
export function describeSolverActionMixCell(
  hand: StartingHandClass,
  frequencies: AcademyStrategyHandFrequencies,
  actions: readonly MixAction[],
): { segments: readonly SolverActionMixSegment[]; dominant: string; ariaLabel: string } {
  const segments = actions.map((action) => ({
    code: action.code,
    frequency: frequencies[action.code] ?? 0,
    color: solverActionMixColor(action),
  }));
  const dominant = segments.reduce((best, segment) => (segment.frequency > best.frequency ? segment : best), segments[0]);
  const parts = actions
    .filter((action) => (frequencies[action.code] ?? 0) > 0)
    .map((action) => `${solverActionShortLabel(action)} ${formatSolverFrequencyPercent(frequencies[action.code])}`);
  return { segments, dominant: dominant?.code ?? "", ariaLabel: `${hand}: ${parts.join(", ")}` };
}

/** CSS hard-stop gradient (left → right) for a cell's segments. */
export function solverActionMixGradient(segments: readonly SolverActionMixSegment[]): string {
  let start = 0;
  const stops: string[] = [];
  for (const segment of segments) {
    if (segment.frequency <= 0) continue;
    const end = Math.min(100, start + segment.frequency * 100);
    stops.push(`${segment.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
    start = end;
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/** Combo-weighted share of the whole range played with each action. */
export function solverActionRangeShares(
  hands: AcademyStrategyNodeHands,
  actions: readonly MixAction[],
): ReadonlyArray<{ code: string; percent: number }> {
  return actions.map((action) => ({
    code: action.code,
    percent: calculateWeightedRangePercentage(Object.fromEntries(
      CANONICAL_STARTING_HANDS.map((hand) => [hand, hands[hand]?.[action.code] ?? 0]),
    )),
  }));
}

type SolverActionMixGridProps = {
  hands: AcademyStrategyNodeHands;
  label: string;
  /** The node's actions, in resolver order. */
  actions: readonly MixAction[];
};

/**
 * 13x13 range grid for nodes with any number of actions. Each cell is split
 * left → right into the node's actions proportionally to their real
 * frequencies. Frequencies only — there is no EV in these datasets.
 */
export function SolverActionMixGrid({ hands, label, actions }: SolverActionMixGridProps) {
  const shares = solverActionRangeShares(hands, actions);
  return (
    <div>
      <div
        role="grid"
        aria-label={label}
        className="grid w-full grid-cols-[repeat(13,minmax(0,1fr))] gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10"
      >
        {CANONICAL_STARTING_HANDS.map((hand) => {
          const frequencies = hands[hand] ?? {};
          const { segments, dominant, ariaLabel } = describeSolverActionMixCell(hand, frequencies, actions);
          return (
            <div
              key={hand}
              role="gridcell"
              aria-label={ariaLabel}
              data-hand={hand}
              data-dominant-action={dominant}
              data-mix={segments.map((segment) => `${segment.code}:${segment.frequency}`).join(",")}
              className="relative flex aspect-square min-w-0 items-center justify-center overflow-hidden font-semibold leading-none tracking-[-0.04em] text-[#f7fbf8]"
              style={{ backgroundImage: solverActionMixGradient(segments) }}
            >
              <span aria-hidden="true" className="relative text-[clamp(7px,2.45vw,11px)] drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]">
                {hand}
              </span>
            </div>
          );
        })}
      </div>

      <ul className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/60" aria-label="Легенда">
        {actions.map((action) => {
          const share = shares.find((entry) => entry.code === action.code)?.percent ?? 0;
          return (
            <li key={action.code} className="inline-flex items-center gap-2" data-legend-action={action.code}>
              <span
                className="h-2.5 w-2.5 rounded-full border border-white/15"
                style={{ backgroundColor: solverActionMixColor(action) }}
              />
              {solverActionButtonLabel(action)} · {Math.round(share)}%
            </li>
          );
        })}
      </ul>
    </div>
  );
}
