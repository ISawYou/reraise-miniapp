// Club Activity image normalization, exercised with the REAL sharp/libvips
// build this app ships with (no mocks): format/decodability checks,
// orientation, metadata stripping, size cap, no upscaling, failure codes.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  assertClubActivityImageDeclaration,
  CLUB_ACTIVITY_IMAGE_MAX_EDGE,
  ClubActivityImageError,
  normalizeClubActivityImage,
} from "@/lib/club-activity-image";
import {
  CLUB_ACTIVITY_IMAGE_MAX_BYTES,
  getClubActivityImageClientError,
} from "@/lib/club-activity-image-limits";

// A real 16x9 HEIC (HEVC) produced by macOS `sips` -- the format iPhones
// shoot by default.
const TINY_HEIC_BASE64 =
  "AAAAGGZ0eXBoZWljAAAAAGhlaWNtaWYxAAAB321ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRp" +
  "bmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABo" +
  "dmMxAAAAABVpbmZlAgAAAQACAABFeGlmAAAAABppcmVmAAAAAAAAAA5jZHNjAAIAAQABAAABAmlwcnAAAADhaXBjbwAAABNjb2xy" +
  "bmNseAACAAIABoAAAAAUaXNwZQAAAAAAAAAQAAAACgAAAChjbGFwAAAAEAAAAAEAAAAJAAAAAQAAAAAAAAAB/8AAAACAAAAAAAAJ" +
  "aXJvdAAAAAAQcGl4aQAAAAADCAgIAAAAcWh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAA" +
  "AwAecCShAAEAI0IBAQNwAAADALAAAAMAAAMAHqAUIEHAkw5iHuRZVNwICBgCogABAAlEAcBhcshAUyQAAAAZaXBtYQAAAAAAAAAB" +
  "AAEGgQIFhoOEAAAALGlsb2MAAAAARAAAAgABAAAAAQAAAukAAADNAAIAAAABAAACBwAAAOIAAAABbWRhdAAAAAAAAAG/AAAABkV4" +
  "aWYAAE1NACoAAAAIAAgBBgADAAAAAQACAAABEgADAAAAAQABAAABGgAFAAAAAQAAAG4BGwAFAAAAAQAAAHYBKAADAAAAAQACAAAB" +
  "QgAEAAAAAQAAAgABQwAEAAAAAQAAAgCHaQAEAAAAAQAAAH4AAAAAAAAASAAAAAEAAABIAAAAAQAHkAAABwAAAAQwMjIxkQEABwAA" +
  "AAQBAgMAoAAABwAAAAQwMTAwoAEAAwAAAAEAAQAAoAIABAAAAAEAAAAQoAMABAAAAAEAAAAJpAYAAwAAAAEAAAAAAAAAAAAAAMko" +
  "Aa+hFZAaYUv/OpL/sjHWrO9IjIAWV3uwcSJ2sRYKp2mD2/pOE5UYBALFd+NnolC3FkxGmBgB1e8oTFwRgihG6W6g/3v47hmbN9+o" +
  "FW5LMgAb8O0AttmJoyOufczNtPKptNylXGbHZltwW9Hkh+NKJPolPQl6Vu+GvmCn2tuP6fbbJuY4y6t8yBCs8LNQSQgloeSx5uS/" +
  "ggxxxxfyOYzgJv6Xfx+7mJmF9BVfruT6vVo/oCj/EsP2tpf8q0LgIdXomrJ9DJQLSmA=";

function solid(width: number, height: number, color = { r: 200, g: 60, b: 40 }) {
  return sharp({ create: { width, height, channels: 3, background: color } });
}

async function expectCode(promise: Promise<unknown>, code: ClubActivityImageError["code"]) {
  await expect(promise).rejects.toBeInstanceOf(ClubActivityImageError);
  await expect(promise).rejects.toMatchObject({ code });
}

function isWebp(buffer: Buffer) {
  return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
}

