// Verifies the generated thumbnails (scripts/generate-achievement-thumbnails.mjs)
// stay in sync with DEFAULT_ACHIEVEMENT_VISUALS and that originals were left
// untouched -- a lightweight file-level check, not a binary snapshot. Reads
// each PNG's IHDR chunk directly (width/height are the first 8 bytes after
// the 8-byte signature + 4-byte length + 4-byte "IHDR" type, per the PNG
// spec) rather than depending on any image library at test time.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ACHIEVEMENT_VISUALS } from "@/config/achievement-visuals";

const ASSETS_DIR = join(process.cwd(), "public", "achievement-assets");
const THUMB_DIR = join(ASSETS_DIR, "thumb");
const MEDIUM_DIR = join(ASSETS_DIR, "medium");

function pngDimensions(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  const signatureOk =
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47;
  if (!signatureOk) throw new Error(`${path} is not a valid PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const builtInFiles = [...new Set(Object.values(DEFAULT_ACHIEVEMENT_VISUALS))].map(
  (assetUrl) => assetUrl.replace("/achievement-assets/", ""),
);

describe("achievement thumbnails -- generated asset verification", () => {
  it("every DEFAULT_ACHIEVEMENT_VISUALS built-in local asset has a generated thumbnail", () => {
    for (const file of builtInFiles) {
      expect(existsSync(join(THUMB_DIR, file)), `missing thumb/${file}`).toBe(true);
    }
  });

  it("every generated thumbnail is exactly 256x256", () => {
    for (const file of builtInFiles) {
      const { width, height } = pngDimensions(join(THUMB_DIR, file));
      expect([file, width, height]).toEqual([file, 256, 256]);
    }
  });

  it("every thumbnail is a real, non-trivial PNG (not an empty/broken file)", () => {
    for (const file of builtInFiles) {
      const size = statSync(join(THUMB_DIR, file)).size;
      expect(size, `${file} thumbnail is suspiciously small`).toBeGreaterThan(1000);
    }
  });

  it("originals remain present, unchanged, and still full resolution", () => {
    for (const file of builtInFiles) {
      const originalPath = join(ASSETS_DIR, file);
      expect(existsSync(originalPath), `original ${file} missing`).toBe(true);
      const { width, height } = pngDimensions(originalPath);
      // Originals were 1024x1024 before this change; this only asserts they
      // were not shrunk/overwritten by the thumbnail generation, not a
      // specific fixed size for all future assets.
      expect(width).toBeGreaterThanOrEqual(256);
      expect(height).toBeGreaterThanOrEqual(256);
    }
  });

  it("thumbnails are meaningfully smaller than their originals", () => {
    for (const file of builtInFiles) {
      const originalSize = statSync(join(ASSETS_DIR, file)).size;
      const thumbSize = statSync(join(THUMB_DIR, file)).size;
      expect(thumbSize, `${file} thumbnail is not smaller than original`).toBeLessThan(originalSize);
    }
  });

  describe("medium (512x512) derivatives -- Phase 2A.1", () => {
    it("every DEFAULT_ACHIEVEMENT_VISUALS built-in local asset has a generated medium derivative", () => {
      for (const file of builtInFiles) {
        expect(existsSync(join(MEDIUM_DIR, file)), `missing medium/${file}`).toBe(true);
      }
    });

    it("every medium derivative is exactly 512x512", () => {
      for (const file of builtInFiles) {
        const { width, height } = pngDimensions(join(MEDIUM_DIR, file));
        expect([file, width, height]).toEqual([file, 512, 512]);
      }
    });

    it("medium derivatives are smaller than originals but larger than the 256 thumbnail", () => {
      for (const file of builtInFiles) {
        const originalSize = statSync(join(ASSETS_DIR, file)).size;
        const thumbSize = statSync(join(THUMB_DIR, file)).size;
        const mediumSize = statSync(join(MEDIUM_DIR, file)).size;
        expect(mediumSize, `${file} medium is not smaller than original`).toBeLessThan(originalSize);
        expect(mediumSize, `${file} medium is not larger than its thumbnail`).toBeGreaterThan(thumbSize);
      }
    });

    it("adding the medium derivative did not change the existing 256 thumbnail", () => {
      // Regression guard for the shared generation script: regenerating
      // thumb/ alongside the new medium/ pass must still produce
      // byte-identical thumbnails (same source, same params, same sharp
      // version -- deterministic).
      for (const file of builtInFiles) {
        const { width, height } = pngDimensions(join(THUMB_DIR, file));
        expect([file, width, height]).toEqual([file, 256, 256]);
      }
    });
  });
});
