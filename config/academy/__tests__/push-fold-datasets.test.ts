import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/data/academy/reference/holdemmath-pushfold/MANIFEST.json";
import pushFoldCharts from "@/data/academy/reference/holdemmath-pushfold/pushfold_charts.json";
import {
  ACADEMY_PUSH_FOLD_STRATEGY_DATASETS,
  PUSH_FOLD_PLAYER_FACING_VARIANT,
  getAcademyPushFoldDataset,
  getAcademyPushFoldImport,
  listAcademyPushFoldDatasetIds,
} from "@/config/academy/push-fold-datasets";
import {
  ACADEMY_PUSH_FOLD_PLAYER_STACKS_BB,
  ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS,
} from "@/config/academy/push-fold-trainer";
import { ACADEMY_PREFLOP_TRAINER_DATASET_IDS } from "@/config/academy/preflop-trainer";
import {
  ACADEMY_HOLDEMMATH_PUSH_FOLD_DEPTHS_BB,
  ACADEMY_HRC_SCENARIO_B_RFI_100BB_DATASET_ID,
  holdemMathPushFoldDatasetId,
} from "@/config/academy/solver-dataset-ids";
import { listAcademyStrategyDatasetIds } from "@/config/academy/solver-datasets";
import { CANONICAL_STARTING_HANDS } from "@/lib/academy/preflop";
import {
  AcademyPushFoldImportError,
  importHoldemMathPushFoldDataset,
  parsePushFoldSeatKey,
  PUSH_FOLD_SOURCE_SEATS,
  type PushFoldDatasetProfile,
} from "@/lib/academy/push-fold-import";
import {
  AcademyUnknownStrategyDatasetError,
  classifyStrategyHandBucket,
  resolveAcademyStrategyNodeAction,
  validateAcademyStrategyDataset,
} from "@/lib/academy/solver";

type PfRange = { s: number[]; p: number; e?: number[] };
type Charts = {
  v: number;
  depths: number[];
  order: string[];
  formats: { max9: { seats: string[] } };
  anteVariants: Record<string, number>;
  data: Record<string, Record<string, Record<string, PfRange>>>;
  dataAnte10: Record<string, Record<string, Record<string, PfRange>>>;
};
const charts = pushFoldCharts as unknown as Charts;

const REFERENCE_DIR = path.resolve(__dirname, "../../../data/academy/reference/holdemmath-pushfold");
const PINNED_COMMIT = "7c72b1261f08c63cf8366120dc531631935c21cd";
const EXPECTED_SHA256: Readonly<Record<string, string>> = {
  "pushfold_charts.json": "00bc184e6b514888d23a8c2d8e9c3c83af2ac960b441310ba594c06b6cba9bec",
  "LICENSE-DATA": "425705200f7957eb0713fc54bf080945ffea549e246ba8c62f51f1e59bd9c785",
  "README.md": "1a99a2aba01c48914d3fe59ca1ebba70d1c6ae7fafc7ad3c0f16a63ebca626c6",
};

