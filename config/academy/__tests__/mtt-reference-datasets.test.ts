/**
 * External MTT preflop reference import (EXTERNAL_REFERENCE_UNVERIFIED).
 * Numbered comments map to the import task's required test list.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACADEMY_MTT_REFERENCE_DATASETS,
  ACADEMY_MTT_REFERENCE_IMPORTS,
  MTT_REFERENCE_STACKS_BB,
  type MttReferenceStackBb,
} from "@/config/academy/mtt-reference-datasets";
import { ACADEMY_HRC_SCENARIO_B_RFI_100BB_DATASET_ID } from "@/config/academy/solver-dataset-ids";
import { ACADEMY_STRATEGY_DATASETS, getAcademyStrategyDataset } from "@/config/academy/solver-datasets";
import { ACADEMY_SOLVER_LESSON_BINDINGS } from "@/config/academy/solver-lessons";
import manifest from "@/data/academy/reference/mtt-preflop/MANIFEST.json";
import {
  AcademyMttReferenceImportError,
  conditionalMttReferenceFrequencies,
  importMttReferenceDataset,
  parseMttReferenceScenarioKey,
  type MttReferenceStackProfile,
} from "@/lib/academy/mtt-reference-import";
import { CANONICAL_STARTING_HANDS } from "@/lib/academy/preflop";
import { ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON, validateAcademyStrategyDataset } from "@/lib/academy/solver";
import { computeAcademyStrategyFingerprints } from "@/lib/academy/solver-fingerprint";

const VENDOR_DIR = path.resolve(__dirname, "../../../data/academy/reference/mtt-preflop");
const SOURCE_COMMIT = "449993f78d995c77b72d0bcac418a8507dd6f783";

/** Hashes verified against the pinned upstream commit before vendoring. */
const EXPECTED_RAW_SHA256: Readonly<Record<string, string>> = {
  "MTT_5_GTO.json": "43fb474b134e57a4636c88367b797d313652eb60e01b119830ab18d6f33e95c7",
  "MTT_10_GTO.json": "611ab44222edb2ddef7e53086db75ab5498249aeaa1447e0f37165358709bc0c",
  "MTT_20_GTO.json": "87d432c8bf364ec7990422bad446e8d141e3f2d45f1897a59499e70c8b888e0b",
  "MTT_40_GTO.json": "043d0ae8ae926069ce3d2188a469e9776a7f74c9e147920147a734f063a5c70b",
  "MTT_100_GTO.json": "1ea6c6335a890e5b8bea7b53e5233234bf766937a14cd62f310a851960a3df15",
};

const DATASET_IDS: Readonly<Record<MttReferenceStackBb, string>> = {
  5: "external_mtt_preflop_9max_5bb_v1",
  10: "external_mtt_preflop_9max_10bb_v1",
  20: "external_mtt_preflop_9max_20bb_v1",
  40: "external_mtt_preflop_9max_40bb_v1",
  100: "external_mtt_preflop_9max_100bb_v1",
};

/** Same committed constant as solver-dataset-platform.test.ts (never update to pass). */
const HRC_EXPECTED_CONTENT_SHA256 = "888cfddd107a4ab6bdeeed9875834d0216e39b1402b21c05773ae9cac567de71";

type RawSource = Record<string, Record<string, number>>;

function rawSource(stack: number): RawSource {
  return JSON.parse(readFileSync(path.join(VENDOR_DIR, `MTT_${stack}_GTO.json`), "utf8")) as RawSource;
}

function dataset(stack: MttReferenceStackBb) {
  return ACADEMY_MTT_REFERENCE_IMPORTS[stack].dataset;
}

function report(stack: MttReferenceStackBb) {
  return ACADEMY_MTT_REFERENCE_IMPORTS[stack].report;
}

function hand(stack: MttReferenceStackBb, nodeKey: string, handClass: string) {
  const node = dataset(stack).nodes[nodeKey];
  expect(node, `${stack}bb ${nodeKey}`).toBeDefined();
  return (node.hands as Record<string, Record<string, number>>)[handClass];
}

