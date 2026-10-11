/**
 * Push/Fold data audit — pinned regression fixture (docs/ACADEMY_PUSH_FOLD_AUDIT.md).
 *
 * Reads the REAL vendored HoldemMath file (byte-for-byte upstream, never
 * modified) and pins the numbers behind the product decision to take the 9-max
 * datasets out of SCORED training:
 * - Q4o at 10 BB, BB calling a UTG1 shove: IN the ante10 call range (EV +0.354
 *   BB in the source), OUT of the no-ante range (EV −0.502 BB);
 * - range breadth: ante10 UTG1 shoves 78.3% of combos, BB calls 59.6%;
 * - the importer reproduces exactly that membership (no mapping bug);
 * - the independent external MTT reference (jensbaagaard/poker-practice,
 *   EXTERNAL_REFERENCE_UNVERIFIED — a sanity comparison only, NOT an authority)
 *   is far tighter for the comparable spots.
 * If the vendored data ever changes, these assertions fail loudly.
 */
import { describe, expect, it } from "vitest";
import holdemMathManifest from "@/data/academy/reference/holdemmath-pushfold/MANIFEST.json";
import pushFoldCharts from "@/data/academy/reference/holdemmath-pushfold/pushfold_charts.json";
import mtt10 from "@/data/academy/reference/mtt-preflop/MTT_10_GTO.json";
import { getAcademyPushFoldDataset } from "@/config/academy/push-fold-datasets";
import { holdemMathPushFoldDatasetId } from "@/config/academy/solver-dataset-ids";

type RawRange = { s: number[]; p: number; e: number[] };
type RawCharts = {
  order: string[];
  anteVariants: Record<string, number>;
  data: { max9: Record<string, Record<string, RawRange>> };
  dataAnte10: { max9: Record<string, Record<string, RawRange>> };
};
const charts = pushFoldCharts as unknown as RawCharts;
const mtt = mtt10 as unknown as Record<string, Record<string, number>>;

const combos = (hand: string) => (hand.length === 2 ? 6 : hand.endsWith("s") ? 4 : 12);
const TOTAL_COMBOS = charts.order.reduce((sum, hand) => sum + combos(hand), 0);
const comboPercent = (members: readonly string[]) =>
  Math.round((members.reduce((sum, hand) => sum + combos(hand), 0) / TOTAL_COMBOS) * 1000) / 10;
const rawMembers = (range: RawRange) => range.s.map((index) => charts.order[index]);
/** Missing hand → 0 (the documented upstream policy for the sparse 10 BB file). */
const mttWeightedPercent = (key: string) =>
  Math.round((charts.order.reduce((sum, hand) => sum + combos(hand) * (mtt[key]?.[hand] ?? 0), 0) / TOTAL_COMBOS) * 1000) / 10;

const Q4O_INDEX = 132;
const ante10 = charts.dataAnte10.max9["10"];
const noAnte = charts.data.max9["10"];

