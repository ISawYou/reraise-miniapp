import { describe, expect, it } from "vitest";
import {
  AcademySolverImportNotImplementedError,
  importHrcSolverExport,
  normalizedSolverDatasetToStrategyDataset,
  serializeNormalizedSolverContentCanonical,
  strategyDatasetToNormalizedV1,
  validateNormalizedSolverDatasetV1,
} from "@/data/academy/solver/schema-v1";
import { getAcademyLessonByCode, listAcademyCourses } from "@/config/academy/catalog";
import {
  ACADEMY_STRATEGY_DATASETS,
  getAcademyStrategyDataset,
  listAcademyStrategyDatasetIds,
} from "@/config/academy/solver-datasets";
import {
  ACADEMY_SOLVER_LESSON_BINDINGS,
  ACADEMY_SOLVER_RFI_LESSONS,
  getAcademySolverLessonBinding,
} from "@/config/academy/solver-lessons";
import { ACADEMY_PREFLOP_POSITIONS, CANONICAL_STARTING_HANDS } from "@/lib/academy/preflop";
import {
  AcademyStrategyDatasetValidationError,
  AcademyUnknownStrategyDatasetError,
  createAcademyStrategyDatasetRegistry,
  getAcademyStrategyNode,
  serializeAcademyStrategyContentCanonical,
} from "@/lib/academy/solver";
import { computeAcademyStrategyFingerprints } from "@/lib/academy/solver-fingerprint";
import {
  TEST_ONLY_MULTI_ACTION_DATASET_ID,
  buildTestOnlyMultiActionDocument,
} from "@/lib/academy/__tests__/fixtures/test-only-multi-action-dataset";
import preRefactor from "./fixtures/hrc-scenario-b-rfi-9max-100bb-v1.pre-refactor-frequencies.json";
import type { AcademyStrategyDataset, PreflopPosition, StartingHandClass } from "@/types/academy";

const DATASET_ID = "hrc_scenario_b_rfi_9max_100bb_v1";

/**
 * NEW content fingerprint (SHA-256 of `serializeAcademyStrategyContentCanonical`)
 * of `hrc_scenario_b_rfi_9max_100bb_v1`: action identity + nodes + hands +
 * frequencies only. It is a new guard introduced by the dataset-platform
 * refactor, computed from data proven identical to the pre-refactor dataset
 * by the "(7)" equivalence test below and by the original v1 hash test in
 * solver-datasets.test.ts. DO NOT update it to make a failing test pass: a
 * change means the answer key changed and must ship under a new dataset id.
 */
const EXPECTED_CONTENT_SHA256 = "888cfddd107a4ab6bdeeed9875834d0216e39b1402b21c05773ae9cac567de71";

const dataset = getAcademyStrategyDataset(DATASET_ID);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Loose, mutable deep copy of a runtime dataset for fingerprint tests. */
type MutableDataset = {
  title: string;
  actions: Array<{ label: string; amountBb?: number; ru?: { button: string } }>;
  provenance: { note: string };
  nodes: Record<string, { actionCodes: string[]; hands: Record<string, Record<string, number>> }>;
};

function mutableClone(source: AcademyStrategyDataset): MutableDataset {
  return clone(source) as unknown as MutableDataset;
}

function fingerprints(copy: MutableDataset) {
  return computeAcademyStrategyFingerprints(copy as unknown as AcademyStrategyDataset);
}

