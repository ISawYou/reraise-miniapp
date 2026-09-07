// Phase 2B.3: guarded, idempotent production backfill of 512x512 "card"
// derivatives for the seven LEGACY tournament visual types (Crazy Pineapple
// already has its own committed built-in derivative and is explicitly
// excluded here -- see config/tournament-visuals.ts's
// DEFAULT_TOURNAMENT_CARD_VISUALS).
//
// Runs two ways:
//   1. Imported for its pure, side-effect-free functions (URL
//      classification, canonical JSON/plan hashing, config transform,
//      destination-collision checks) -- see
//      lib/__tests__/... / scripts/__tests__/... for focused local tests
//      that need no production access at all.
//   2. Piped into `docker exec -i re-raise node --input-type=module` by
//      .github/workflows/tournament-artwork-backfill.yml, which sets
//      TOURNAMENT_BACKFILL_ENTRY=1 to opt into actually running main()
//      against the real running container's filesystem/DB -- see the
//      bottom of this file. Plain `node`/`import` (including every local
//      test) never sets that var, so importing this module is always safe.
//
// Uses ONLY dependencies already present inside the running app container
// (sharp, postgres) -- see lib/tournament-visual-card-derivative.ts (the
// same resize/fit/background/PNG-encode parameters are duplicated here,
// not imported, since this plain .mjs script cannot import that TS module
// without Next's compiler -- same reasoning as
// scripts/generate-tournament-card-derivatives.mjs).

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

// ============================================================================
// Pure logic -- no I/O, no DB, no Sharp. Exported for local unit tests.
// ============================================================================

// Exact safe target allowlist -- hard-coded, never derived dynamically from
// TOURNAMENT_VISUAL_TYPES, so a future new tournament type is never
// silently swept into this legacy-only backfill.
export const TARGET_TYPES = Object.freeze([
  "classic",
  "bounty",
  "boss_bounty",
  "win_the_button",
  "deep_stack",
  "mystery_bounty",
  "phoenix",
]);

export const STORAGE_URL_PREFIX = "/storage/tournament-assets/";
export const CARD_DERIVATIVE_SIZE = 512;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function sha256Hex(bytesOrString) {
  return createHash("sha256").update(bytesOrString).digest("hex");
}

// Deep, key-order-independent canonicalization -- the same unchanged value
// must always canonicalize (and therefore hash) identically regardless of
// how its keys happen to be ordered in memory or on the wire.
export function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJSONStringify(value) {
  return JSON.stringify(canonicalize(value));
}

// Classifies a stored assetUrl as a safe legacy backfill candidate, or
// rejects it with a specific reason. Never guesses: only a relative or
// same-origin-absolute URL pointing at a single, non-nested .png file
// directly under /storage/tournament-assets/ is accepted. Everything else
// (external CDN, the built-in /tournament-assets/ path, nested paths,
// traversal, query strings, hash fragments) is rejected so the DRY_RUN
// fails safe instead of backfilling an unexpected target.
export function classifyAssetUrl(assetUrl, appOrigin) {
  if (typeof assetUrl !== "string" || assetUrl.length === 0) {
    return { ok: false, reason: "assetUrl is not a non-empty string" };
  }
  if (assetUrl.includes("?") || assetUrl.includes("#")) {
    return { ok: false, reason: "assetUrl must not contain a query string or hash fragment" };
  }

  let pathname;
  let isAbsolute = false;
  let origin = null;

  if (assetUrl.startsWith("/")) {
    pathname = assetUrl;
  } else if (/^https?:\/\//.test(assetUrl)) {
    if (!appOrigin) {
      return { ok: false, reason: "NEXT_PUBLIC_APP_URL is not configured; cannot validate absolute URL origin" };
    }
    let parsed;
    let appOriginParsed;
    try {
      parsed = new URL(assetUrl);
      appOriginParsed = new URL(appOrigin);
    } catch {
      return { ok: false, reason: "assetUrl or NEXT_PUBLIC_APP_URL is not a valid URL" };
    }
    if (parsed.origin !== appOriginParsed.origin) {
      return {
        ok: false,
        reason: `absolute URL origin (${parsed.origin}) does not match expected app origin (${appOriginParsed.origin})`,
      };
    }
    isAbsolute = true;
    origin = parsed.origin;
    pathname = parsed.pathname;
  } else {
    return { ok: false, reason: "assetUrl is neither a relative path nor an absolute http(s) URL" };
  }

  if (pathname.includes("..") || pathname.includes("//")) {
    return { ok: false, reason: "assetUrl path contains traversal or malformed segments" };
  }
  if (!pathname.startsWith(STORAGE_URL_PREFIX)) {
    return { ok: false, reason: `assetUrl path must be exactly under ${STORAGE_URL_PREFIX}` };
  }

  const rest = pathname.slice(STORAGE_URL_PREFIX.length);
  if (rest.length === 0 || rest.includes("/")) {
    return { ok: false, reason: "assetUrl must point directly at a file, not a nested path" };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/.test(rest)) {
    return { ok: false, reason: "assetUrl filename must be a plain .png filename" };
  }

  return { ok: true, isAbsolute, origin, pathname, filename: rest };
}

