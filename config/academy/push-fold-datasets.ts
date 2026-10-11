/**
 * HoldemMath push/fold datasets — 9-max, 4 / 6 / 8 / 10 / 12 / 15 / 20 BB,
 * both ante variants (`dataAnte10` = 0.1 BB per player, `data` = no ante).
 *
 * Status: EXTERNAL_REFERENCE_LICENSED — CC BY 4.0, vendored byte-for-byte in
 * data/academy/reference/holdemmath-pushfold/ (pinned upstream commit and
 * SHA-256 per file in MANIFEST.json). Attribution is a license obligation and
 * is rendered on every player-facing Push/Fold screen.
 *
 * Registry: these datasets live in their OWN immutable registry, built with
 * the same platform primitives (`createAcademyStrategyDatasetRegistry` /
 * `lookupAcademyStrategyDataset`, own-key fail-closed lookup) as
 * `ACADEMY_STRATEGY_DATASETS`, but deliberately separate from it:
 * - the MTT preflop trainer's `getAcademyStrategyDataset` can never resolve a
 *   push/fold dataset (and the Push/Fold trainer can never resolve an MTT or
 *   HRC one) — isolation by construction on top of the two whitelists;
 * - the 1.3 MB source is only loaded by the Push/Fold module, not by every
 *   importer of the main registry (HRC lessons, MTT trainer);
 * - the main registry's pinned inventory stays exactly as shipped.
 *
 * Player-facing subset: `ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS` (ante10,
 * 4–15 BB). The no-ante variant and 20 BB are internal (validation) only.
 */
import manifest from "@/data/academy/reference/holdemmath-pushfold/MANIFEST.json";
import pushFoldCharts from "@/data/academy/reference/holdemmath-pushfold/pushfold_charts.json";
import {
  ACADEMY_HOLDEMMATH_PUSH_FOLD_DEPTHS_BB,
  holdemMathPushFoldDatasetId,
  type AcademyHoldemMathPushFoldAnteVariant,
  type AcademyHoldemMathPushFoldDepthBb,
} from "@/config/academy/solver-dataset-ids";
import {
  importHoldemMathPushFoldDataset,
  type PushFoldDatasetProfile,
  type PushFoldImportResult,
  type PushFoldSourceVariant,
} from "@/lib/academy/push-fold-import";
import {
  createAcademyStrategyDatasetRegistry,
  lookupAcademyStrategyDataset,
} from "@/lib/academy/solver";
import type { AcademyStrategyDataset } from "@/types/academy";

export const PUSH_FOLD_VERIFICATION_STATUS = "EXTERNAL_REFERENCE_LICENSED" as const;

export const PUSH_FOLD_ANTE_VARIANTS = Object.freeze(["ante10", "noante"] as const satisfies readonly AcademyHoldemMathPushFoldAnteVariant[]);

/** Player-facing reference variant of this release. */
export const PUSH_FOLD_PLAYER_FACING_VARIANT: AcademyHoldemMathPushFoldAnteVariant = "ante10";

const SOURCE_VARIANT: Readonly<Record<AcademyHoldemMathPushFoldAnteVariant, PushFoldSourceVariant>> = {
  ante10: "dataAnte10",
  noante: "data",
};

const ANTE_BB: Readonly<Record<AcademyHoldemMathPushFoldAnteVariant, number>> = { ante10: 0.1, noante: 0 };

type ManifestFile = (typeof manifest.files)[number];

function manifestFile(originalPath: string): ManifestFile {
  const entry = manifest.files.find((file) => file.originalPath === originalPath);
  if (!entry) throw new Error(`HoldemMath push/fold manifest has no file ${originalPath}`);
  return entry;
}