describe("strategy dataset registry", () => {
  it("(1) registers the current dataset id as the FIRST entry", () => {
    expect(listAcademyStrategyDatasetIds()[0]).toBe(DATASET_ID);
    expect(Object.keys(ACADEMY_STRATEGY_DATASETS)[0]).toBe(DATASET_ID);
    expect(ACADEMY_STRATEGY_DATASETS[DATASET_ID]).toBe(dataset);
    expect(dataset.id).toBe(DATASET_ID);
    expect(Object.isFrozen(ACADEMY_STRATEGY_DATASETS)).toBe(true);
    expect(Object.isFrozen(dataset)).toBe(true);
    expect(Object.isFrozen(dataset.nodes.UTG.hands.AA)).toBe(true);
  });

  it("(2) fails closed for unknown dataset ids", () => {
    for (const id of ["nope", "", "HRC_SCENARIO_B_RFI_9MAX_100BB_V1", "toString", "__proto__", TEST_ONLY_MULTI_ACTION_DATASET_ID]) {
      expect(() => getAcademyStrategyDataset(id)).toThrow(AcademyUnknownStrategyDatasetError);
    }
  });

  it("never registers the TEST ONLY fixture or anything besides the reviewed 100bb dataset", () => {
    expect(listAcademyStrategyDatasetIds()).toEqual([DATASET_ID]);
  });

  it("rejects duplicate dataset ids when building a registry", () => {
    expect(() => createAcademyStrategyDatasetRegistry([dataset, dataset]))
      .toThrow(/unique within the registry/);
    expect(() => createAcademyStrategyDatasetRegistry([])).toThrow(AcademyStrategyDatasetValidationError);
  });

  it("(3) current metadata resolves to NLHE / MTT / CHIP_EV / 9-max / 100 BB / RFI", () => {
    expect(dataset.metadata).toEqual({
      game: "NLHE",
      format: "MTT",
      strategyModel: "CHIP_EV",
      tableSize: 9,
      effectiveStackBb: 100,
      spotCode: "RFI",
    });
    expect(dataset.version).toBe(1);
    expect(dataset.title).toBe("HRC Scenario B · RFI · 9-max · 100 BB");
    expect(dataset.provenance.provider).toBe("HRC");
  });

  it("(4) current action definitions are Raise 2.25 BB and Fold", () => {
    expect(dataset.actions.map(({ code, kind, label, amountBb }) => ({ code, kind, label, amountBb }))).toEqual([
      { code: "RAISE_2_25BB", kind: "RAISE", label: "Raise 2.25 BB", amountBb: 2.25 },
      { code: "FOLD", kind: "FOLD", label: "Fold", amountBb: undefined },
    ]);
    expect(dataset.actions[1]).not.toHaveProperty("amountBb");
    expect(dataset.actions.map((action) => action.ru?.button)).toEqual(["Рейз 2.25 BB", "Фолд"]);
  });
});

describe("lesson → dataset → node bindings", () => {
  const LESSON_CODES = [
    "solver_rfi_9max_100bb_utg",
    "solver_rfi_9max_100bb_ep",
    "solver_rfi_9max_100bb_mp1",
    "solver_rfi_9max_100bb_mp2",
    "solver_rfi_9max_100bb_hj",
    "solver_rfi_9max_100bb_co",
    "solver_rfi_9max_100bb_btn",
  ];

  it("(5) the 7 lesson codes are byte-identical and each binds explicitly to the 100bb dataset", () => {
    expect(ACADEMY_SOLVER_LESSON_BINDINGS.map((binding) => binding.lessonCode)).toEqual(LESSON_CODES);
    expect(ACADEMY_PREFLOP_POSITIONS.map((position) => ACADEMY_SOLVER_RFI_LESSONS[position].code)).toEqual(LESSON_CODES);
    for (const code of LESSON_CODES) {
      const binding = getAcademySolverLessonBinding(code)!;
      expect(binding.datasetId).toBe(DATASET_ID);
      expect(binding.primaryActionCode).toBe("RAISE_2_25BB");
      expect(getAcademyLessonByCode(code)?.trainerKind).toBe("PREFLOP_RFI_FREQUENCY");
    }
    expect(getAcademySolverLessonBinding("preflop_rfi_9max_100bb_utg")).toBeNull();
    expect(getAcademySolverLessonBinding("nope")).toBeNull();
  });

  it("(6) every lesson resolves to the node of its own position", () => {
    for (const position of ACADEMY_PREFLOP_POSITIONS) {
      const lesson = ACADEMY_SOLVER_RFI_LESSONS[position];
      const binding = getAcademySolverLessonBinding(lesson.code)!;
      expect(binding.selector).toEqual({ nodeKey: position });
      const node = getAcademyStrategyNode(getAcademyStrategyDataset(binding.datasetId), binding.selector.nodeKey);
      expect(node.key).toBe(position);
      expect(node).toBe(dataset.nodes[position]);
    }
  });

  it("every frequency-trainer catalog lesson has a binding, and every binding resolves", () => {
    const frequencyLessons = listAcademyCourses()
      .flatMap((course) => course.modules.flatMap((courseModule) => courseModule.lessons))
      .filter((lesson) => lesson.trainerKind === "PREFLOP_RFI_FREQUENCY");
    expect(frequencyLessons.map((lesson) => lesson.code)).toEqual(LESSON_CODES);
    for (const binding of ACADEMY_SOLVER_LESSON_BINDINGS) {
      const bound = getAcademyStrategyDataset(binding.datasetId);
      const node = getAcademyStrategyNode(bound, binding.selector.nodeKey);
      expect(node.actionCodes).toContain(binding.primaryActionCode);
    }
  });
});