describe("HoldemMath Q4o audit fixture (real vendored data)", () => {
  it("the vendored file is the pinned upstream file and documents the single-caller approximation", () => {
    expect(holdemMathManifest.files.find((file) => file.vendoredFile === "pushfold_charts.json")?.sha256)
      .toBe("00bc184e6b514888d23a8c2d8e9c3c83af2ac960b441310ba594c06b6cba9bec");
    expect(holdemMathManifest.modelNotes.multiway).toContain("SINGLE-CALLER APPROXIMATION");
    expect(holdemMathManifest.modelNotes.multiway).toContain("NOT a true multi-way Nash equilibrium");
    expect(charts.order).toHaveLength(169);
    expect(charts.order.indexOf("Q4o")).toBe(Q4O_INDEX);
  });

  it("(1) ante10, BB vs UTG1 shove at 10 BB: Q4o IS a call, EV +0.354 BB", () => {
    expect(ante10["BB|UTG1"].s).toContain(Q4O_INDEX);
    expect(ante10["BB|UTG1"].e[Q4O_INDEX]).toBe(0.354);
  });

  it("(1) no-ante, same spot: Q4o is NOT a call, EV −0.502 BB", () => {
    expect(noAnte["BB|UTG1"].s).not.toContain(Q4O_INDEX);
    expect(noAnte["BB|UTG1"].e[Q4O_INDEX]).toBe(-0.502);
  });

  it("(2) ante10 vs no-ante are genuinely different variants (not a mislabel): 0.1 BB vs 0 ante, different ranges", () => {
    expect(charts.anteVariants).toEqual({ data: 0, dataAnte10: 0.1 });
    expect(ante10["BB|UTG1"].p).toBe(59.6);
    expect(noAnte["BB|UTG1"].p).toBe(44.8);
    const onlyInAnte = rawMembers(ante10["BB|UTG1"]).filter((hand) => !rawMembers(noAnte["BB|UTG1"]).includes(hand));
    expect(onlyInAnte).toContain("Q4o");
    expect(rawMembers(noAnte["BB|UTG1"]).every((hand) => rawMembers(ante10["BB|UTG1"]).includes(hand))).toBe(true);
    // The importer keeps the variants apart: Q4o is CALL in ante10, FOLD in no-ante.
    expect(getAcademyPushFoldDataset(holdemMathPushFoldDatasetId(10, "ante10")).nodes.CALL_VS_SHOVE_BB_VS_UTG1.hands.Q4o)
      .toEqual({ CALL: 1, FOLD: 0 });
    expect(getAcademyPushFoldDataset(holdemMathPushFoldDatasetId(10, "noante")).nodes.CALL_VS_SHOVE_BB_VS_UTG1.hands.Q4o)
      .toEqual({ CALL: 0, FOLD: 1 });
  });

  it("coverage breadth: the source's own p equals the combo-weighted share — UTG1 shove 78.3%, BB call 59.6% (ante10)", () => {
    expect(ante10.UTG1.p).toBe(78.3);
    expect(comboPercent(rawMembers(ante10.UTG1))).toBe(78.3);
    expect(comboPercent(rawMembers(ante10["BB|UTG1"]))).toBe(59.6);
    // Per-seat sub-games: UTG and UTG1 come out with the same (very wide) shove range.
    expect(ante10.UTG.p).toBe(78.3);
    expect(ante10.UTG1.s).toEqual(ante10.UTG.s);
  });

  it("the importer reproduces the raw membership exactly for every hand (no mapping bug)", () => {
    const node = getAcademyPushFoldDataset(holdemMathPushFoldDatasetId(10, "ante10")).nodes.CALL_VS_SHOVE_BB_VS_UTG1;
    const members = new Set(rawMembers(ante10["BB|UTG1"]));
    for (const hand of charts.order) {
      expect(node.hands[hand as "AA"], hand).toEqual(members.has(hand) ? { CALL: 1, FOLD: 0 } : { CALL: 0, FOLD: 1 });
    }
  });
});

describe("sanity cross-check vs the external MTT reference (NOT an authority)", () => {
  it("10 BB (shove-or-fold in both sources, ~0.9–1 BB total ante): the external source is far tighter", () => {
    // External seat names: EP1 = UTG, EP2 = UTG1. At 10 BB its RFI raise is an all-in.
    expect(mttWeightedPercent("OpenEP2")).toBe(17.1);
    expect(mttWeightedPercent("CallBBvsEP2")).toBe(14.9);
    expect(mtt.CallBBvsEP2.Q4o).toBe(0);
    // vs HoldemMath ante10 for the same spots.
    expect(ante10.UTG1.p / mttWeightedPercent("OpenEP2")).toBeGreaterThan(4);
    expect(ante10["BB|UTG1"].p / mttWeightedPercent("CallBBvsEP2")).toBeGreaterThan(3.5);
  });
});