function buildProfile(
  depthBb: AcademyHoldemMathPushFoldDepthBb,
  variant: AcademyHoldemMathPushFoldAnteVariant,
): PushFoldDatasetProfile {
  const data = manifestFile("pushfold/pushfold_charts.json");
  const { repositoryUrl, commit, rawUrlTemplate, readmePath, licensePath } = manifest.source;
  const rawUrl = (path: string) => rawUrlTemplate.replace("{originalPath}", path);
  const anteLabel = variant === "ante10" ? "ante 0.1 BB" : "no ante";
  return {
    datasetId: holdemMathPushFoldDatasetId(depthBb, variant),
    version: 1,
    title: `HoldemMath push/fold · 9-max · ${depthBb} BB · ${anteLabel}`,
    depthBb,
    variant: SOURCE_VARIANT[variant],
    provenance: {
      provider: "HoldemMath (holdemmath.com)",
      scenario: `Nash push/fold charts, max9, ${depthBb} BB, ${SOURCE_VARIANT[variant]} (${data.originalPath})`,
      note:
        `${PUSH_FOLD_VERIFICATION_STATUS} (${manifest.license}). ${manifest.attribution.text}. ` +
        `${manifest.modelNotes.multiway} ${manifest.modelNotes.scope}`,
      derivation:
        "Per max9 seat key: '<SEAT>' → FIRST_IN_SHOVE_<SEAT> (ALL_IN / FOLD), '<CALLER>|<SHOVER>' → " +
        "CALL_VS_SHOVE_<CALLER>_VS_<SHOVER> (CALL / FOLD). Hands listed in s (indices into order) get the " +
        "non-fold action 1 / FOLD 0, all other hands FOLD 1. Upstream seat MP is named UTG2. EV (e) is not imported.",
      references: {
        repositoryUrl,
        sourceFileUrl: rawUrl(data.originalPath),
        sourceReadmeUrl: rawUrl(readmePath),
        sourceLicenseUrl: rawUrl(licensePath),
        licenseUrl: manifest.licenseUrl,
        attributionUrl: manifest.attribution.url,
      },
    },
    assumptions: {
      verificationStatus: PUSH_FOLD_VERIFICATION_STATUS,
      license: manifest.license,
      attribution: manifest.attribution.text,
      sourceCommit: commit,
      sourceFile: data.originalPath,
      sourceSha256: data.sha256,
      sourceFormat: "max9",
      sourceVariant: SOURCE_VARIANT[variant],
      antePerPlayerBb: ANTE_BB[variant],
      model: "CHIP_EV",
      multiwayModel: "SINGLE_CALLER_APPROXIMATION",
      sbFirstInFixedToHeadsUp: true,
      icm: false,
      rake: "RAKELESS",
      limps: false,
      seatNaming: "9-max (upstream MP = UTG2)",
      evImported: false,
    },
  };
}

type ImportKey = `${AcademyHoldemMathPushFoldDepthBb}:${AcademyHoldemMathPushFoldAnteVariant}`;

/** Import result per (depth, variant), built and validated at load. */
export const ACADEMY_PUSH_FOLD_IMPORTS: Readonly<Record<ImportKey, PushFoldImportResult>> = Object.freeze(
  Object.fromEntries(PUSH_FOLD_ANTE_VARIANTS.flatMap((variant) => ACADEMY_HOLDEMMATH_PUSH_FOLD_DEPTHS_BB.map((depthBb) => [
    `${depthBb}:${variant}`,
    importHoldemMathPushFoldDataset(pushFoldCharts, buildProfile(depthBb, variant)),
  ]))) as Record<ImportKey, PushFoldImportResult>,
);

export function getAcademyPushFoldImport(
  depthBb: AcademyHoldemMathPushFoldDepthBb,
  variant: AcademyHoldemMathPushFoldAnteVariant,
): PushFoldImportResult {
  return ACADEMY_PUSH_FOLD_IMPORTS[`${depthBb}:${variant}`];
}

/** Separate immutable registry of all 14 push/fold datasets (ante10 first, depth order). */
export const ACADEMY_PUSH_FOLD_STRATEGY_DATASETS = createAcademyStrategyDatasetRegistry(
  PUSH_FOLD_ANTE_VARIANTS.flatMap((variant) =>
    ACADEMY_HOLDEMMATH_PUSH_FOLD_DEPTHS_BB.map((depthBb) => getAcademyPushFoldImport(depthBb, variant).dataset)),
);

export function listAcademyPushFoldDatasetIds(): readonly string[] {
  return Object.keys(ACADEMY_PUSH_FOLD_STRATEGY_DATASETS);
}

/** Fail-closed (own keys only): throws `AcademyUnknownStrategyDatasetError` for unknown ids. */
export function getAcademyPushFoldDataset(datasetId: string): AcademyStrategyDataset {
  return lookupAcademyStrategyDataset(ACADEMY_PUSH_FOLD_STRATEGY_DATASETS, datasetId);
}
