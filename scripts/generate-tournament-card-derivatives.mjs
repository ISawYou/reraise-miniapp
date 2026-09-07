// One-time (but re-runnable) derivative generator for built-in tournament
// artwork -- Phase 2B.2. Mirrors scripts/generate-achievement-thumbnails.mjs
// exactly (same sharp version, same resize/fit/background/png parameters as
// lib/tournament-visual-card-derivative.ts's createTournamentCardDerivative,
// which the runtime upload path uses -- keep both in sync if these
// parameters ever change).
//
// Only Crazy Pineapple has a committed built-in original
// (public/tournament-assets/pineapple.png) as of this change. The seven
// legacy tournament types have no source PNG checked into this repo at all
// (their originals live only in production's uploaded storage) -- this
// script deliberately does NOT fabricate derivatives for them; that backfill
// is a separate, future Phase 2B.3 with its own approval.
//
// Run manually with `node scripts/generate-tournament-card-derivatives.mjs`
// whenever a built-in tournament asset changes.

import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, "..", "public", "tournament-assets");

const CARD_SIZE = 512;

// [original filename, derivative filename] -- literal list, not a directory
// scan, so this only ever touches files actually part of the built-in set.
const FILES = [["pineapple.png", "pineapple-card.png"]];

for (const [original, derivative] of FILES) {
  const input = path.join(ASSETS_DIR, original);
  const output = path.join(ASSETS_DIR, derivative);

  await sharp(input)
    .resize(CARD_SIZE, CARD_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(output);

  console.log(`generated ${derivative}`);
}