// Preserves the original URL's relative-vs-absolute style -- a legacy
// config never gets silently converted between the two.
export function buildCardUrl(classified) {
  const cardFilename = classified.filename.replace(/\.png$/, "-card.png");
  const cardPathname = `${STORAGE_URL_PREFIX}${cardFilename}`;
  return classified.isAbsolute ? `${classified.origin}${cardPathname}` : cardPathname;
}

export function cardFilenameFor(filename) {
  return filename.replace(/\.png$/, "-card.png");
}

// Deterministic plan binding APPLY to the exact DRY_RUN state -- same
// unchanged production state must reproduce the exact same hash.
export function buildPlan({ expectedAppSha, rawConfigSha256, entries }) {
  return {
    expectedAppSha,
    rawConfigSha256,
    entries: [...entries]
      .map(canonicalize)
      .sort((a, b) => String(a.tournamentType).localeCompare(String(b.tournamentType))),
  };
}

export function planSha256(plan) {
  return sha256Hex(canonicalJSONStringify(plan));
}

// Clones the existing config object and adds ONLY cardAssetUrl -- never
// rebuilt from a hand-written field allowlist, so scale/offsetX/offsetY/
// opacity/list/any unknown future property survive untouched.
export function applyCardAssetUrl(config, cardAssetUrl) {
  return { ...config, cardAssetUrl };
}

// Applies cardAssetUrl updates to exactly the pending target keys of the
// raw stored object, leaving every other key (including crazy_pineapple
// and any type that already had cardAssetUrl) byte-for-semantic-value
// untouched.
export function buildNextRawConfig(rawConfig, pendingCardUrlsByType) {
  const next = {};
  for (const [key, value] of Object.entries(rawConfig)) {
    next[key] = pendingCardUrlsByType.has(key)
      ? applyCardAssetUrl(value, pendingCardUrlsByType.get(key))
      : value;
  }
  return next;
}