describe("(7) core regression: frequencies identical to the pre-refactor dataset", () => {
  // Fixture captured by running the UNCHANGED origin/main (bb74517)
  // config/academy/solver-datasets.ts before this refactor:
  // frequencies[position][hand] = [RAISE_2_25BB, FOLD].
  const captured = preRefactor as unknown as {
    actionOrder: string[];
    frequencies: Record<PreflopPosition, Record<StartingHandClass, [number, number]>>;
  };

  it("matches exactly for all 7 positions × 169 hands × 2 actions", () => {
    expect(captured.actionOrder).toEqual(["RAISE_2_25BB", "FOLD"]);
    expect(Object.keys(captured.frequencies)).toEqual([...ACADEMY_PREFLOP_POSITIONS]);
    expect(Object.keys(dataset.nodes)).toEqual([...ACADEMY_PREFLOP_POSITIONS]);
    let compared = 0;
    for (const position of ACADEMY_PREFLOP_POSITIONS) {
      // Set comparison: JS objects hoist integer-like keys ("22".."99").
      expect(Object.keys(captured.frequencies[position]).sort()).toEqual([...CANONICAL_STARTING_HANDS].sort());
      expect(Object.keys(captured.frequencies[position])).toHaveLength(169);
      for (const hand of CANONICAL_STARTING_HANDS) {
        const after = dataset.nodes[position].hands[hand];
        const [raise, fold] = captured.frequencies[position][hand];
        expect(Object.keys(after)).toEqual(["RAISE_2_25BB", "FOLD"]);
        // toBe = Object.is: exact IEEE-754 equality, no tolerance.
        expect(after.RAISE_2_25BB).toBe(raise);
        expect(after.FOLD).toBe(fold);
        compared += 2;
      }
    }
    expect(compared).toBe(7 * 169 * 2);
  });
});

describe("(8)(10) content vs metadata fingerprints", () => {
  it("content fingerprint matches the committed value", () => {
    expect(computeAcademyStrategyFingerprints(dataset).content).toBe(EXPECTED_CONTENT_SHA256);
  });

  it("changing labels, title, provenance or localized copy does NOT change the content fingerprint", () => {
    const base = computeAcademyStrategyFingerprints(dataset);
    const relabeled = mutableClone(dataset);
    relabeled.title = "Renamed dataset title";
    relabeled.actions[0].label = "Open 2.25";
    relabeled.actions[0].ru!.button = "Открыть";
    relabeled.provenance.note = "Edited comment";
    const after = fingerprints(relabeled);
    expect(after.content).toBe(base.content);
    expect(after.metadata).not.toBe(base.metadata);
  });

  it("changing any real frequency DOES change the content fingerprint (UTG AA 1.0 → 0.99)", () => {
    const base = computeAcademyStrategyFingerprints(dataset);
    const edited = mutableClone(dataset);
    edited.nodes.UTG.hands.AA = { RAISE_2_25BB: 0.99, FOLD: 0.01 };
    const after = fingerprints(edited);
    expect(after.content).not.toBe(base.content);
    expect(after.metadata).toBe(base.metadata);
  });

  it("changing action identity (size) or node action order changes content", () => {
    const base = computeAcademyStrategyFingerprints(dataset).content;
    const resized = mutableClone(dataset);
    resized.actions[0].amountBb = 2.5;
    expect(fingerprints(resized).content).not.toBe(base);
    const reordered = mutableClone(dataset);
    reordered.nodes.UTG.actionCodes = ["FOLD", "RAISE_2_25BB"];
    expect(fingerprints(reordered).content).not.toBe(base);
  });
});

