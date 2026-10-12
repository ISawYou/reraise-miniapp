/**
 * External MTT preflop reference datasets — 5 / 10 / 20 / 40 / 100 BB.
 *
 * Status: EXTERNAL_REFERENCE_UNVERIFIED. Third-party range sets vendored
 * byte-for-byte in data/academy/reference/mtt-preflop/ (pinned upstream
 * commit and SHA-256 per file in MANIFEST.json). They are NOT RERAISE
 * solver outputs and are registered for internal evaluation only: no lesson
 * binding, no route, no player-facing surface.
 *
 * Built by the pure adapter in lib/academy/mtt-reference-import.ts. Coverage
 * audit: docs/ACADEMY_MTT_REFERENCE_COVERAGE.md.
 */
import {
  ACADEMY_EXTERNAL_MTT_PREFLOP_100BB_DATASET_ID,
  ACADEMY_EXTERNAL_MTT_PREFLOP_10BB_DATASET_ID,
  ACADEMY_EXTERNAL_MTT_PREFLOP_20BB_DATASET_ID,
  ACADEMY_EXTERNAL_MTT_PREFLOP_40BB_DATASET_ID,
  ACADEMY_EXTERNAL_MTT_PREFLOP_5BB_DATASET_ID,
} from "@/config/academy/solver-dataset-ids";
import manifest from "@/data/academy/reference/mtt-preflop/MANIFEST.json";
import mtt100 from "@/data/academy/reference/mtt-preflop/MTT_100_GTO.json";
import mtt10 from "@/data/academy/reference/mtt-preflop/MTT_10_GTO.json";
import mtt20 from "@/data/academy/reference/mtt-preflop/MTT_20_GTO.json";
import mtt40 from "@/data/academy/reference/mtt-preflop/MTT_40_GTO.json";
import mtt5 from "@/data/academy/reference/mtt-preflop/MTT_5_GTO.json";
import { ACADEMY_MTT_REFERENCE_SIZING_PROFILES } from "@/config/academy/preflop-sizing-profiles";
import {
  importMttReferenceDataset,
  type MttReferenceImportResult,
  type MttReferenceMissingHandPolicy,
  type MttReferenceStackProfile,
} from "@/lib/academy/mtt-reference-import";

export const MTT_REFERENCE_VERIFICATION_STATUS = "EXTERNAL_REFERENCE_UNVERIFIED" as const;

/**
 * The upstream README labels these sets "GTO" (with a 1 BB ante) but never
 * states chip-EV vs ICM, so no model is claimed.
 */
export const MTT_REFERENCE_STRATEGY_MODEL = "SOURCE_UNSTATED" as const;

export const MTT_REFERENCE_STACKS_BB = Object.freeze([5, 10, 20, 40, 100] as const);
export type MttReferenceStackBb = (typeof MTT_REFERENCE_STACKS_BB)[number];

type StackConfig = {
  readonly datasetId: string;
  readonly raw: unknown;
  readonly raiseIsAllIn: MttReferenceStackProfile["raiseIsAllIn"];
  /** Upstream sizing profile (README "Bet sizing profiles" table), descriptive only. */
  readonly sizing: Readonly<Record<string, string>>;
};

/** Per stack: data file + which aggressive actions are all-in per the upstream sizing table. */
const STACK_CONFIGS: Readonly<Record<MttReferenceStackBb, StackConfig>> = {
  5: {
    datasetId: ACADEMY_EXTERNAL_MTT_PREFLOP_5BB_DATASET_ID,
    raw: mtt5,
    raiseIsAllIn: { RFI: true, FACING_OPEN: true, FACING_3BET: true, FACING_4BET: true },
    sizing: { openSizing: "5 BB (shove)", threeBetSizing: "all-in", fourBetSizing: "all-in", fiveBetSizing: "all-in" },
  },
  10: {
    datasetId: ACADEMY_EXTERNAL_MTT_PREFLOP_10BB_DATASET_ID,
    raw: mtt10,
    raiseIsAllIn: { RFI: true, FACING_OPEN: true, FACING_3BET: true, FACING_4BET: true },
    sizing: { openSizing: "10 BB (shove)", threeBetSizing: "all-in", fourBetSizing: "all-in", fiveBetSizing: "all-in" },
  },
  20: {
    datasetId: ACADEMY_EXTERNAL_MTT_PREFLOP_20BB_DATASET_ID,
    raw: mtt20,
    raiseIsAllIn: { RFI: false, FACING_OPEN: true, FACING_3BET: true, FACING_4BET: true },
    sizing: { openSizing: "2 BB (SB 3 BB)", threeBetSizing: "all-in", fourBetSizing: "all-in", fiveBetSizing: "all-in" },
  },
  40: {
    datasetId: ACADEMY_EXTERNAL_MTT_PREFLOP_40BB_DATASET_ID,
    raw: mtt40,
    raiseIsAllIn: { RFI: false, FACING_OPEN: false, FACING_3BET: true, FACING_4BET: true },
    sizing: {
      openSizing: "2.3 BB (SB 3.5 BB)",
      threeBetSizing: "3x IP / 4x OOP of the open, max 9 BB IP / 10 BB OOP",
      fourBetSizing: "all-in",
      fiveBetSizing: "all-in",
    },
  },
  100: {
    datasetId: ACADEMY_EXTERNAL_MTT_PREFLOP_100BB_DATASET_ID,
    raw: mtt100,
    raiseIsAllIn: { RFI: false, FACING_OPEN: false, FACING_3BET: false, FACING_4BET: true },
    sizing: {
      openSizing: "2.3 BB (SB 4 BB)",
      threeBetSizing: "3.5x IP / 4.5x OOP of the open",
      fourBetSizing: "2.2x IP / 2.5x OOP of the 3-bet",
      fiveBetSizing: "all-in",
    },
  },
};

