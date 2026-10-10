/**
 * Solver Lab strategy datasets.
 *
 * `hrc_scenario_b_rfi_9max_100bb_v1` is derived ENTIRELY from the frozen HRC
 * Scenario B 100bb reference frequencies already in
 * `config/academy/preflop-ranges.ts` — no new numbers are introduced here:
 *   RAISE_2_25BB = HRC open frequency (0 when the hand is absent),
 *   FOLD         = 1 - RAISE_2_25BB.
 * These are approximate solver frequencies (HRC's own wording: an
 * approximation of opening-range composition, not definitive ranges). There is
 * intentionally no EV in this model.
 *
 * The dataset id is a version: if the data ever has to change, ship a new id
 * and update the fingerprint test deliberately.
 */
import { getAcademyPreflopRange } from "@/config/academy/preflop-ranges";
import {
  ACADEMY_PREFLOP_POSITIONS,
  CANONICAL_STARTING_HANDS,
  normalizeReferenceStrategy,
} from "@/lib/academy/preflop";
import { validateAcademyStrategyDataset } from "@/lib/academy/solver";
import type {
  AcademySolverAction,
  AcademyStrategyDataset,
  AcademyStrategyHandFrequencies,
  AcademyStrategyPositionFrequencies,
  PreflopPosition,
  StartingHandClass,
} from "@/types/academy";

export const ACADEMY_SOLVER_RAISE_ACTION = "RAISE_2_25BB" as const satisfies AcademySolverAction;
export const ACADEMY_SOLVER_FOLD_ACTION = "FOLD" as const satisfies AcademySolverAction;

/** Stable canonical action order; the resolver walks frequencies in this order. */
export const ACADEMY_SOLVER_ACTION_ORDER = Object.freeze([
  ACADEMY_SOLVER_RAISE_ACTION,
  ACADEMY_SOLVER_FOLD_ACTION,
] as const satisfies readonly AcademySolverAction[]);

export const ACADEMY_SOLVER_DATASET_ID = "hrc_scenario_b_rfi_9max_100bb_v1";

function buildPositionFrequencies(position: PreflopPosition): AcademyStrategyPositionFrequencies {
  const normalized = normalizeReferenceStrategy(getAcademyPreflopRange(position).referenceStrategy);
  const hands = {} as Record<StartingHandClass, AcademyStrategyHandFrequencies>;
  for (const hand of CANONICAL_STARTING_HANDS) {
    const raise = normalized[hand];
    hands[hand] = Object.freeze({
      [ACADEMY_SOLVER_RAISE_ACTION]: raise,
      [ACADEMY_SOLVER_FOLD_ACTION]: 1 - raise,
    });
  }
  return Object.freeze(hands);
}

function buildDataset(): AcademyStrategyDataset {
  const reference = getAcademyPreflopRange("UTG");
  const dataset: AcademyStrategyDataset = {
    id: ACADEMY_SOLVER_DATASET_ID,
    title: "HRC Scenario B · RFI · 9-max · 100 BB",
    game: reference.game,
    format: reference.format,
    tableSize: reference.tableSize,
    effectiveStackBb: reference.effectiveStackBb,
    spot: reference.spot,
    provenance: Object.freeze({
      provider: reference.source.provider,
      scenario: reference.source.scenario,
      rangeUrl: reference.source.rangeUrl,
      contextUrl: reference.source.contextUrl,
      provenanceNote: reference.source.provenanceNote,
      derivation:
        "Derived from AcademyPreflopRange.referenceStrategy (config/academy/preflop-ranges.ts): " +
        "RAISE_2_25BB = HRC open frequency (absent hand = 0), FOLD = 1 - RAISE_2_25BB.",
      assumptions: reference.assumptions,
      positions: Object.freeze(Object.fromEntries(ACADEMY_PREFLOP_POSITIONS.map((position) => {
        const { source } = getAcademyPreflopRange(position);
        return [position, Object.freeze({
          sourcePosition: source.sourcePosition,
          reportedWeightedRangePercentage: source.reportedWeightedRangePercentage,
        })];
      })) as AcademyStrategyDataset["provenance"]["positions"]),
    }),
    actions: ACADEMY_SOLVER_ACTION_ORDER,
    positions: Object.freeze(Object.fromEntries(
      ACADEMY_PREFLOP_POSITIONS.map((position) => [position, buildPositionFrequencies(position)]),
    ) as Record<PreflopPosition, AcademyStrategyPositionFrequencies>),
  };

  validateAcademyStrategyDataset(dataset);
  return Object.freeze(dataset);
}

const ACADEMY_SOLVER_DATASET = buildDataset();

export function getAcademySolverDataset(): AcademyStrategyDataset {
  return ACADEMY_SOLVER_DATASET;
}

export function getAcademySolverHandFrequencies(
  position: PreflopPosition,
  hand: StartingHandClass,
): AcademyStrategyHandFrequencies {
  const frequencies = ACADEMY_SOLVER_DATASET.positions[position]?.[hand];
  if (!frequencies) throw new Error(`No Solver Lab frequencies for ${position} ${hand}`);
  return frequencies;
}
