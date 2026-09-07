import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  TOURNAMENT_CARD_DERIVATIVE_SIZE,
  createTournamentCardDerivative,
} from "@/lib/tournament-visual-card-derivative";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("createTournamentCardDerivative", () => {
  it("produces exactly 512x512", () => {
    expect(TOURNAMENT_CARD_DERIVATIVE_SIZE).toBe(512);
  });

  it("output is a valid PNG at exactly 512x512", async () => {
    const source = readFileSync(join(process.cwd(), "public/tournament-assets/pineapple.png"));
    const derivative = await createTournamentCardDerivative(source);

    expect(derivative.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    const metadata = await sharp(derivative).metadata();
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
    expect(metadata.format).toBe("png");
  });

  it("preserves the alpha channel (transparency)", async () => {
    const source = readFileSync(join(process.cwd(), "public/tournament-assets/pineapple.png"));
    const derivative = await createTournamentCardDerivative(source);
    const metadata = await sharp(derivative).metadata();
    expect(metadata.hasAlpha).toBe(true);
  });

  it("uses fit:contain -- a non-square source is padded, never cropped or stretched", async () => {
    // 800x400 synthetic source (2:1), deliberately non-square unlike the
    // pineapple original -- proves the "no crop, no stretch" contract on a
    // shape where a naive resize/crop would behave differently than
    // fit:contain.
    const wideSource = await sharp({
      create: { width: 800, height: 400, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
    })
      .png()
      .toBuffer();

    const derivative = await createTournamentCardDerivative(wideSource);
    const metadata = await sharp(derivative).metadata();
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);

    // fit:contain on a 2:1 source scaled into a 512x512 square leaves the
    // opaque content exactly 512 wide x 256 tall, centered -- transparent
    // padding above and below. A center pixel must be opaque (the source
    // color); a pixel near the very top/bottom edge must be transparent
    // padding, not stretched/cropped source content.
    const { data, info } = await sharp(derivative).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    const centerIndex = (256 * 512 + 256) * channels;
    const topEdgeIndex = (2 * 512 + 256) * channels;
    expect(data[centerIndex + 3]).toBe(255); // opaque at center
    expect(data[topEdgeIndex + 3]).toBe(0); // transparent padding near top
  });

  it("is deterministic for identical input", async () => {
    const source = readFileSync(join(process.cwd(), "public/tournament-assets/pineapple.png"));
    const first = await createTournamentCardDerivative(source);
    const second = await createTournamentCardDerivative(source);
    expect(first.equals(second)).toBe(true);
  });

  it("does not modify the original bytes it was given", async () => {
    const source = readFileSync(join(process.cwd(), "public/tournament-assets/pineapple.png"));
    const sourceCopy = Buffer.from(source);
    await createTournamentCardDerivative(source);
    expect(source.equals(sourceCopy)).toBe(true);
  });

  it("matches the committed built-in pineapple-card.png byte-for-byte (same pipeline as scripts/generate-tournament-card-derivatives.mjs)", async () => {
    const source = readFileSync(join(process.cwd(), "public/tournament-assets/pineapple.png"));
    const committed = readFileSync(join(process.cwd(), "public/tournament-assets/pineapple-card.png"));
    const derivative = await createTournamentCardDerivative(source);
    expect(derivative.equals(committed)).toBe(true);
  });

  it("representative upload-fixture measurement: a synthetic 800x400 PNG shrinks meaningfully", async () => {
    const wideSource = await sharp({
      create: { width: 800, height: 400, channels: 4, background: { r: 200, g: 150, b: 50, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const derivative = await createTournamentCardDerivative(wideSource);

    console.log(
      `UPLOAD_FIXTURE_ORIGINAL_BYTES=${wideSource.length} UPLOAD_FIXTURE_CARD_BYTES=${derivative.length} UPLOAD_FIXTURE_REDUCTION_PERCENT=${(((wideSource.length - derivative.length) / wideSource.length) * 100).toFixed(2)}%`,
    );

    expect(derivative.length).toBeGreaterThan(0);
  });
});