describe("RERAISE normalized schema v1", () => {
  type MutableDoc = {
    schemaVersion: number;
    dataset: {
      id: string;
      actions: Array<{ code: string; kind: string; label: string }>;
      provenance: Record<string, unknown>;
      nodes: Array<{ key: string; actionCodes: string[]; hands: Record<string, Record<string, { frequency: number; evBb?: number }>> }>;
    };
  };
  function mutate(change: (doc: MutableDoc) => void) {
    const doc = clone(buildTestOnlyMultiActionDocument()) as unknown as MutableDoc;
    change(doc);
    return () => validateNormalizedSolverDatasetV1(doc);
  }

  it("accepts the TEST ONLY fixture and the exported production dataset", () => {
    expect(() => validateNormalizedSolverDatasetV1(buildTestOnlyMultiActionDocument())).not.toThrow();
    const exported = strategyDatasetToNormalizedV1(dataset);
    expect(() => validateNormalizedSolverDatasetV1(exported)).not.toThrow();
    // Round trip through the interchange format is content-identical.
    const roundTrip = normalizedSolverDatasetToStrategyDataset(exported);
    expect(serializeAcademyStrategyContentCanonical(roundTrip)).toBe(serializeAcademyStrategyContentCanonical(dataset));
    expect(serializeNormalizedSolverContentCanonical(exported)).toBe(serializeAcademyStrategyContentCanonical(dataset));
  });

  it("rejects a dataset id that already exists in the registry", () => {
    const doc = strategyDatasetToNormalizedV1(dataset);
    expect(() => validateNormalizedSolverDatasetV1(doc, { existingDatasetIds: listAcademyStrategyDatasetIds() }))
      .toThrow(/unique within the registry/);
  });

  it.each([
    ["unsupported schema version", mutate((d) => { d.schemaVersion = 2; }), /unsupported schemaVersion 2/],
    ["empty dataset id", mutate((d) => { d.dataset.id = " "; }), /id must be a non-empty string/],
    ["(9) duplicate action code", mutate((d) => { d.dataset.actions.push({ ...d.dataset.actions[1] }); }), /action codes must be unique/],
    ["unknown action kind", mutate((d) => { d.dataset.actions[0].kind = "LIMP"; }), /unknown kind LIMP/],
    ["empty action list", mutate((d) => { d.dataset.actions = []; }), /actions must be a non-empty list/],
    ["empty node list", mutate((d) => { d.dataset.nodes = []; }), /nodes must be a non-empty list/],
    ["duplicate node key", mutate((d) => { d.dataset.nodes.push(clone(d.dataset.nodes[0])); }), /node keys must be unique/],
    ["missing provenance derivation", mutate((d) => { delete d.dataset.provenance.derivation; }), /provenance.derivation/],
    ["(10) hand missing a declared action", mutate((d) => { delete d.dataset.nodes[0].hands.AKo.CALL; }), /AKo is missing action CALL/],
    ["hand with an extra action", mutate((d) => { d.dataset.nodes[0].hands.AKo.CHECK = { frequency: 0 }; }), /unknown action CHECK/],
    ["(11) frequency > 1", mutate((d) => { d.dataset.nodes[0].hands.AA.RAISE_7BB = { frequency: 1.01 }; }), /outside \[0, 1\]/],
    ["(12) negative frequency", mutate((d) => { d.dataset.nodes[0].hands.AKo.FOLD = { frequency: -0.1 }; }), /outside \[0, 1\]/],
    ["NaN frequency", mutate((d) => { d.dataset.nodes[0].hands.AKo.FOLD = { frequency: Number.NaN }; }), /outside \[0, 1\]/],
    ["(13) frequencies not summing to 1", mutate((d) => { d.dataset.nodes[0].hands.AKo.FOLD = { frequency: 0.2 }; }), /sum to/],
    ["(14) missing canonical hand", mutate((d) => { delete d.dataset.nodes[0].hands["72o"]; }), /missing hand 72o/],
    ["(15) unknown hand class", mutate((d) => { d.dataset.nodes[0].hands.KAo = clone(d.dataset.nodes[0].hands.AKo); }), /non-canonical hand KAo/],
    ["(16) NaN EV", mutate((d) => { d.dataset.nodes[0].hands.AKo.CALL.evBb = Number.NaN; }), /evBb NaN must be a finite number/],
    ["(16) Infinite EV", mutate((d) => { d.dataset.nodes[0].hands.AKo.CALL.evBb = Number.POSITIVE_INFINITY; }), /evBb Infinity must be a finite number/],
    ["unknown per-action field", mutate((d) => { (d.dataset.nodes[0].hands.AKo.CALL as Record<string, unknown>).ev = 1; }), /unknown field ev/],
  ])("rejects %s", (_name, run, message) => {
    expect(run).toThrow(AcademyStrategyDatasetValidationError);
    expect(run).toThrow(message);
  });

  it("(16) EV is optional; a finite EV is accepted, kept out of the runtime, but counted as content", () => {
    const withEv = clone(buildTestOnlyMultiActionDocument()) as unknown as MutableDoc;
    withEv.dataset.nodes[0].hands.AKo.CALL.evBb = 0.25;
    expect(() => validateNormalizedSolverDatasetV1(withEv)).not.toThrow();
    const runtime = normalizedSolverDatasetToStrategyDataset(withEv);
    expect(JSON.stringify(runtime)).not.toContain("evBb");
    const plain = serializeNormalizedSolverContentCanonical(buildTestOnlyMultiActionDocument());
    expect(serializeNormalizedSolverContentCanonical(withEv)).not.toBe(plain);
  });

  it("does not implement an HRC-specific import (explicit unimplemented boundary)", () => {
    expect(() => importHrcSolverExport({})).toThrow(AcademySolverImportNotImplementedError);
  });
});