type ManifestFile = (typeof manifest.files)[number];

function manifestEntry(stackBb: number): ManifestFile {
  const entry = manifest.files.find((file) => file.effectiveStackBb === stackBb);
  if (!entry) throw new Error(`MTT reference manifest has no file for ${stackBb} BB`);
  return entry;
}

function buildProfile(stackBb: MttReferenceStackBb): MttReferenceStackProfile {
  const config = STACK_CONFIGS[stackBb];
  const file = manifestEntry(stackBb);
  const { repositoryUrl, commit, rawUrlTemplate, readmePath, semanticsReferencePath } = manifest.source;
  const rawUrl = (path: string) => rawUrlTemplate.replace("{originalPath}", path);
  return {
    datasetId: config.datasetId,
    version: 1,
    title: `External MTT preflop reference · 9-max · ${stackBb} BB (unverified)`,
    effectiveStackBb: stackBb,
    strategyModel: MTT_REFERENCE_STRATEGY_MODEL,
    missingHandPolicy: file.missingHandPolicy as MttReferenceMissingHandPolicy,
    raiseIsAllIn: config.raiseIsAllIn,
    provenance: {
      provider: "jensbaagaard/poker-practice (third-party range set)",
      scenario: `MTT ${stackBb} bb GTO range set (${file.originalPath})`,
      note:
        `${MTT_REFERENCE_VERIFICATION_STATUS}: third-party reference frequencies, not RERAISE solver output. ` +
        manifest.source.originNote,
      derivation:
        "Per spot: raise = conditional(raiseKey, prev), call = conditional(callKey, prev), fold = 1 - raise - call, " +
        "where conditional(w, p) = p > 0 ? min(1, w / p) : 0 and prev is hero's own previous action " +
        "(none for RFI and facing-open; Open<hero> for facing-3bet; 3Bet<hero>vs<villain> for facing-4bet; " +
        "4Bet<hero>vs<villain> for facing-5bet). All-fold and unreachable spots are not imported.",
      references: {
        repositoryUrl,
        sourceFileUrl: rawUrl(file.originalPath),
        sourceReadmeUrl: rawUrl(readmePath),
        sourceSemanticsUrl: rawUrl(semanticsReferencePath),
      },
    },
    assumptions: {
      verificationStatus: MTT_REFERENCE_VERIFICATION_STATUS,
      sourceCommit: commit,
      sourceFile: file.originalPath,
      sourceSha256: file.sha256,
      missingHandPolicy: file.missingHandPolicy,
      sourceSparsity: file.sparsity,
      seatNaming: "9-max (EP1=UTG, EP2=UTG1, EP3=UTG2)",
      anteBb: 1,
      ...config.sizing,
    },
  };
}

/**
 * The typed sizing profiles (config/academy/preflop-sizing-profiles.ts) are a
 * machine-readable companion of the descriptive `sizing` strings above. Fail
 * at load if their all-in levels ever drift from this file's `raiseIsAllIn`.
 */
const SIZING_LEVEL_OF_SCENARIO = { RFI: "OPEN", FACING_OPEN: "THREE_BET", FACING_3BET: "FOUR_BET", FACING_4BET: "FIVE_BET" } as const;
for (const stackBb of MTT_REFERENCE_STACKS_BB) {
  const profile = ACADEMY_MTT_REFERENCE_SIZING_PROFILES[stackBb];
  for (const [scenario, level] of Object.entries(SIZING_LEVEL_OF_SCENARIO)) {
    const allIn = STACK_CONFIGS[stackBb].raiseIsAllIn[scenario as keyof typeof SIZING_LEVEL_OF_SCENARIO];
    if (profile.stackBb !== stackBb || (profile.levels[level]?.kind === "ALL_IN") !== allIn) {
      throw new Error(`MTT reference ${stackBb} BB: typed sizing profile disagrees with raiseIsAllIn at ${scenario}`);
    }
  }
}

/** Import result (dataset + coverage report) per stack, built and validated at load. */
export const ACADEMY_MTT_REFERENCE_IMPORTS: Readonly<Record<MttReferenceStackBb, MttReferenceImportResult>> =
  Object.freeze(Object.fromEntries(MTT_REFERENCE_STACKS_BB.map((stackBb) => [
    stackBb,
    importMttReferenceDataset(STACK_CONFIGS[stackBb].raw, buildProfile(stackBb)),
  ])) as Record<MttReferenceStackBb, MttReferenceImportResult>);

/** The 5 datasets in stack order, for registry registration. */
export const ACADEMY_MTT_REFERENCE_DATASETS = Object.freeze(
  MTT_REFERENCE_STACKS_BB.map((stackBb) => ACADEMY_MTT_REFERENCE_IMPORTS[stackBb].dataset));