function expectFrequencies(actual: Record<string, number>, expected: Record<string, number>) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [code, value] of Object.entries(expected)) expect(actual[code]).toBeCloseTo(value, 12);
}

// --- synthetic fixtures (never real data) ---------------------------------

function fullRange(value: number, overrides: Record<string, number> = {}): Record<string, number> {
  return { ...Object.fromEntries(CANONICAL_STARTING_HANDS.map((h) => [h, value])), ...overrides };
}

function fixtureProfile(overrides: Partial<MttReferenceStackProfile> = {}): MttReferenceStackProfile {
  return {
    datasetId: "fixture_mtt_reference_v1",
    version: 1,
    title: "Fixture",
    effectiveStackBb: 100,
    strategyModel: "SOURCE_UNSTATED",
    missingHandPolicy: "REJECT",
    raiseIsAllIn: { RFI: false, FACING_OPEN: false, FACING_3BET: false, FACING_4BET: true },
    provenance: { provider: "fixture", scenario: "fixture", note: "", derivation: "fixture", references: {} },
    assumptions: {},
    ...overrides,
  };
}

/** Minimal valid tree: CO opens, BTN 3-bets, CO 4-bets, BTN 5-bets. */
function fixtureSource(overrides: RawSource = {}): RawSource {
  return {
    OpenCO: fullRange(0.5),
    LimpCO: fullRange(0),
    "3BetBTNvsCO": fullRange(0.2),
    CallBTNvsCO: fullRange(0.3),
    "4BetCOvsBTN": fullRange(0.1),
    "Call 3BetCOvsBTN": fullRange(0.2),
    "5BetBTNvsCO": fullRange(0.1),
    "Call 4BetBTNvsCO": fullRange(0.05),
    "Call 5BetCOvsBTN": fullRange(0.05),
    EmptyRange: fullRange(0),
    WideRange: fullRange(1),
    ...overrides,
  };
}

/** An unrelated valid spot so a fixture whose CO tree is rejected still has a node. */
const INDEPENDENT_TREE: RawSource = { OpenBTN: fullRange(0.4) };

// ---------------------------------------------------------------------------

describe("vendored source + manifest", () => {
  it("(1) all 5 raw vendored source files are present", () => {
    for (const file of Object.keys(EXPECTED_RAW_SHA256)) {
      expect(existsSync(path.join(VENDOR_DIR, file)), file).toBe(true);
    }
    expect(manifest.files.map((file) => file.vendoredFile).sort()).toEqual(Object.keys(EXPECTED_RAW_SHA256).sort());
  });

  it("(2) raw SHA-256 fingerprints match the pinned-commit hashes exactly (and the manifest)", () => {
    for (const [file, expected] of Object.entries(EXPECTED_RAW_SHA256)) {
      const actual = createHash("sha256").update(readFileSync(path.join(VENDOR_DIR, file))).digest("hex");
      expect(actual, file).toBe(expected);
      expect(manifest.files.find((entry) => entry.vendoredFile === file)?.sha256).toBe(expected);
    }
  });

  it("(3) the pinned source commit is recorded verbatim in the manifest and dataset assumptions", () => {
    expect(manifest.source.commit).toBe(SOURCE_COMMIT);
    expect(manifest.source.repositoryUrl).toBe("https://github.com/jensbaagaard/poker-practice");
    expect(manifest.source.rawUrlTemplate).toContain(`/${SOURCE_COMMIT}/`);
    expect(manifest.status).toBe("EXTERNAL_REFERENCE_UNVERIFIED");
    for (const file of manifest.files) {
      expect(file.originalPath).toBe(`data/openSourcePokerData/${file.vendoredFile}`);
      expect(file.vendoredFile).toBe(`MTT_${file.effectiveStackBb}_GTO.json`);
    }
    for (const stack of MTT_REFERENCE_STACKS_BB) {
      expect(dataset(stack).assumptions.sourceCommit).toBe(SOURCE_COMMIT);
      expect(dataset(stack).assumptions.verificationStatus).toBe("EXTERNAL_REFERENCE_UNVERIFIED");
      expect(dataset(stack).provenance.references.sourceFileUrl).toContain(SOURCE_COMMIT);
    }
  });
});

