import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { createTeamAvatarDerivative, TEAM_AVATAR_DERIVATIVE_SIZE } from "@/lib/team-avatar-derivative";

// Builds a tiny, deliberately NON-square source image (so the "cover"
// center-crop actually has something to crop, unlike a square source that
// would pass even a "contain" fit by accident) -- a plain in-memory PNG,
// no fixture file needed.
async function tinySourceImage(): Promise<Buffer> {
  return sharp({
    create: { width: 200, height: 80, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
}

describe("createTeamAvatarDerivative", () => {
  it("produces a 512x512 webp image", async () => {
    const source = await tinySourceImage();
    const derivative = await createTeamAvatarDerivative(source);
    const metadata = await sharp(derivative).metadata();

    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(TEAM_AVATAR_DERIVATIVE_SIZE);
    expect(metadata.height).toBe(TEAM_AVATAR_DERIVATIVE_SIZE);
  });

  it("strips metadata (no EXIF/ICC carried over)", async () => {
    const source = await sharp({
      create: { width: 300, height: 300, channels: 3, background: { r: 5, g: 5, b: 5 } },
    })
      .withMetadata({ exif: { IFD0: { Copyright: "test" } } })
      .jpeg()
      .toBuffer();

    const derivative = await createTeamAvatarDerivative(source);
    const metadata = await sharp(derivative).metadata();

    expect(metadata.exif).toBeUndefined();
  });

  it("accepts a plain ArrayBuffer input as well as a Buffer", async () => {
    const source = await tinySourceImage();
    const arrayBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    const derivative = await createTeamAvatarDerivative(arrayBuffer as ArrayBuffer);
    const metadata = await sharp(derivative).metadata();

    expect(metadata.width).toBe(TEAM_AVATAR_DERIVATIVE_SIZE);
  });
});
