/**
 * Solver Lab strategy dataset registry.
 *
 * `ACADEMY_STRATEGY_DATASETS` maps dataset id → immutable, validated dataset;
 * `getAcademyStrategyDataset(id)` fails closed on an unknown id. Registration
 * order is preserved and the current production dataset is the first entry.
 *
 * `hrc_scenario_b_rfi_9max_100bb_v1` is a thin COMPATIBILITY ADAPTER over the
 * frozen HRC Scenario B 100bb reference frequencies already in
 * `config/academy/preflop-ranges.ts` (that file is not touched) — no new
 * numbers are introduced here:
 *   RAISE_2_25BB = HRC open frequency (0 when the hand is absent),
 *   FOLD         = 1 - RAISE_2_25BB.
 * One node per opening position; the node key is the position code ("UTG",
 * ..., "BTN"), which is a VALUE of this dataset, not a type-level rule.
 * These are approximate solver frequencies (HRC's own wording: an
 * approximation of opening-range composition, not definitive ranges). There is
 * intentionally no EV in this model.
 *
 * The dataset id is a version: if the strategy ever has to change, ship a new
 * id and update the content fingerprint test deliberately.
 */
import { ACADEMY_MTT_REFERENCE_DATASETS } from "@/config/academy/mtt-reference-datasets";
import { getAcademyPreflopRange } from "@/config/academy/preflop-ranges";
import { ACADEMY_HRC_SCENARIO_B_RFI_100BB_DATASET_ID } from "@/config/academy/solver-dataset-ids";
import {
  ACADEMY_PREFLOP_POSITIONS,
  CANONICAL_STARTING_HANDS,
  normalizeReferenceStrategy,
} from "@/lib/academy/preflop";
import {
  createAcademyStrategyDatasetRegistry,
  getAcademyStrategyNode,
  lookupAcademyStrategyDataset,
  validateAcademyStrategyDataset,
} from "@/lib/academy/solver";
import type {
  AcademyStrategyActionDefinition,
  AcademyStrategyDataset,
  AcademyStrategyHandFrequencies,
  AcademyStrategyNode,
  AcademyStrategyNodeHands,
  PreflopPosition,
  StartingHandClass,
} from "@/types/academy";

export const ACADEMY_SOLVER_RAISE_ACTION = "RAISE_2_25BB" as const;
export const ACADEMY_SOLVER_FOLD_ACTION = "FOLD" as const;

/** Stable canonical action order; the resolver walks frequencies in this order. */
export const ACADEMY_SOLVER_ACTION_ORDER = Object.freeze([
  ACADEMY_SOLVER_RAISE_ACTION,
  ACADEMY_SOLVER_FOLD_ACTION,
] as const);

export const ACADEMY_SOLVER_DATASET_ID = ACADEMY_HRC_SCENARIO_B_RFI_100BB_DATASET_ID;

/** Action definitions of the HRC 100bb RFI dataset, in resolver order. */
export const ACADEMY_HRC_RFI_100BB_ACTIONS: readonly AcademyStrategyActionDefinition[] = Object.freeze([
  Object.freeze({
    code: ACADEMY_SOLVER_RAISE_ACTION,
    kind: "RAISE",
    label: "Raise 2.25 BB",
    amountBb: 2.25,
    ru: Object.freeze({
      button: "Рейз 2.25 BB",
      inline: "рейз 2.25 BB",
      short: "рейз",
      always: "всегда открываем рейзом",
    }),
  }),
  Object.freeze({
    code: ACADEMY_SOLVER_FOLD_ACTION,
    kind: "FOLD",
    label: "Fold",
    ru: Object.freeze({
      button: "Фолд",
      inline: "фолд",
      short: "фолд",
      always: "всегда сбрасываем",
    }),
  }),
] satisfies AcademyStrategyActionDefinition[]);

