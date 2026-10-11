import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getAcademyPreflopRange } from "@/config/academy/preflop-ranges";
import {
  ACADEMY_SOLVER_ACTION_ORDER,
  ACADEMY_SOLVER_DATASET_ID,
  getAcademySolverDataset,
  getAcademySolverHandFrequencies,
} from "@/config/academy/solver-datasets";
import { ACADEMY_PREFLOP_POSITIONS, CANONICAL_STARTING_HANDS } from "@/lib/academy/preflop";
import {
  AcademyStrategyDatasetValidationError,
  serializeAcademyStrategyContentCanonical,
  serializeAcademyStrategyDatasetCanonical,
  serializeCanonicalJson,
  validateAcademyStrategyDataset,
} from "@/lib/academy/solver";
import type { AcademyStrategyDataset } from "@/types/academy";

/**
 * ORIGINAL fingerprint of `hrc_scenario_b_rfi_9max_100bb_v1` as committed with
 * Solver Lab v1 (origin/main bb74517): SHA-256 of the canonical, key-sorted
 * JSON serialization of the whole v1 dataset object, provenance included.
 *
 * The dataset-platform refactor changed the runtime CONTAINER (metadata
 * object, generic provenance, action definitions, `nodes` instead of
 * `positions`), so hashing the new object necessarily differs. This hash is
 * therefore NOT updated: instead `toLegacyV1Container` rebuilds the exact v1
 * container from the new dataset and must still hash to this value — a
 * byte-for-byte proof that no frequency, action order or provenance value
 * changed. New content/metadata fingerprints live in
 * solver-dataset-platform.test.ts.
 *
 * DO NOT "just update" this hash when the test fails. A change means the
 * Solver Lab answer key (or its provenance) changed. Any change to
 * frequencies must ship under a NEW dataset id.
 */
const EXPECTED_DATASET_SHA256 = "91a6b6a4c66740bdf1de643d18aa8d363632c6ebccd8b1874e512fa76b0b9efb";

/** Rebuilds the pre-refactor v1 dataset object shape from the new dataset. */
function toLegacyV1Container(dataset: AcademyStrategyDataset) {
  return {
    id: dataset.id,
    title: dataset.title,
    game: dataset.metadata.game,
    format: dataset.metadata.format,
    tableSize: dataset.metadata.tableSize,
    effectiveStackBb: dataset.metadata.effectiveStackBb,
    spot: dataset.metadata.spotCode,
    provenance: {
      provider: dataset.provenance.provider,
      scenario: dataset.provenance.scenario,
      rangeUrl: dataset.provenance.references.rangeUrl,
      contextUrl: dataset.provenance.references.contextUrl,
      provenanceNote: dataset.provenance.note,
      derivation: dataset.provenance.derivation,
      assumptions: dataset.assumptions,
      positions: dataset.provenance.nodeSources,
    },
    actions: dataset.actions.map((action) => action.code),
    positions: Object.fromEntries(Object.entries(dataset.nodes).map(([key, node]) => [key, node.hands])),
  };
}

function cloneDataset(): AcademyStrategyDataset {
  return JSON.parse(JSON.stringify(getAcademySolverDataset())) as AcademyStrategyDataset;
}