describe("normalizeClubActivityImage", () => {
  it.each([
    ["JPEG", () => solid(640, 360).jpeg().toBuffer()],
    ["PNG", () => solid(640, 360).png().toBuffer()],
    ["WebP", () => solid(640, 360).webp().toBuffer()],
  ])("accepts a valid %s and always outputs genuine WebP", async (_name, make) => {
    const result = await normalizeClubActivityImage(await make());
    expect(result.format).toBe("webp");
    expect(isWebp(result.data)).toBe(true);
    expect((await sharp(result.data).metadata()).format).toBe("webp");
  });

  it("caps the long edge at the configured maximum (landscape and portrait)", async () => {
    const landscape = await normalizeClubActivityImage(await solid(4000, 3000).jpeg().toBuffer());
    expect([landscape.width, landscape.height]).toEqual([CLUB_ACTIVITY_IMAGE_MAX_EDGE, 1080]);
    const portrait = await normalizeClubActivityImage(await solid(2000, 4000).png().toBuffer());
    expect([portrait.width, portrait.height]).toEqual([720, CLUB_ACTIVITY_IMAGE_MAX_EDGE]);
    const meta = await sharp(landscape.data).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(CLUB_ACTIVITY_IMAGE_MAX_EDGE);
  });

  it("never upscales a smaller-than-cap image", async () => {
    const result = await normalizeClubActivityImage(await solid(800, 450).jpeg().toBuffer());
    expect([result.width, result.height]).toEqual([800, 450]);
  });

  it("bakes EXIF orientation into the pixels and strips EXIF/ICC/XMP metadata", async () => {
    // Stored landscape 400x200: left half red, right half blue, tagged
    // orientation 6 (display = rotate 90° clockwise) plus camera EXIF.
    const left = await solid(200, 200, { r: 255, g: 0, b: 0 }).png().toBuffer();
    const input = await sharp({ create: { width: 400, height: 200, channels: 3, background: { r: 0, g: 0, b: 255 } } })
      .composite([{ input: left, left: 0, top: 0 }])
      .jpeg({ quality: 95 })
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Make: "QA-Camera", Model: "Secret-Model", Copyright: "GPS-LIKE-PRIVATE" } })
      .toBuffer();
    const inputMeta = await sharp(input).metadata();
    expect(inputMeta.orientation).toBe(6);
    expect(inputMeta.exif).toBeDefined();

    const result = await normalizeClubActivityImage(input);
    // Rotated into a portrait image...
    expect([result.width, result.height]).toEqual([200, 400]);
    const { data, info } = await sharp(result.data).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    // ...with the stored LEFT (red) half now on TOP, exactly as a viewer
    // honoring orientation=6 would have shown it.
    const [tr, , tb] = pixel(100, 50);
    const [br, , bb] = pixel(100, 350);
    expect(tr).toBeGreaterThan(200);
    expect(tb).toBeLessThan(60);
    expect(bb).toBeGreaterThan(200);
    expect(br).toBeLessThan(60);

    const outMeta = await sharp(result.data).metadata();
    expect(outMeta.exif).toBeUndefined();
    expect(outMeta.orientation).toBeUndefined();
    expect(outMeta.icc).toBeUndefined();
    expect(outMeta.xmp).toBeUndefined();
    expect(result.data.includes(Buffer.from("Secret-Model"))).toBe(false);
  });

  it("rejects bytes that are not an image at all", async () => {
    await expectCode(normalizeClubActivityImage(Buffer.from("definitely not an image, just text")), "not_image");
  });

  it("rejects an empty buffer and an oversized buffer", async () => {
    await expectCode(normalizeClubActivityImage(Buffer.alloc(0)), "empty");
    await expectCode(normalizeClubActivityImage(Buffer.alloc(CLUB_ACTIVITY_IMAGE_MAX_BYTES + 1)), "too_large");
  });

  it("rejects decodable-but-unsupported formats by their real content (GIF)", async () => {
    await expectCode(normalizeClubActivityImage(await solid(32, 32).gif().toBuffer()), "unsupported_type");
  });

  it("rejects a real HEIC with a clear message (this libvips build has no HEVC decoder)", async () => {
    const heic = Buffer.from(TINY_HEIC_BASE64, "base64");
    // The header parses as HEIF/HEVC...
    const meta = await sharp(heic).metadata();
    expect(meta.format).toBe("heif");
    // ...but the pixels cannot be decoded -- the reason HEIC is rejected
    // rather than silently "supported".
    await expect(sharp(heic).webp().toBuffer()).rejects.toThrow(/compression format has not been built in/);
    await expectCode(normalizeClubActivityImage(heic), "heic");
  });

  it("rejects decompression-bomb dimensions from the header, before decoding", async () => {
    // 10000x6000 = 60 MP solid PNG: tiny on disk, huge once decoded.
    const bomb = await solid(10000, 6000).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(CLUB_ACTIVITY_IMAGE_MAX_BYTES);
    await expectCode(normalizeClubActivityImage(bomb), "too_many_pixels");
  });

  it("fails cleanly on a truncated/corrupt JPEG instead of producing a broken image", async () => {
    const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: "gaussian", mean: 128, sigma: 40 } } })
      .jpeg()
      .toBuffer();
    await expectCode(normalizeClubActivityImage(jpeg.subarray(0, Math.floor(jpeg.length / 2))), "processing_failed");
  });

  it("produces a mobile-feed-sized file from a camera-sized photo", async () => {
    const photo = await sharp({ create: { width: 4032, height: 3024, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: "gaussian", mean: 128, sigma: 20 } } })
      .blur(1.5)
      .jpeg({ quality: 90 })
      .toBuffer();
    const result = await normalizeClubActivityImage(photo);
    expect([result.width, result.height]).toEqual([1440, 1080]);
    expect(result.data.length).toBeLessThan(photo.length / 5);
  });
});

describe("declared request shape", () => {
  it("accepts the three supported MIME types within the size limit", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(() => assertClubActivityImageDeclaration(type, 1000)).not.toThrow();
      expect(getClubActivityImageClientError({ type, size: 1000 })).toBeNull();
    }
  });

  it("rejects empty, oversized, HEIC and non-image declarations with friendly messages", () => {
    expect(() => assertClubActivityImageDeclaration("image/png", 0)).toThrow("Файл пустой");
    expect(() => assertClubActivityImageDeclaration("image/png", CLUB_ACTIVITY_IMAGE_MAX_BYTES + 1)).toThrow("Файл слишком большой");
    expect(() => assertClubActivityImageDeclaration("image/heic", 1000)).toThrow("Этот формат изображения не поддерживается");
    expect(() => assertClubActivityImageDeclaration("application/pdf", 1000)).toThrow("Этот формат изображения не поддерживается");
    expect(getClubActivityImageClientError({ type: "image/png", size: CLUB_ACTIVITY_IMAGE_MAX_BYTES + 1 })).toContain("Файл слишком большой");
    expect(getClubActivityImageClientError({ type: "text/plain", size: 10 })).toContain("не поддерживается");
  });
});