function buildPositionFrequencies(position: PreflopPosition): AcademyStrategyNodeHands {
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

function buildHrcRfi100bbDataset(): AcademyStrategyDataset {
  const reference = getAcademyPreflopRange("UTG");
  const dataset: AcademyStrategyDataset = {
    id: ACADEMY_HRC_SCENARIO_B_RFI_100BB_DATASET_ID,
    version: 1,
    title: "HRC Scenario B · RFI · 9-max · 100 BB",
    metadata: Object.freeze({
      game: reference.game,
      format: reference.format,
      strategyModel: reference.assumptions.model,
      tableSize: reference.tableSize,
      effectiveStackBb: reference.effectiveStackBb,
      spotCode: reference.spot,
    }),
    provenance: Object.freeze({
      provider: reference.source.provider,
      scenario: reference.source.scenario,
      note: reference.source.provenanceNote,
      derivation:
        "Derived from AcademyPreflopRange.referenceStrategy (config/academy/preflop-ranges.ts): " +
        "RAISE_2_25BB = HRC open frequency (absent hand = 0), FOLD = 1 - RAISE_2_25BB.",
      references: Object.freeze({
        rangeUrl: reference.source.rangeUrl,
        contextUrl: reference.source.contextUrl,
      }),
      nodeSources: Object.freeze(Object.fromEntries(ACADEMY_PREFLOP_POSITIONS.map((position) => {
        const { source } = getAcademyPreflopRange(position);
        return [position, Object.freeze({
          sourcePosition: source.sourcePosition,
          reportedWeightedRangePercentage: source.reportedWeightedRangePercentage,
        })];
      }))),
    }),
    assumptions: reference.assumptions,
    actions: ACADEMY_HRC_RFI_100BB_ACTIONS,
    nodes: Object.freeze(Object.fromEntries(ACADEMY_PREFLOP_POSITIONS.map((position): [string, AcademyStrategyNode] => [
      position,
      Object.freeze({
        key: position,
        actionCodes: ACADEMY_SOLVER_ACTION_ORDER,
        hands: buildPositionFrequencies(position),
      }),
    ]))),
  };

  validateAcademyStrategyDataset(dataset, { expectedNodeKeys: ACADEMY_PREFLOP_POSITIONS });
  return Object.freeze(dataset);
}

/**
 * Production registry. ONLY real, reviewed datasets belong here — never test
 * fixtures, never unfinished/placeholder strategies.
 *
 * After the HRC dataset come the 5 external MTT preflop reference datasets
 * (EXTERNAL_REFERENCE_UNVERIFIED, config/academy/mtt-reference-datasets.ts).
 * They are registry-only: no lesson binding references them, so no
 * player-facing route can reach them.
 */
export const ACADEMY_STRATEGY_DATASETS = createAcademyStrategyDatasetRegistry([
  buildHrcRfi100bbDataset(),
  ...ACADEMY_MTT_REFERENCE_DATASETS,
]);

export function listAcademyStrategyDatasetIds(): readonly string[] {
  return Object.keys(ACADEMY_STRATEGY_DATASETS);
}

/** Fail-closed: throws `AcademyUnknownStrategyDatasetError` for unknown ids. */
export function getAcademyStrategyDataset(datasetId: string): AcademyStrategyDataset {
  return lookupAcademyStrategyDataset(ACADEMY_STRATEGY_DATASETS, datasetId);
}

/** The HRC 100bb RFI dataset (compatibility accessor). */
export function getAcademySolverDataset(): AcademyStrategyDataset {
  return getAcademyStrategyDataset(ACADEMY_SOLVER_DATASET_ID);
}

/** Compatibility accessor: HRC 100bb RFI frequencies for one position + hand. */
export function getAcademySolverHandFrequencies(
  position: PreflopPosition,
  hand: StartingHandClass,
): AcademyStrategyHandFrequencies {
  const frequencies = getAcademyStrategyNode(getAcademySolverDataset(), position).hands[hand];
  if (!frequencies) throw new Error(`No Solver Lab frequencies for ${position} ${hand}`);
  return frequencies;
}