function sourceHands(range: PfRange): Set<string> {
  return new Set(range.s.map((index) => charts.order[index]));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const PROFILE: PushFoldDatasetProfile = {
  datasetId: "test_only_pushfold_fixture",
  version: 1,
  title: "TEST ONLY push/fold fixture",
  depthBb: 8,
  variant: "dataAnte10",
  provenance: { provider: "test", scenario: "test", note: "", derivation: "test", references: {} },
  assumptions: {},
};

describe("HoldemMath vendoring + manifest", () => {
  it("(1) records the pinned source commit verbatim (and in every dataset)", () => {
    expect(manifest.source.commit).toBe(PINNED_COMMIT);
    expect(manifest.source.repositoryUrl).toBe("https://github.com/Julian-cloud-max/holdemmath-data");
    expect(manifest.source.rawUrlTemplate).toContain(`/${PINNED_COMMIT}/`);
    expect(manifest.source.rawUrlTemplate).not.toContain("/main/");
    for (const id of listAcademyPushFoldDatasetIds()) {
      const dataset = getAcademyPushFoldDataset(id);
      expect(dataset.assumptions.sourceCommit).toBe(PINNED_COMMIT);
      expect(dataset.provenance.references.sourceFileUrl).toContain(PINNED_COMMIT);
    }
  });

  it("(2) raw SHA-256 of each vendored file matches the pinned hashes and the manifest", () => {
    expect(manifest.files.map((file) => file.vendoredFile).sort()).toEqual(Object.keys(EXPECTED_SHA256).sort());
    for (const file of manifest.files) {
      const digest = createHash("sha256").update(readFileSync(path.join(REFERENCE_DIR, file.vendoredFile))).digest("hex");
      expect(digest).toBe(EXPECTED_SHA256[file.vendoredFile]);
      expect(file.sha256).toBe(EXPECTED_SHA256[file.vendoredFile]);
    }
    expect(manifest.files.find((file) => file.vendoredFile === "pushfold_charts.json")?.originalPath).toBe("pushfold/pushfold_charts.json");
  });

  it("(3) carries CC BY 4.0 license metadata: license id, verbatim attribution, source URL", () => {
    expect(manifest.license).toBe("CC-BY-4.0");
    expect(manifest.status).toBe("EXTERNAL_REFERENCE_LICENSED");
    const licenseText = readFileSync(path.join(REFERENCE_DIR, "LICENSE-DATA"), "utf8");
    expect(licenseText).toContain(manifest.attribution.text);
    expect(manifest.attribution.text).toBe("Data source: HoldemMath — https://holdemmath.com/");
    expect(manifest.attribution.url).toBe("https://holdemmath.com/");
    expect(manifest.modelNotes.multiway).toContain("SINGLE-CALLER APPROXIMATION");
    const dataset = getAcademyPushFoldDataset(holdemMathPushFoldDatasetId(10, "ante10"));
    expect(dataset.assumptions).toMatchObject({
      license: "CC-BY-4.0",
      attribution: manifest.attribution.text,
      verificationStatus: "EXTERNAL_REFERENCE_LICENSED",
      multiwayModel: "SINGLE_CALLER_APPROXIMATION",
      evImported: false,
    });
    expect(dataset.provenance.references).toMatchObject({
      repositoryUrl: manifest.source.repositoryUrl,
      attributionUrl: "https://holdemmath.com/",
    });
  });
});

describe("max9 parsing", () => {
  it("(4) recognizes exactly the 9 max9 seats and maps MP → UTG2", () => {
    expect(charts.formats.max9.seats).toEqual([...PUSH_FOLD_SOURCE_SEATS]);
    const dataset = getAcademyPushFoldDataset(holdemMathPushFoldDatasetId(10, "ante10"));
    const heroes = new Set(Object.values(dataset.provenance.nodeSources!).map((source) => source.heroPosition));
    expect([...heroes].sort()).toEqual(["BB", "BTN", "CO", "HJ", "LJ", "SB", "UTG", "UTG1", "UTG2"]);
    expect(dataset.provenance.nodeSources!.FIRST_IN_SHOVE_UTG2.sourceSeatKey).toBe("MP");
    expect(dataset.provenance.nodeSources!.CALL_VS_SHOVE_BB_VS_UTG2.sourceSeatKey).toBe("BB|MP");
  });

  it("(5) imports all 7 depths in both ante variants (only 4–15 are player-facing)", () => {
    expect(charts.depths).toEqual([...ACADEMY_HOLDEMMATH_PUSH_FOLD_DEPTHS_BB]);
    expect(listAcademyPushFoldDatasetIds()).toHaveLength(14);
    for (const variant of ["ante10", "noante"] as const) {
      for (const depth of ACADEMY_HOLDEMMATH_PUSH_FOLD_DEPTHS_BB) {
        const dataset = getAcademyPushFoldDataset(holdemMathPushFoldDatasetId(depth, variant));
        expect(dataset.metadata.effectiveStackBb).toBe(depth);
        expect(Object.keys(dataset.nodes)).toHaveLength(Object.keys(charts.dataAnte10.max9[String(depth)]).length);
        expect(Object.keys(dataset.nodes)).toHaveLength(44);
      }
    }
    expect(ACADEMY_PUSH_FOLD_PLAYER_STACKS_BB).toEqual([4, 6, 8, 10, 12, 15]);
    expect(ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS).not.toContain(holdemMathPushFoldDatasetId(20, "ante10"));
  });

  it("(6) the player-facing datasets are the dataAnte10 variant, not data", () => {
    expect(PUSH_FOLD_PLAYER_FACING_VARIANT).toBe("ante10");
    expect(ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS).toEqual(
      ACADEMY_PUSH_FOLD_PLAYER_STACKS_BB.map((stack) => holdemMathPushFoldDatasetId(stack, "ante10")));
    for (const id of ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS) {
      const dataset = getAcademyPushFoldDataset(id);
      expect(dataset.assumptions).toMatchObject({ sourceVariant: "dataAnte10", antePerPlayerBb: 0.1 });
    }
    // The two variants genuinely differ, and the player-facing node matches dataAnte10.
    const node = getAcademyPushFoldDataset(holdemMathPushFoldDatasetId(10, "ante10")).nodes.FIRST_IN_SHOVE_BTN;
    const ante = sourceHands(charts.dataAnte10.max9["10"].BTN);
    const noAnte = sourceHands(charts.data.max9["10"].BTN);
    expect(ante).not.toEqual(noAnte);
    for (const hand of CANONICAL_STARTING_HANDS) expect(node.hands[hand].ALL_IN).toBe(ante.has(hand) ? 1 : 0);
    const noAnteNode = getAcademyPushFoldDataset(holdemMathPushFoldDatasetId(10, "noante")).nodes.FIRST_IN_SHOVE_BTN;
    for (const hand of CANONICAL_STARTING_HANDS) expect(noAnteNode.hands[hand].ALL_IN).toBe(noAnte.has(hand) ? 1 : 0);
  });

  it("source order uses exactly this repo's canonical notation and 13x13 order (the importer still maps by name)", () => {
    expect([...charts.order].sort()).toEqual([...CANONICAL_STARTING_HANDS].sort());
    expect(charts.order).toEqual(CANONICAL_STARTING_HANDS);
  });
});

describe("node mapping", () => {
  it("(7) every node of every dataset has exactly the 169 canonical hands and validates", () => {
    for (const id of listAcademyPushFoldDatasetIds()) {
      const dataset = getAcademyPushFoldDataset(id);
      validateAcademyStrategyDataset(dataset);
      for (const node of Object.values(dataset.nodes)) {
        expect(Object.keys(node.hands).sort()).toEqual([...CANONICAL_STARTING_HANDS].sort());
      }
    }
  });

  it("(8, 15) FIRST_IN_SHOVE_BTN at 10 BB equals the raw dataAnte10 BTN s-array", () => {
    const dataset = getAcademyPushFoldDataset(holdemMathPushFoldDatasetId(10, "ante10"));
    const node = dataset.nodes.FIRST_IN_SHOVE_BTN;
    const raw = charts.dataAnte10.max9["10"].BTN;
    expect(node.actionCodes).toEqual(["ALL_IN", "FOLD"]);
    const inRange = CANONICAL_STARTING_HANDS.filter((hand) => node.hands[hand].ALL_IN === 1);
    expect(new Set(inRange)).toEqual(sourceHands(raw));
    expect(inRange).toHaveLength(raw.s.length);
    expect(raw.s).toHaveLength(140);
    expect(dataset.provenance.nodeSources!.FIRST_IN_SHOVE_BTN).toMatchObject({
      situation: "FIRST_IN_SHOVE", heroPosition: "BTN", sourceSeatKey: "BTN", sourceCoveragePercent: 75.6, sourceHandCount: 140,
    });
  });

  it("(9, 14) CALL_VS_SHOVE_BB_VS_SB at 8 BB equals the raw dataAnte10 'BB|SB' s-array", () => {
    const dataset = getAcademyPushFoldDataset(holdemMathPushFoldDatasetId(8, "ante10"));
    const node = dataset.nodes.CALL_VS_SHOVE_BB_VS_SB;
    const raw = charts.dataAnte10.max9["8"]["BB|SB"];
    expect(node.actionCodes).toEqual(["CALL", "FOLD"]);
    expect(new Set(CANONICAL_STARTING_HANDS.filter((hand) => node.hands[hand].CALL === 1))).toEqual(sourceHands(raw));
    expect(dataset.provenance.nodeSources!.CALL_VS_SHOVE_BB_VS_SB).toMatchObject({
      situation: "CALL_VS_SHOVE", heroPosition: "BB", villainPosition: "SB", sourceSeatKey: "BB|SB", sourceCoveragePercent: raw.p,
    });
    // BB|SB exists at every depth.
    for (const depth of ACADEMY_HOLDEMMATH_PUSH_FOLD_DEPTHS_BB) {
      expect(getAcademyPushFoldDataset(holdemMathPushFoldDatasetId(depth, "ante10")).nodes.CALL_VS_SHOVE_BB_VS_SB).toBeDefined();
    }
  });

  it("(16) a bare UTG first-in node exists wherever the source has a UTG key (all max9 depths)", () => {
    for (const depth of ACADEMY_HOLDEMMATH_PUSH_FOLD_DEPTHS_BB) {
      const raw = charts.dataAnte10.max9[String(depth)].UTG;
      expect(raw).toBeDefined();
      const node = getAcademyPushFoldDataset(holdemMathPushFoldDatasetId(depth, "ante10")).nodes.FIRST_IN_SHOVE_UTG;
      expect(new Set(CANONICAL_STARTING_HANDS.filter((hand) => node.hands[hand].ALL_IN === 1))).toEqual(sourceHands(raw));
    }
  });

  it("imports exactly the source keys present: 8 first-in (no BB) + 36 call keys, never a synthesized one", () => {
    for (const variant of ["data", "dataAnte10"] as const) {
      for (const depth of ACADEMY_HOLDEMMATH_PUSH_FOLD_DEPTHS_BB) {
        const keys = Object.keys(charts[variant].max9[String(depth)]);
        const result = getAcademyPushFoldImport(depth, variant === "data" ? "noante" : "ante10");
        expect(result.nodes.map((node) => node.sourceSeatKey).sort()).toEqual([...keys].sort());
        expect(result.nodes.filter((node) => node.situation === "FIRST_IN_SHOVE")).toHaveLength(8);
        expect(result.nodes.some((node) => node.nodeKey === "FIRST_IN_SHOVE_BB")).toBe(false);
      }
    }
  });

  it("(10) membership is exact for every node: in s → non-fold action exactly 1, otherwise FOLD exactly 1", () => {
    for (const variant of ["data", "dataAnte10"] as const) {
      for (const depth of ACADEMY_HOLDEMMATH_PUSH_FOLD_DEPTHS_BB) {
        const result = getAcademyPushFoldImport(depth, variant === "data" ? "noante" : "ante10");
        for (const descriptor of result.nodes) {
          const node = result.dataset.nodes[descriptor.nodeKey];
          const members = sourceHands(charts[variant].max9[String(depth)][descriptor.sourceSeatKey]);
          const action = node.actionCodes[0];
          for (const hand of CANONICAL_STARTING_HANDS) {
            expect(node.hands[hand]).toEqual(members.has(hand) ? { [action]: 1, FOLD: 0 } : { [action]: 0, FOLD: 1 });
          }
        }
      }
    }
  });

  it("(11) no fabricated mixed frequency anywhere: every value is exactly 0 or 1 and every hand is PURE", () => {
    let hands = 0;
    for (const id of listAcademyPushFoldDatasetIds()) {
      for (const node of Object.values(getAcademyPushFoldDataset(id).nodes)) {
        for (const hand of CANONICAL_STARTING_HANDS) {
          const frequencies = node.hands[hand];
          for (const value of Object.values(frequencies)) expect(value === 0 || value === 1).toBe(true);
          expect(classifyStrategyHandBucket(frequencies, node.actionCodes)).not.toBe("MIXED");
          // Any randomizer resolves the same pure action.
          expect(resolveAcademyStrategyNodeAction(node, hand, 0)).toBe(resolveAcademyStrategyNodeAction(node, hand, 99.9));
          hands += 1;
        }
      }
    }
    expect(hands).toBe(14 * 44 * 169);
  });
});

describe("fail closed", () => {
  it("imports the real source cleanly with the test profile (baseline for the corruption fixtures)", () => {
    expect(() => importHoldemMathPushFoldDataset(charts, PROFILE)).not.toThrow();
  });

  it("maps hand indices through order by NAME: a permuted order with re-indexed s gives identical nodes", () => {
    const permuted = clone(charts);
    const reversed = [...charts.order].reverse();
    const newIndex = new Map(reversed.map((hand, index) => [hand, index]));
    permuted.order = reversed;
    for (const range of Object.values(permuted.dataAnte10.max9["8"])) {
      range.s = range.s.map((index) => newIndex.get(charts.order[index])!);
    }
    const original = importHoldemMathPushFoldDataset(charts, PROFILE).dataset;
    const remapped = importHoldemMathPushFoldDataset(permuted, PROFILE).dataset;
    expect(remapped.nodes).toEqual(original.nodes);
  });

  it("(12) an out-of-range / non-integer / duplicate hand index rejects the whole import", () => {
    for (const bad of [169, -1, 3.5, "7"]) {
      const corrupted = clone(charts);
      corrupted.dataAnte10.max9["8"].BTN.s = [...corrupted.dataAnte10.max9["8"].BTN.s, bad as number];
      expect(() => importHoldemMathPushFoldDataset(corrupted, PROFILE)).toThrow(AcademyPushFoldImportError);
    }
    const duplicated = clone(charts);
    const s = duplicated.dataAnte10.max9["8"].BTN.s;
    duplicated.dataAnte10.max9["8"].BTN.s = [...s, s[0]];
    expect(() => importHoldemMathPushFoldDataset(duplicated, PROFILE)).toThrow(/listed twice/);
  });

  it("(13) an unknown seat key fails closed instead of synthesizing a node", () => {
    for (const key of ["BB", "XX", "UTG|BB", "SB|BTN|CO", "SB|SB", "UTG|CO", "__proto__x", "constructor"]) {
      expect(parsePushFoldSeatKey(key).kind).toBe("UNRECOGNIZED");
      const corrupted = clone(charts);
      corrupted.dataAnte10.max9["8"][key] = clone(corrupted.dataAnte10.max9["8"].BTN);
      expect(() => importHoldemMathPushFoldDataset(corrupted, PROFILE)).toThrow(/unrecognized seat key/);
    }
  });

  it("rejects a coverage p that does not match s, an unknown field, an empty range, malformed e, a bad order", () => {
    const cases: Array<(source: Charts) => void> = [
      (source) => { source.dataAnte10.max9["8"].BTN.p += 1; },
      (source) => { (source.dataAnte10.max9["8"].BTN as Record<string, unknown>).f = [0.5]; },
      (source) => { source.dataAnte10.max9["8"].BTN.s = []; },
      (source) => { source.dataAnte10.max9["8"].BTN.e = [1, 2]; },
      (source) => { source.order[0] = "AKs"; },
      (source) => { source.formats.max9.seats[2] = "UTG2"; },
      (source) => { source.anteVariants.dataAnte10 = 0.2; },
      (source) => { source.v = 2; },
      (source) => { delete (source.dataAnte10.max9 as Record<string, unknown>)["8"]; },
      (source) => { delete source.dataAnte10.max9["8"].SB; },
    ];
    for (const corrupt of cases) {
      const corrupted = clone(charts);
      corrupt(corrupted);
      expect(() => importHoldemMathPushFoldDataset(corrupted, PROFILE)).toThrow(AcademyPushFoldImportError);
    }
  });
});

describe("separate registry + whitelists", () => {
  it("lives in its own registry: disjoint ids, own-key fail-closed lookup, main registry untouched", () => {
    const main = listAcademyStrategyDatasetIds();
    for (const id of listAcademyPushFoldDatasetIds()) expect(main).not.toContain(id);
    expect(Object.isFrozen(ACADEMY_PUSH_FOLD_STRATEGY_DATASETS)).toBe(true);
    for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty", ACADEMY_HRC_SCENARIO_B_RFI_100BB_DATASET_ID,
      "external_mtt_preflop_9max_10bb_v1", "holdemmath_pushfold_9max_10bb_ante10_v2", ""]) {
      expect(() => getAcademyPushFoldDataset(id)).toThrow(AcademyUnknownStrategyDatasetError);
    }
  });

  it("the Push/Fold and MTT preflop trainer whitelists are disjoint and neither contains HRC", () => {
    for (const id of ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS) expect(ACADEMY_PREFLOP_TRAINER_DATASET_IDS).not.toContain(id);
    for (const id of ACADEMY_PREFLOP_TRAINER_DATASET_IDS) expect(ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS).not.toContain(id);
    expect(ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS).not.toContain(ACADEMY_HRC_SCENARIO_B_RFI_100BB_DATASET_ID);
  });
});