describe("scenario key parsing", () => {
  it("(4) recognizes every documented pattern and ignores EmptyRange / WideRange", () => {
    expect(parseMttReferenceScenarioKey("OpenEP1")).toEqual({ kind: "SPOT", prefix: "Open", hero: "EP1" });
    expect(parseMttReferenceScenarioKey("LimpSB")).toEqual({ kind: "SPOT", prefix: "Limp", hero: "SB" });
    expect(parseMttReferenceScenarioKey("3BetBBvsBTN")).toEqual({ kind: "SPOT", prefix: "3Bet", hero: "BB", villain: "BTN" });
    expect(parseMttReferenceScenarioKey("CallBBvsBTN")).toEqual({ kind: "SPOT", prefix: "Call", hero: "BB", villain: "BTN" });
    expect(parseMttReferenceScenarioKey("4BetBTNvsBB")).toEqual({ kind: "SPOT", prefix: "4Bet", hero: "BTN", villain: "BB" });
    expect(parseMttReferenceScenarioKey("Call 3BetBTNvsBB")).toEqual({ kind: "SPOT", prefix: "Call 3Bet", hero: "BTN", villain: "BB" });
    expect(parseMttReferenceScenarioKey("5BetBBvsBTN")).toEqual({ kind: "SPOT", prefix: "5Bet", hero: "BB", villain: "BTN" });
    expect(parseMttReferenceScenarioKey("Call 4BetBBvsBTN")).toEqual({ kind: "SPOT", prefix: "Call 4Bet", hero: "BB", villain: "BTN" });
    expect(parseMttReferenceScenarioKey("Call 5BetBTNvsBB")).toEqual({ kind: "SPOT", prefix: "Call 5Bet", hero: "BTN", villain: "BB" });
    expect(parseMttReferenceScenarioKey("EmptyRange")).toEqual({ kind: "HELPER" });
    expect(parseMttReferenceScenarioKey("WideRange")).toEqual({ kind: "HELPER" });

    for (const stack of MTT_REFERENCE_STACKS_BB) {
      const keys = Object.keys(rawSource(stack));
      expect(keys).toHaveLength(271);
      const kinds = keys.map((key) => parseMttReferenceScenarioKey(key).kind);
      expect(kinds.filter((kind) => kind === "HELPER")).toHaveLength(2);
      expect(kinds.filter((kind) => kind === "UNRECOGNIZED")).toHaveLength(0);
      expect([...report(stack).ignoredHelperKeys].sort()).toEqual(["EmptyRange", "WideRange"]);
      expect(Object.keys(dataset(stack).nodes).some((key) => /Empty|Wide/i.test(key))).toBe(false);
    }
  });

  it("(11) unknown / malformed key formats are UNRECOGNIZED and ignored, never guessed at", () => {
    for (const key of ["OpenUTG", "Open", "OpenBTNvsCO", "3BetBB", "3BetBBvsBB", "Squeeze BBvsBTN", "call 3BetBTNvsBB", "4BetBTNvsBBvsSB", "Call3BetBTNvsBB", "Iso BTN"]) {
      expect(parseMttReferenceScenarioKey(key), key).toEqual({ kind: "UNRECOGNIZED" });
    }
    const { dataset: imported, report: fixtureReport } = importMttReferenceDataset(
      fixtureSource({ "Squeeze BBvsBTN": fullRange(1), OpenUTG: fullRange(1) }),
      fixtureProfile(),
    );
    expect([...fixtureReport.ignoredUnrecognizedKeys].sort()).toEqual(["OpenUTG", "Squeeze BBvsBTN"]);
    expect(Object.keys(imported.nodes)).toEqual([
      "RFI_CO", "FACING_OPEN_BTN_VS_CO", "FACING_3BET_CO_VS_BTN", "FACING_4BET_BTN_VS_CO", "FACING_5BET_CO_VS_BTN",
    ]);
  });
});