export function isValidPngSignature(bytes) {
  if (!bytes || bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

// ============================================================================
// I/O helpers -- filesystem only, no DB/Sharp. Exported for local tests
// against temporary fixture files.
// ============================================================================

export async function checkDestination(fullPath, expectedSha256) {
  let existing;
  try {
    existing = await fs.readFile(fullPath);
  } catch (err) {
    if (err.code === "ENOENT") return { state: "MISSING" };
    throw err;
  }
  const existingSha256 = sha256Hex(existing);
  if (existingSha256 === expectedSha256) return { state: "EXISTING_MATCH" };
  return { state: "CONFLICT", existingSha256 };
}

// Never exposes a partially-written file at the final path: write to a
// unique temp sibling, verify its bytes back off disk, then rename.
export async function writeDerivativeAtomically(fullPath, bytes) {
  const tmpPath = `${fullPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(tmpPath, bytes);
  const expectedSha256 = sha256Hex(bytes);
  let writtenBack;
  try {
    writtenBack = await fs.readFile(tmpPath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
  if (writtenBack.length !== bytes.length || sha256Hex(writtenBack) !== expectedSha256) {
    await fs.unlink(tmpPath).catch(() => {});
    throw new Error(`Atomic write verification failed for ${fullPath}`);
  }
  await fs.rename(tmpPath, fullPath);
}

// ============================================================================
// Orchestration -- real DB/Sharp/filesystem access. Only ever invoked when
// TOURNAMENT_BACKFILL_ENTRY=1 (see the guard at the bottom of this file).
// ============================================================================

function printReport(entries, planHash, rawConfigSha256) {
  console.log(`RAW_CONFIG_SHA256=${rawConfigSha256}`);

  let pendingCount = 0;
  let alreadyCount = 0;
  let originalTotalPending = 0;
  let cardTotalPending = 0;

  for (const e of entries) {
    console.log("----");
    console.log(`TYPE=${e.tournamentType}`);
    console.log(`STATUS=${e.status}`);
    console.log(`ASSET_URL=${e.assetUrl}`);
    if (e.status === "PENDING") {
      pendingCount += 1;
      originalTotalPending += e.originalBytes;
      cardTotalPending += e.cardBytes;
      const reductionBytes = e.originalBytes - e.cardBytes;
      const reductionPercent = e.originalBytes > 0 ? (reductionBytes / e.originalBytes) * 100 : 0;
      console.log(`ORIGINAL_DIMENSIONS=${e.originalDimensions}`);
      console.log(`ORIGINAL_BYTES=${e.originalBytes}`);
      console.log(`ORIGINAL_SHA256=${e.originalSha256}`);
      console.log(`PROPOSED_CARD_URL=${e.proposedCardUrl}`);
      console.log(`CARD_DIMENSIONS=${e.cardDimensions}`);
      console.log(`CARD_BYTES=${e.cardBytes}`);
      console.log(`CARD_SHA256=${e.cardSha256}`);
      console.log(`REDUCTION_BYTES=${reductionBytes}`);
      console.log(`REDUCTION_PERCENT=${reductionPercent.toFixed(2)}%`);
      console.log(`DESTINATION_STATUS=${e.destinationStatus}`);
    } else {
      alreadyCount += 1;
      console.log(`CARD_ASSET_URL=${e.cardAssetUrl}`);
    }
  }

  const totalReductionBytes = originalTotalPending - cardTotalPending;
  const totalReductionPercent =
    originalTotalPending > 0 ? (totalReductionBytes / originalTotalPending) * 100 : 0;

  console.log("====");
  console.log(`TARGET_COUNT=${entries.length}`);
  console.log(`PENDING_COUNT=${pendingCount}`);
  console.log(`ALREADY_HAS_CARD_COUNT=${alreadyCount}`);
  console.log(`ORIGINAL_TOTAL_BYTES_PENDING=${originalTotalPending}`);
  console.log(`CARD_TOTAL_BYTES_PENDING=${cardTotalPending}`);
  console.log(`TOTAL_REDUCTION_BYTES=${totalReductionBytes}`);
  console.log(`TOTAL_REDUCTION_PERCENT=${totalReductionPercent.toFixed(2)}%`);
  console.log(`PLAN_SHA256=${planHash}`);
}

async function createCardDerivative(sharpLib, originalBytes) {
  return sharpLib(originalBytes)
    .resize(CARD_DERIVATIVE_SIZE, CARD_DERIVATIVE_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function main() {
  const mode = process.env.BACKFILL_MODE;
  const expectedAppSha = process.env.EXPECTED_APP_SHA || "";
  const expectedPlanSha256 = process.env.EXPECTED_PLAN_SHA256 || "";
  const confirmation = process.env.BACKFILL_CONFIRMATION || "";
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL || "";
  const storageDir = process.env.TOURNAMENT_STORAGE_DIR || "/app/public/storage/tournament-assets";

  if (mode !== "DRY_RUN" && mode !== "APPLY") {
    throw new Error('BACKFILL_MODE must be "DRY_RUN" or "APPLY"');
  }
  if (mode === "APPLY") {
    if (confirmation !== "APPLY") throw new Error("APPLY requires BACKFILL_CONFIRMATION=APPLY");
    if (!expectedPlanSha256) throw new Error("APPLY requires EXPECTED_PLAN_SHA256");
  }

  const [{ default: postgres }, { default: sharp }] = await Promise.all([
    import("postgres"),
    import("sharp"),
  ]);

  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const rows = await sql`SELECT value, updated_at FROM public.app_settings WHERE key = 'tournament_visuals'`;
    if (rows.length !== 1) {
      throw new Error(`Expected exactly one tournament_visuals row, found ${rows.length}`);
    }
    const rawConfig = rows[0].value;
    if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
      throw new Error("tournament_visuals value is not a JSON object");
    }
    const rawConfigSha256 = sha256Hex(canonicalJSONStringify(rawConfig));

    const entries = [];
    for (const type of TARGET_TYPES) {
      const config = rawConfig[type];
      if (!config || typeof config !== "object") {
        throw new Error(`Target type "${type}" has no stored config -- refusing to synthesize a default`);
      }
      if (config.tournamentType !== type) {
        throw new Error(`Target type "${type}" config has mismatched tournamentType "${config.tournamentType}"`);
      }

      if (typeof config.cardAssetUrl === "string" && config.cardAssetUrl.length > 0) {
        entries.push({
          tournamentType: type,
          status: "ALREADY_HAS_CARD",
          assetUrl: config.assetUrl,
          cardAssetUrl: config.cardAssetUrl,
        });
        continue;
      }

      const classified = classifyAssetUrl(config.assetUrl, appOrigin);
      if (!classified.ok) {
        throw new Error(
          `Target type "${type}" assetUrl is not a safe legacy backfill candidate: ${classified.reason} (assetUrl=${config.assetUrl})`,
        );
      }

      const fullPath = path.join(storageDir, classified.filename);
      let originalBytes;
      try {
        originalBytes = await fs.readFile(fullPath);
      } catch (err) {
        throw new Error(`Target type "${type}" original file not found at ${fullPath}: ${err.message}`);
      }
      if (!isValidPngSignature(originalBytes)) {
        throw new Error(`Target type "${type}" original file is not a valid PNG: ${fullPath}`);
      }
      const originalSha256Before = sha256Hex(originalBytes);
      const meta = await sharp(originalBytes).metadata();

      const cardBytes = await createCardDerivative(sharp, originalBytes);
      const cardMeta = await sharp(cardBytes).metadata();
      const cardSha256 = sha256Hex(cardBytes);

      const originalBytesAfter = await fs.readFile(fullPath);
      if (sha256Hex(originalBytesAfter) !== originalSha256Before) {
        throw new Error(`FATAL: original file changed during derivative generation: ${fullPath}`);
      }

      const cardUrl = buildCardUrl(classified);
      const cardFullPath = path.join(storageDir, cardFilenameFor(classified.filename));
      const destination = await checkDestination(cardFullPath, cardSha256);
      if (destination.state === "CONFLICT") {
        throw new Error(
          `Destination collision at ${cardFullPath}: existing file (sha256=${destination.existingSha256}) does not match the generated derivative (sha256=${cardSha256})`,
        );
      }

      entries.push({
        tournamentType: type,
        status: "PENDING",
        assetUrl: config.assetUrl,
        originalPath: fullPath,
        originalDimensions: `${meta.width}x${meta.height}`,
        originalChannels: meta.channels,
        originalHasAlpha: Boolean(meta.hasAlpha),
        originalBytes: originalBytes.length,
        originalSha256: originalSha256Before,
        proposedCardUrl: cardUrl,
        cardFullPath,
        cardDimensions: `${cardMeta.width}x${cardMeta.height}`,
        cardBytes: cardBytes.length,
        cardSha256,
        cardBytesBuffer: cardBytes,
        destinationStatus: destination.state,
      });
    }

    // Intentionally dropped below: the raw derivative bytes must never enter the hashed/printed plan.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const hashableEntries = entries.map(({ cardBytesBuffer, ...rest }) => rest);
    const plan = buildPlan({ expectedAppSha, rawConfigSha256, entries: hashableEntries });
    const planHash = planSha256(plan);

    printReport(entries, planHash, rawConfigSha256);

    if (mode === "DRY_RUN") {
      console.log("DRY_RUN complete. No production mutations were made.");
      return;
    }

    if (planHash !== expectedPlanSha256) {
      throw new Error(
        `PLAN_SHA256 mismatch: recomputed ${planHash} != expected ${expectedPlanSha256}. Aborting before any mutation.`,
      );
    }

    const pending = entries.filter((e) => e.status === "PENDING");
    if (pending.length === 0) {
      console.log("Nothing to apply -- all target types already have cardAssetUrl (idempotent no-op).");
      return;
    }

    for (const entry of pending) {
      if (entry.destinationStatus === "MISSING") {
        await writeDerivativeAtomically(entry.cardFullPath, entry.cardBytesBuffer);
        console.log(`Wrote derivative: ${entry.cardFullPath}`);
      } else {
        console.log(`Reusing existing matching derivative: ${entry.cardFullPath}`);
      }

      const finalOriginalBytes = await fs.readFile(entry.originalPath);
      if (sha256Hex(finalOriginalBytes) !== entry.originalSha256) {
        throw new Error(`FATAL: original changed before DB update: ${entry.originalPath}`);
      }
      const finalCardBytes = await fs.readFile(entry.cardFullPath);
      if (finalCardBytes.length !== entry.cardBytes || sha256Hex(finalCardBytes) !== entry.cardSha256) {
        throw new Error(`FATAL: derivative file verification failed after write: ${entry.cardFullPath}`);
      }
    }

    const pendingCardUrlsByType = new Map(pending.map((e) => [e.tournamentType, e.proposedCardUrl]));
    const nextRawConfig = buildNextRawConfig(rawConfig, pendingCardUrlsByType);

    // Optimistic compare-and-swap: WHERE value = <exact old value> ensures
    // an admin edit landing between DRY_RUN and here is never silently
    // overwritten. Zero rows updated -> fail without retrying; the newly
    // written derivative files are left in place, orphaned but harmless
    // (nothing references them until cardAssetUrl is actually persisted).
    const casResult = await sql`
      UPDATE public.app_settings
      SET value = ${sql.json(nextRawConfig)}, updated_at = now()
      WHERE key = 'tournament_visuals' AND value = ${sql.json(rawConfig)}
      RETURNING key, updated_at
    `;
    if (casResult.length !== 1) {
      throw new Error(
        "Compare-and-swap failed: production tournament_visuals config changed concurrently. Aborting without retry. New derivative files remain on disk but are orphaned (harmless).",
      );
    }
    console.log(`CAS_UPDATE_ROWS=${casResult.length}`);
    console.log(`CAS_UPDATED_AT=${casResult[0].updated_at.toISOString()}`);

    const postRows = await sql`SELECT value FROM public.app_settings WHERE key = 'tournament_visuals'`;
    const postConfig = postRows[0].value;
    for (const entry of pending) {
      const stored = postConfig[entry.tournamentType];
      if (!stored || stored.cardAssetUrl !== entry.proposedCardUrl) {
        throw new Error(`POST-APPLY VERIFICATION FAILED for ${entry.tournamentType}`);
      }
      if (stored.assetUrl !== entry.assetUrl) {
        throw new Error(`POST-APPLY VERIFICATION FAILED: assetUrl changed for ${entry.tournamentType}`);
      }
    }
    const postConfigSha256 = sha256Hex(canonicalJSONStringify(postConfig));
    console.log(`POST_CONFIG_SHA256=${postConfigSha256}`);
    console.log("APPLY complete.");
  } finally {
    await sql.end();
  }
}

if (process.env.TOURNAMENT_BACKFILL_ENTRY === "1") {
  main().catch((err) => {
    console.error("FAIL:", err && err.message ? err.message : String(err));
    process.exitCode = 1;
  });
}