describe("Solver Lab dataset hrc_scenario_b_rfi_9max_100bb_v1", () => {
  const dataset = getAcademySolverDataset();

  it("is versioned, carries provenance and uses the stable action order", () => {
    expect(dataset.id).toBe(ACADEMY_SOLVER_DATASET_ID);
    expect(dataset.id).toBe("hrc_scenario_b_rfi_9max_100bb_v1");
    expect(dataset.actions.map((action) => action.code)).toEqual(["RAISE_2_25BB", "FOLD"]);
    expect(dataset.actions.map((action) => action.code)).toEqual(ACADEMY_SOLVER_ACTION_ORDER);
    for (const node of Object.values(dataset.nodes)) {
      expect(node.actionCodes).toEqual(["RAISE_2_25BB", "FOLD"]);
    }
    expect(dataset.provenance).toMatchObject({
      provider: "HRC",
      scenario: "Scenario B: 100bb deepstacked",
      references: { rangeUrl: getAcademyPreflopRange("UTG").source.rangeUrl },
    });
    expect(dataset.assumptions).toMatchObject({ openSizeBb: 2.25, model: "CHIP_EV" });
    expect(dataset.provenance.nodeSources?.BTN).toEqual({
      sourcePosition: "BU",
      reportedWeightedRangePercentage: getAcademyPreflopRange("BTN").source.reportedWeightedRangePercentage,
    });
  });

  it("(1) has exactly the 7 position nodes", () => {
    expect(Object.keys(dataset.nodes).sort()).toEqual([...ACADEMY_PREFLOP_POSITIONS].sort());
  });

  it("(2) has exactly 169 hands per position", () => {
    for (const position of ACADEMY_PREFLOP_POSITIONS) {
      expect(Object.keys(dataset.nodes[position].hands)).toHaveLength(169);
      expect(Object.keys(dataset.nodes[position].hands).sort()).toEqual([...CANONICAL_STARTING_HANDS].sort());
    }
  });

  it("(3) keeps every frequency in [0, 1] and (4) sums each hand to 1", () => {
    for (const position of ACADEMY_PREFLOP_POSITIONS) {
      for (const hand of CANONICAL_STARTING_HANDS) {
        const frequencies: number[] = Object.values(dataset.nodes[position].hands[hand]);
        for (const frequency of frequencies) {
          expect(frequency).toBeGreaterThanOrEqual(0);
          expect(frequency).toBeLessThanOrEqual(1);
        }
        expect(Math.abs(frequencies.reduce((a, b) => a + b, 0) - 1)).toBeLessThanOrEqual(1e-9);
      }
    }
  });

  it("(5) lists each action code exactly once per hand", () => {
    for (const position of ACADEMY_PREFLOP_POSITIONS) {
      for (const hand of CANONICAL_STARTING_HANDS) {
        const actions = Object.keys(dataset.nodes[position].hands[hand]);
        expect(new Set(actions).size).toBe(actions.length);
        expect([...actions].sort()).toEqual(dataset.actions.map((action) => action.code).sort());
      }
    }
  });

  it("(6) matches the HRC source frequencies exactly", () => {
    expect(getAcademySolverHandFrequencies("UTG", "AA")).toEqual({ RAISE_2_25BB: 1, FOLD: 0 });
    expect(getAcademySolverHandFrequencies("UTG", "AJo").RAISE_2_25BB).toBe(0.41);
    expect(getAcademySolverHandFrequencies("UTG", "72o")).toEqual({ RAISE_2_25BB: 0, FOLD: 1 });
    expect(getAcademySolverHandFrequencies("BTN", "T7o").RAISE_2_25BB).toBe(0.59);
    expect(getAcademySolverHandFrequencies("BTN", "T7o").FOLD).toBeCloseTo(0.41, 12);

    for (const position of ACADEMY_PREFLOP_POSITIONS) {
      const source = getAcademyPreflopRange(position).referenceStrategy;
      for (const hand of CANONICAL_STARTING_HANDS) {
        const frequencies = dataset.nodes[position].hands[hand];
        expect(frequencies.RAISE_2_25BB).toBe(source[hand] ?? 0);
        expect(frequencies.FOLD).toBe(1 - (source[hand] ?? 0));
      }
    }
  });

  it("has no EV concept anywhere in the data", () => {
    expect(serializeAcademyStrategyDatasetCanonical(dataset).toLowerCase()).not.toMatch(/"ev"|\bev\b/);
  });

  it("validates the real dataset", () => {
    expect(() => validateAcademyStrategyDataset(dataset)).not.toThrow();
  });

  it("(7) the rebuilt v1 container still matches the ORIGINAL committed SHA-256 fingerprint", () => {
    const digest = createHash("sha256")
      .update(serializeCanonicalJson(toLegacyV1Container(dataset)))
      .digest("hex");
    expect(digest).toBe(EXPECTED_DATASET_SHA256);
  });

  it("canonical serialization is independent of object key insertion order", () => {
    const reordered = cloneDataset();
    const utg = reordered.nodes.UTG.hands as unknown as Record<string, Record<string, number>>;
    utg.AA = { FOLD: utg.AA.FOLD, RAISE_2_25BB: utg.AA.RAISE_2_25BB };
    expect(serializeAcademyStrategyDatasetCanonical(reordered))
      .toBe(serializeAcademyStrategyDatasetCanonical(dataset));
    expect(serializeAcademyStrategyContentCanonical(reordered))
      .toBe(serializeAcademyStrategyContentCanonical(dataset));
  });

  describe("(8) rejects corrupted copies", () => {
    type MutableDataset = {
      actions: Array<{ code: string }>;
      positions: Record<string, Record<string, Record<string, number>>>;
      nodes: Record<string, { hands: Record<string, Record<string, number>> }>;
    };
    function mutate(change: (copy: MutableDataset) => void) {
      const copy = cloneDataset() as unknown as MutableDataset;
      // `positions` aliases each node's hand map so the original mutation
      // cases below read exactly as before the node refactor.
      copy.positions = Object.fromEntries(Object.entries(copy.nodes).map(([key, node]) => [key, node.hands]));
      change(copy);
      if (!copy.positions.BTN) delete copy.nodes.BTN;
      const { positions: _aliases, ...dataset } = copy;
      void _aliases;
      return () => validateAcademyStrategyDataset(
        dataset as unknown as AcademyStrategyDataset,
        { expectedNodeKeys: ACADEMY_PREFLOP_POSITIONS },
      );
    }

    it.each([
      ["frequency 1.5", mutate((c) => { c.positions.UTG.AA = { RAISE_2_25BB: 1.5, FOLD: -0.5 }; }), /outside \[0, 1\]/],
      ["negative frequency", mutate((c) => { c.positions.CO["72o"].FOLD = -0.1; }), /outside \[0, 1\]/],
      ["sum != 1", mutate((c) => { c.positions.HJ.AKs = { RAISE_2_25BB: 0.6, FOLD: 0.6 }; }), /sum to/],
      ["missing hand", mutate((c) => { delete c.positions.EP.KK; }), /missing hand KK/],
      ["missing position node", mutate((c) => { delete c.positions.BTN; }), /missing node BTN/],
      ["missing action", mutate((c) => { c.positions.MP1.QQ = { RAISE_2_25BB: 1 }; }), /missing action FOLD/],
      ["unknown action", mutate((c) => { c.positions.MP1.QQ = { RAISE_2_25BB: 1, FOLD: 0, CALL: 0 }; }), /unknown action CALL/],
      ["non-canonical hand", mutate((c) => { c.positions.MP2.KAo = { RAISE_2_25BB: 1, FOLD: 0 }; }), /non-canonical hand KAo/],
      ["duplicate action codes", mutate((c) => { c.actions = [c.actions[1], c.actions[1]]; }), /unique/],
    ])("%s", (_name, run, message) => {
      expect(run).toThrow(AcademyStrategyDatasetValidationError);
      expect(run).toThrow(message);
    });
  });
});