describe("hand normalization and missing hands", () => {
  it("(5) 169-hand normalization: dense 40bb node and sparse 100bb node (omitted hand → 0)", () => {
    const dense = rawSource(40);
    expect(Object.keys(dense.OpenCO)).toHaveLength(169);
    const sparse = rawSource(100);
    expect(Object.keys(sparse["3BetBBvsBTN"]).length).toBeLessThan(169);
    expect(sparse["3BetBBvsBTN"]["72o"]).toBeUndefined();
    expect(sparse.CallBBvsBTN["72o"]).toBeUndefined();

    for (const [stack, key] of [[40, "RFI_CO"], [100, "FACING_OPEN_BB_VS_BTN"]] as const) {
      expect(Object.keys(dataset(stack).nodes[key].hands).sort()).toEqual([...CANONICAL_STARTING_HANDS].sort());
    }
    expectFrequencies(hand(100, "FACING_OPEN_BB_VS_BTN", "72o"), { RAISE: 0, CALL: 0, FOLD: 1 });
    expectFrequencies(hand(40, "RFI_CO", "72o"), { RAISE: 0, FOLD: 1 });
    const node100 = report(100).nodes.find((node) => node.nodeKey === "FACING_OPEN_BB_VS_BTN")!;
    expect(node100.zeroFilledHandLookups).toBeGreaterThan(0);
    expect(report(40).nodes.every((node) => node.zeroFilledHandLookups === 0)).toBe(true);
    expect(report(5).nodes.every((node) => node.zeroFilledHandLookups === 0)).toBe(true);
  });

  it("(6) missing hand → 0 only where the file's policy allows; a scenario-level absent key produces NO node", () => {
    expect(manifest.files.find((file) => file.effectiveStackBb === 100)?.missingHandPolicy).toBe("ZERO");
    expect(manifest.files.find((file) => file.effectiveStackBb === 5)?.missingHandPolicy).toBe("REJECT");
    expect(manifest.files.find((file) => file.effectiveStackBb === 40)?.missingHandPolicy).toBe("REJECT");

    // Dense-policy file with a hole: fail closed, no zero-fill.
    const holed = fixtureSource();
    delete holed.OpenCO.AA;
    expect(() => importMttReferenceDataset(holed, fixtureProfile({ missingHandPolicy: "REJECT" })))
      .toThrow(AcademyMttReferenceImportError);
    // Same hole under the documented sparse policy: AA resolves to 0.
    const sparse = importMttReferenceDataset(holed, fixtureProfile({ missingHandPolicy: "ZERO" }));
    expectFrequencies((sparse.dataset.nodes.RFI_CO.hands as Record<string, Record<string, number>>).AA, { RAISE: 0, FOLD: 1 });

    // Scenario keys that do not exist upstream never become (zero-filled) nodes.
    for (const stack of MTT_REFERENCE_STACKS_BB) {
      const raw = rawSource(stack);
      expect(raw.OpenBB).toBeUndefined();
      expect(raw["4BetBBvsBTN"]).toBeUndefined();
      const keys = Object.keys(dataset(stack).nodes);
      expect(keys).not.toContain("RFI_BB");
      expect(keys.some((key) => key.startsWith("FACING_3BET_BB_"))).toBe(false);
      expect(keys.some((key) => key.startsWith("FACING_5BET_BB_"))).toBe(false);
    }
    // A fixture without any CO→BTN 3-bet keys has no FACING_3BET node at all.
    const noThreeBet = fixtureSource();
    delete noThreeBet["4BetCOvsBTN"];
    delete noThreeBet["Call 3BetCOvsBTN"];
    const imported = importMttReferenceDataset(noThreeBet, fixtureProfile());
    expect(Object.keys(imported.dataset.nodes)).not.toContain("FACING_3BET_CO_VS_BTN");
    expect(imported.report.rejected.map((outcome) => outcome.nodeKey)).not.toContain("FACING_3BET_CO_VS_BTN");
  });
});

