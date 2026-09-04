// One-time (but re-runnable) derivative generator for the built-in
// achievement/tier-frame artwork listed in config/achievement-visuals.ts's
// DEFAULT_ACHIEVEMENT_VISUALS. The source PNGs are 1024x1024
// (~0.8-1.6MB each); this produces two smaller lossless equivalents per
// file, without touching or overwriting the originals (still needed at
// full res on the admin editor):
//   public/achievement-assets/thumb/   256x256 -- Home's ~36px featured
//                                       icons ("thumbnail" variant)
//   public/achievement-assets/medium/  512x512 -- the full Achievements
//                                       page's ~112-176px grid/detail
//                                       artwork ("medium" variant)
//
// Uses `sharp`, already present in node_modules as a transitive dependency
// (Next.js's optional image-optimization lib) -- not a declared project
// dependency, and does not need to become one: this script is a build-time
// asset-generation tool, not runtime app code. Run manually with
// `node scripts/generate-achievement-thumbnails.mjs` whenever a built-in
// achievement asset changes.
//
// fit: "contain" on a target canvas equal to the source's own aspect ratio
// (all 16 inputs are exactly 1024x1024 today) never crops or recomposes the
// artwork -- it's a pure uniform downscale. No sharpening, no color
// changes: sharp's default resize kernel (lanczos3) applies no sharpening
// unless .sharpen() is called, which this script never does.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, "..", "public", "achievement-assets");

// [directory name, target square size] -- one pass per derivative.
const DERIVATIVES = [
  ["thumb", 256],
  ["medium", 512],
];

// Exactly the files referenced by DEFAULT_ACHIEVEMENT_VISUALS in
// config/achievement-visuals.ts -- kept as a literal list (not a directory
// scan) so this script only ever touches assets that are actually part of
// the built-in visual/frame set, never incidental files that happen to
// live in the same folder (e.g. the platinum.png legacy-alias file, which
// DEFAULT_ACHIEVEMENT_VISUALS does not reference).
const FILES = [
  "in-game.png",
  "triumphator.png",
  "player-path.png",
  "itm.png",
  "community.png",
  "terminator.png",
  "boss-hunter.png",
  "streak.png",
  "royal-flush.png",
  "number-one.png",
  "headhunter.png",
  "marco-reus.png",
  "bronze.png",
  "silver.png",
  "gold.png",
  "diamond.png",
];

for (const [dirName, size] of DERIVATIVES) {
  const outDir = path.join(SRC_DIR, dirName);
  mkdirSync(outDir, { recursive: true });

  for (const file of FILES) {
    const input = path.join(SRC_DIR, file);
    const output = path.join(outDir, file);

    await sharp(input)
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(output);

    console.log(`generated ${dirName}/${file}`);
  }
}
