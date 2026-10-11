/**
 * TEST ONLY — synthetic multi-action strategy fixture.
 *
 * NOT a real strategy, NOT solver output, NOT derived from any source. Exists
 * only to prove that the generic validator / resolver / session / trainer-UI
 * plumbing handles N > 2 actions. It must NEVER be registered in
 * `ACADEMY_STRATEGY_DATASETS`, wired into the catalog, bound to a lesson, or
 * reachable from any player-facing route (tests assert this).
 *
 * Authored in the RERAISE normalized schema v1 (data/academy/solver).
 */
import {
  normalizedSolverDatasetToStrategyDataset,
  type NormalizedSolverDatasetV1,
  type NormalizedSolverHandStrategyV1,
} from "@/data/academy/solver/schema-v1";
import { CANONICAL_STARTING_HANDS } from "@/lib/academy/preflop";
import type { StartingHandClass } from "@/types/academy";

export const TEST_ONLY_MULTI_ACTION_DATASET_ID = "test_only_synthetic_multi_action_v1";
export const TEST_ONLY_MULTI_ACTION_NODE_KEY = "TEST_ONLY_NODE";
/** The example hand carrying the 4-way mix FOLD .10 / CALL .40 / RAISE_7BB .30 / ALL_IN .20. */
export const TEST_ONLY_MIXED_HAND: StartingHandClass = "AKo";
export const TEST_ONLY_ACTION_ORDER = Object.freeze(["FOLD", "CALL", "RAISE_7BB", "ALL_IN"] as const);

const MIX = { FOLD: 0.1, CALL: 0.4, RAISE_7BB: 0.3, ALL_IN: 0.2 } as const;
/** Extra mixed hands (same synthetic mix) so a balanced session can be sampled. */
const OTHER_MIXED_HANDS: readonly StartingHandClass[] = ["AQs", "KQo", "JTs"];
const PURE_RAISE_HANDS: readonly StartingHandClass[] = ["AA", "KK", "QQ"];

function strategy(frequencies: Record<(typeof TEST_ONLY_ACTION_ORDER)[number], number>): NormalizedSolverHandStrategyV1 {
  return Object.fromEntries(TEST_ONLY_ACTION_ORDER.map((code) => [code, { frequency: frequencies[code] }]));
}

export function buildTestOnlyMultiActionDocument(): NormalizedSolverDatasetV1 {
  const hands = {} as Record<StartingHandClass, NormalizedSolverHandStrategyV1>;
  for (const hand of CANONICAL_STARTING_HANDS) {
    if (hand === TEST_ONLY_MIXED_HAND || OTHER_MIXED_HANDS.includes(hand)) hands[hand] = strategy(MIX);
    else if (PURE_RAISE_HANDS.includes(hand)) hands[hand] = strategy({ FOLD: 0, CALL: 0, RAISE_7BB: 1, ALL_IN: 0 });
    else hands[hand] = strategy({ FOLD: 1, CALL: 0, RAISE_7BB: 0, ALL_IN: 0 });
  }
  return {
    schemaVersion: 1,
    dataset: {
      id: TEST_ONLY_MULTI_ACTION_DATASET_ID,
      version: 1,
      title: "TEST ONLY · synthetic multi-action fixture (not a real strategy)",
      metadata: {
        game: "NLHE",
        format: "TEST_ONLY",
        strategyModel: "TEST_ONLY",
        tableSize: 6,
        effectiveStackBb: 25,
        spotCode: "TEST_ONLY_SPOT",
      },
      provenance: {
        provider: "TEST_ONLY",
        scenario: "Synthetic fixture for multi-action plumbing tests",
        note: "TEST ONLY. Invented numbers; never use as strategy.",
        derivation: "Hand-written in lib/academy/__tests__/fixtures/test-only-multi-action-dataset.ts.",
        references: {},
      },
      assumptions: { testOnly: true },
      actions: [
        { code: "FOLD", kind: "FOLD", label: "Fold" },
        { code: "CALL", kind: "CALL", label: "Call" },
        { code: "RAISE_7BB", kind: "RAISE", label: "Raise 7 BB", amountBb: 7 },
        { code: "ALL_IN", kind: "ALL_IN", label: "All-in" },
      ],
      nodes: [{ key: TEST_ONLY_MULTI_ACTION_NODE_KEY, actionCodes: [...TEST_ONLY_ACTION_ORDER], hands }],
    },
  };
}

/** Runtime (validated, frozen) form of the TEST ONLY fixture. */
export function buildTestOnlyMultiActionDataset() {
  return normalizedSolverDatasetToStrategyDataset(buildTestOnlyMultiActionDocument());
}