describe("fold derivation and conditional normalization", () => {
  it("(7) fold = 1 - raise - call for known RFI and facing-open nodes (hand-computed)", () => {
    // 20bb OpenSB / LimpSB raw: 77 = 0.63 / 0.36, T8o = 0.35 / 0.64, 64o = 0 / 0.67.
    expectFrequencies(hand(20, "RFI_SB", "77"), { RAISE: 0.63, LIMP: 0.36, FOLD: 0.01 });
    expectFrequencies(hand(20, "RFI_SB", "T8o"), { RAISE: 0.35, LIMP: 0.64, FOLD: 0.01 });
    expectFrequencies(hand(20, "RFI_SB", "64o"), { RAISE: 0, LIMP: 0.67, FOLD: 0.33 });
    // 40bb OpenCO raw: A6o = 0.513554238 (no limp at 40bb CO).
    expectFrequencies(hand(40, "RFI_CO", "A6o"), { RAISE: 0.513554238, FOLD: 0.486445762 });
    // 100bb 3BetBBvsBTN / CallBBvsBTN raw: K9o = 0.14 / 0.86, 85o = (absent) / 0.47, 76s = 0.9 / 0.1.
    expectFrequencies(hand(100, "FACING_OPEN_BB_VS_BTN", "K9o"), { RAISE: 0.14, CALL: 0.86, FOLD: 0 });
    expectFrequencies(hand(100, "FACING_OPEN_BB_VS_BTN", "85o"), { RAISE: 0, CALL: 0.47, FOLD: 0.53 });
    expectFrequencies(hand(100, "FACING_OPEN_BB_VS_BTN", "76s"), { RAISE: 0.9, CALL: 0.1, FOLD: 0 });
  });

  it("conditional() reproduces the upstream formula exactly", () => {
    expect(conditionalMttReferenceFrequencies({ a: 0.2 }, null)).toEqual({ a: 0.2 });
    expect(conditionalMttReferenceFrequencies(undefined, { a: 1 })).toEqual({});
    expect(conditionalMttReferenceFrequencies({ a: 0.1, b: 0.5, c: 0.3, d: 0.4 }, { a: 0.2, b: 0.25, c: 0 }))
      .toEqual({ a: 0.5, b: 1, c: 0, d: 0 });
  });

  it("(8) vs-3bet / vs-4bet / vs-5bet frequencies equal conditional(raw, hero's previous node)", () => {
    // vs 3-bet, 100bb UTG(EP1) vs BTN, prev = OpenEP1: 44 = call 0.82 / 0.85; 76s = 4bet 0.05, call 0.18 / 0.23.
    expectFrequencies(hand(100, "FACING_3BET_UTG_VS_BTN", "44"), { RAISE: 0, CALL: 0.82 / 0.85, FOLD: 1 - 0.82 / 0.85 });
    expectFrequencies(hand(100, "FACING_3BET_UTG_VS_BTN", "76s"), { RAISE: 0.05 / 0.23, CALL: 0.18 / 0.23, FOLD: 1 - 0.05 / 0.23 - 0.18 / 0.23 });
    // vs 4-bet, 100bb BB vs BTN, prev = 3BetBBvsBTN: 77 = 0.01, 0.13 / 0.2; 88 = 0.136, 0.204 / 0.34.
    expectFrequencies(hand(100, "FACING_4BET_BB_VS_BTN", "77"), { ALL_IN: 0.05, CALL: 0.65, FOLD: 0.3 });
    expectFrequencies(hand(100, "FACING_4BET_BB_VS_BTN", "88"), { ALL_IN: 0.4, CALL: 0.6, FOLD: 0 });
    // vs 5-bet, 100bb BTN vs BB, prev = 4BetBTNvsBB: AQo = 0.01 / 0.12; AA = 0.67 / 0.67. No raise action.
    expectFrequencies(hand(100, "FACING_5BET_BTN_VS_BB", "AQo"), { CALL: 0.01 / 0.12, FOLD: 1 - 0.01 / 0.12 });
    expectFrequencies(hand(100, "FACING_5BET_BTN_VS_BB", "AA"), { CALL: 1, FOLD: 0 });
    expect(dataset(100).nodes.FACING_5BET_BTN_VS_BB.actionCodes).toEqual(["CALL", "FOLD"]);

    // Every hand of these three nodes, independently recomputed from the raw file.
    const raw = rawSource(100);
    const cases = [
      { node: "FACING_3BET_UTG_VS_BTN", raise: ["RAISE", "4BetEP1vsBTN"], call: "Call 3BetEP1vsBTN", prev: "OpenEP1" },
      { node: "FACING_4BET_BB_VS_BTN", raise: ["ALL_IN", "5BetBBvsBTN"], call: "Call 4BetBBvsBTN", prev: "3BetBBvsBTN" },
      { node: "FACING_5BET_BTN_VS_BB", raise: null, call: "Call 5BetBTNvsBB", prev: "4BetBTNvsBB" },
    ] as const;
    for (const { node, raise, call, prev } of cases) {
      for (const handClass of CANONICAL_STARTING_HANDS) {
        const p = raw[prev][handClass] ?? 0;
        const cond = (key: string) => (p > 0 ? Math.min(1, (raw[key][handClass] ?? 0) / p) : 0);
        const expected: Record<string, number> = {};
        if (raise) expected[raise[0]] = cond(raise[1]);
        expected.CALL = cond(call);
        expected.FOLD = Math.max(0, 1 - Object.values(expected).reduce((a, b) => a + b, 0));
        expectFrequencies(hand(100, node, handClass), expected);
      }
    }
  });

  it("(9) a negative fold remainder beyond tolerance is rejected, not clamped", () => {
    // vs-4bet: prev 3Bet = 0.2, 5Bet = 0.15, Call 4Bet = 0.15 → 0.75 + 0.75 = 1.5 → fold -0.5.
    const { dataset: imported, report: fixtureReport } = importMttReferenceDataset(
      fixtureSource({ "5BetBTNvsCO": fullRange(0.15), "Call 4BetBTNvsCO": fullRange(0.15) }),
      fixtureProfile(),
    );
    expect(imported.nodes.FACING_4BET_BTN_VS_CO).toBeUndefined();
    expect(fixtureReport.rejected).toContainEqual(expect.objectContaining({
      nodeKey: "FACING_4BET_BTN_VS_CO", reason: "NEGATIVE_FOLD_REMAINDER",
    }));
    // Downstream spot (needs the rejected node's 5-bet) is unreachable, not invented.
    expect(fixtureReport.rejected).toContainEqual(expect.objectContaining({
      nodeKey: "FACING_5BET_CO_VS_BTN", reason: "UNREACHABLE_VILLAIN_ACTION_EMPTY",
    }));
    // Barely beyond tolerance is still rejected.
    const tiny = importMttReferenceDataset(
      fixtureSource({ OpenCO: fullRange(0.6), LimpCO: fullRange(0.4 + 10 * ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON), ...INDEPENDENT_TREE }),
      fixtureProfile(),
    );
    expect(tiny.report.rejected.map((outcome) => outcome.nodeKey)).toContain("RFI_CO");
  });

  it("(10) raise + call summing above 1 + epsilon is rejected; within epsilon is accepted", () => {
    const over = importMttReferenceDataset(
      fixtureSource({ OpenCO: fullRange(0.5, { AKs: 0.9 }), LimpCO: fullRange(0, { AKs: 0.6 }), ...INDEPENDENT_TREE }),
      fixtureProfile(),
    );
    expect(over.report.rejected).toContainEqual(expect.objectContaining({ nodeKey: "RFI_CO", reason: "NEGATIVE_FOLD_REMAINDER" }));
    expect(over.report.rejected.find((outcome) => outcome.nodeKey === "RFI_CO")?.detail).toMatch(/AKs/);
    expect(over.dataset.nodes.RFI_CO).toBeUndefined();

    const within = importMttReferenceDataset(
      fixtureSource({ OpenCO: fullRange(0.6), LimpCO: fullRange(0.4 + ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON / 10) }),
      fixtureProfile(),
    );
    expect(within.dataset.nodes.RFI_CO).toBeDefined();
    expect((within.dataset.nodes.RFI_CO.hands as Record<string, Record<string, number>>).AA.FOLD).toBe(0);

    // Out-of-range raw source values fail the whole file.
    expect(() => importMttReferenceDataset(fixtureSource({ OpenCO: fullRange(1.2) }), fixtureProfile()))
      .toThrow(AcademyMttReferenceImportError);
  });
});

describe("registered datasets", () => {
  it("(12) node keys are unique within each dataset and across all 5 (stack-qualified)", () => {
    const all: string[] = [];
    for (const stack of MTT_REFERENCE_STACKS_BB) {
      const descriptors = report(stack).nodes.map((node) => node.nodeKey);
      expect(new Set(descriptors).size).toBe(descriptors.length);
      expect(Object.keys(dataset(stack).nodes)).toEqual(descriptors);
      for (const key of Object.keys(dataset(stack).nodes)) {
        expect(dataset(stack).nodes[key].key).toBe(key);
        all.push(`${dataset(stack).id}/${key}`);
      }
    }
    expect(new Set(all).size).toBe(all.length);
  });

  it("(13) all 5 datasets pass the existing generic validator and are registered (never bound to a lesson)", () => {
    expect(ACADEMY_MTT_REFERENCE_DATASETS.map((entry) => entry.id)).toEqual(MTT_REFERENCE_STACKS_BB.map((stack) => DATASET_IDS[stack]));
    for (const stack of MTT_REFERENCE_STACKS_BB) {
      const registered = getAcademyStrategyDataset(DATASET_IDS[stack]);
      expect(registered).toBe(dataset(stack));
      expect(() => validateAcademyStrategyDataset(registered)).not.toThrow();
      expect(registered.metadata).toEqual({
        game: "NLHE", format: "MTT", strategyModel: "SOURCE_UNSTATED", tableSize: 9, effectiveStackBb: stack, spotCode: "PREFLOP_TREE",
      });
      expect(Object.isFrozen(registered)).toBe(true);
    }
    const bound = new Set(ACADEMY_SOLVER_LESSON_BINDINGS.map((binding) => binding.datasetId));
    for (const id of Object.values(DATASET_IDS)) expect(bound.has(id)).toBe(false);
  });

  it("every node stores hero / villain / scenario in provenance.nodeSources", () => {
    for (const stack of MTT_REFERENCE_STACKS_BB) {
      const sources = dataset(stack).provenance.nodeSources!;
      for (const descriptor of report(stack).nodes) {
        expect(sources[descriptor.nodeKey]).toMatchObject({ scenario: descriptor.scenario, heroPosition: descriptor.heroPosition });
        if (descriptor.scenario === "RFI") expect(sources[descriptor.nodeKey].villainPosition).toBeUndefined();
        else expect(sources[descriptor.nodeKey].villainPosition).toBe(descriptor.villainPosition);
      }
    }
  });

  it("(14) BB vs BTN nodes exist where the source provides them", () => {
    expect(rawSource(100)["3BetBBvsBTN"]).toBeDefined();
    expect(rawSource(100)["5BetBBvsBTN"]).toBeDefined();
    for (const stack of MTT_REFERENCE_STACKS_BB) {
      expect(dataset(stack).nodes.FACING_OPEN_BB_VS_BTN, `${stack}bb`).toBeDefined();
    }
    expect(dataset(100).nodes.FACING_4BET_BB_VS_BTN.actionCodes).toEqual(["ALL_IN", "CALL", "FOLD"]);
    expect(dataset(100).nodes.FACING_OPEN_BB_VS_BTN.actionCodes).toEqual(["RAISE", "CALL", "FOLD"]);
    expect(dataset(40).nodes.FACING_4BET_BB_VS_BTN.actionCodes).toEqual(["CALL", "FOLD"]);
    expect(dataset(5).nodes.FACING_OPEN_BB_VS_BTN.actionCodes).toEqual(["CALL", "FOLD"]);
    expect(dataset(100).provenance.nodeSources!.FACING_OPEN_BB_VS_BTN).toMatchObject({
      heroPosition: "BB", villainPosition: "BTN", raiseSourceKey: "3BetBBvsBTN", callSourceKey: "CallBBvsBTN",
    });
  });

  it("(15) SB vs BTN nodes exist where the source provides them", () => {
    for (const stack of MTT_REFERENCE_STACKS_BB) {
      expect(rawSource(stack).CallSBvsBTN).toBeDefined();
      expect(dataset(stack).nodes.FACING_OPEN_SB_VS_BTN, `${stack}bb`).toBeDefined();
    }
    expect(dataset(100).nodes.FACING_4BET_SB_VS_BTN).toBeDefined();
    expect(dataset(100).nodes.FACING_3BET_BTN_VS_SB).toBeDefined();
  });

  it("(16) blind-vs-blind coverage matches what the source supports per stack", () => {
    const bvb = (stack: MttReferenceStackBb) => report(stack).nodes
      .filter((node) => ["SB", "BB"].includes(node.heroPosition) && ["SB", "BB"].includes(node.villainPosition ?? ""))
      .map((node) => node.nodeKey);
    expect(bvb(5)).toEqual(["FACING_OPEN_BB_VS_SB"]);
    expect(bvb(10)).toEqual(["FACING_OPEN_BB_VS_SB"]);
    expect(bvb(20)).toEqual(["FACING_OPEN_BB_VS_SB", "FACING_3BET_SB_VS_BB"]);
    expect(bvb(40)).toEqual(["FACING_OPEN_BB_VS_SB", "FACING_3BET_SB_VS_BB", "FACING_4BET_BB_VS_SB"]);
    expect(bvb(100)).toEqual(["FACING_OPEN_BB_VS_SB", "FACING_3BET_SB_VS_BB", "FACING_4BET_BB_VS_SB", "FACING_5BET_SB_VS_BB"]);
    for (const stack of MTT_REFERENCE_STACKS_BB) expect(dataset(stack).nodes.RFI_SB).toBeDefined();
    // At 5bb the upstream 3BetBBvsSB key is all-zero → SB facing a 3-bet is not reachable.
    expect(Object.values(rawSource(5)["3BetBBvsSB"]).every((value) => value === 0)).toBe(true);
    expect(report(5).rejected.map((outcome) => outcome.nodeKey)).toContain("FACING_3BET_SB_VS_BB");
    // SB limp option only where upstream LimpSB has data (20bb, 100bb).
    const withLimp = MTT_REFERENCE_STACKS_BB.filter((stack) => dataset(stack).nodes.RFI_SB.actionCodes.includes("LIMP"));
    expect(withLimp).toEqual([20, 100]);
  });

  it("pins node counts and rejections (drift guard for the coverage report)", () => {
    const counts = Object.fromEntries(MTT_REFERENCE_STACKS_BB.map((stack) => [stack, Object.keys(dataset(stack).nodes).length]));
    expect(counts).toEqual({ 5: 44, 10: 44, 20: 80, 40: 114, 100: 152 });
    expect(report(40).rejected.filter((outcome) => outcome.reason === "NEGATIVE_FOLD_REMAINDER").map((outcome) => outcome.nodeKey))
      .toEqual(["FACING_4BET_CO_VS_UTG", "FACING_4BET_BB_VS_LJ"]);
    expect(report(100).rejected.map((outcome) => outcome.nodeKey)).toEqual(["FACING_3BET_BTN_VS_CO"]);
    for (const stack of MTT_REFERENCE_STACKS_BB) {
      expect(report(stack).rejected.every((outcome) =>
        outcome.reason === "UNREACHABLE_VILLAIN_ACTION_EMPTY" || outcome.reason === "NEGATIVE_FOLD_REMAINDER")).toBe(true);
    }
  });
});

describe("existing HRC 100bb dataset is untouched", () => {
  it("(17) HRC dataset is still registered first with an unchanged content fingerprint", () => {
    expect(Object.keys(ACADEMY_STRATEGY_DATASETS)[0]).toBe(ACADEMY_HRC_SCENARIO_B_RFI_100BB_DATASET_ID);
    const hrc = getAcademyStrategyDataset(ACADEMY_HRC_SCENARIO_B_RFI_100BB_DATASET_ID);
    expect(computeAcademyStrategyFingerprints(hrc).content).toBe(HRC_EXPECTED_CONTENT_SHA256);
    expect(ACADEMY_SOLVER_LESSON_BINDINGS.every((binding) => binding.datasetId === ACADEMY_HRC_SCENARIO_B_RFI_100BB_DATASET_ID)).toBe(true);
  });
});
