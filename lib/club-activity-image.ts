import "server-only";

import sharp from "sharp";
import {
  CLUB_ACTIVITY_IMAGE_ACCEPTED_TYPES,
  CLUB_ACTIVITY_IMAGE_MAX_BYTES,
  CLUB_ACTIVITY_IMAGE_MESSAGES,
  type ClubActivityImageErrorCode,
} from "@/lib/club-activity-image-limits";

// Club Activity publication images are normalized exactly ONCE, at upload
// time, into a mobile-feed-sized WebP. Feed/detail views then serve that
// static file directly (nginx), with no per-request processing.
//
// Numbers chosen from a measured real 3840x2160 / 5.6 MB photo:
// long edge 1440 / WebP q80 -> 1440x810, ~114 KB, ~100 ms. 1440 px covers
// the widest card (max-w-md = 448 CSS px) at DPR 3 (1344 px); q80 vs q76
// is +18% bytes for visibly cleaner gradients, q82 adds +11% for no visible
// gain at feed size.
export const CLUB_ACTIVITY_IMAGE_MAX_EDGE = 1440;
export const CLUB_ACTIVITY_IMAGE_WEBP_QUALITY = 80;
// Decompression-bomb guard, checked from the header BEFORE any full decode.
// 50 MP admits every common phone camera (48 MP = 8064x6048 = 48.8 MP).
export const CLUB_ACTIVITY_IMAGE_MAX_INPUT_PIXELS = 50_000_000;

// Formats as reported by sharp's own header parsing -- the declared MIME
// type and file name are never trusted on their own.
const DECODABLE_FORMATS = new Set(["jpeg", "png", "webp"]);

export class ClubActivityImageError extends Error {
  constructor(
    readonly code: ClubActivityImageErrorCode,
    message: string = CLUB_ACTIVITY_IMAGE_MESSAGES[code],
  ) {
    super(message);
    this.name = "ClubActivityImageError";
  }
}

export type NormalizedClubActivityImage = {
  data: Buffer;
  width: number;
  height: number;
  format: "webp";
};

/** Basic request-shape check of what the browser declared, before reading bytes. */
export function assertClubActivityImageDeclaration(declaredType: string, size: number): void {
  if (size <= 0) throw new ClubActivityImageError("empty");
  if (size > CLUB_ACTIVITY_IMAGE_MAX_BYTES) throw new ClubActivityImageError("too_large");
  const type = declaredType.trim().toLowerCase();
  if (/^image\/(heic|heif)/.test(type)) throw new ClubActivityImageError("heic");
  if (!(CLUB_ACTIVITY_IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type)) {
    throw new ClubActivityImageError("unsupported_type");
  }
}

export async function normalizeClubActivityImage(
  input: Buffer,
): Promise<NormalizedClubActivityImage> {
  if (input.length === 0) throw new ClubActivityImageError("empty");
  if (input.length > CLUB_ACTIVITY_IMAGE_MAX_BYTES) throw new ClubActivityImageError("too_large");

  let metadata: sharp.Metadata;
  try {
    // Header-only read: no pixel decode happens here.
    metadata = await sharp(input).metadata();
  } catch {
    throw new ClubActivityImageError("not_image");
  }

  if (metadata.format === "heif") {
    // Proven, not assumed: the prebuilt libvips shipped with sharp (also the
    // linuxmusl build used by the production node:20-alpine image) parses a
    // HEIC header but has no HEVC decoder ("Support for this compression
    // format has not been built in").
    throw new ClubActivityImageError("heic");
  }
  if (!metadata.format || !DECODABLE_FORMATS.has(metadata.format)) {
    throw new ClubActivityImageError("unsupported_type");
  }
  const { width, height } = metadata;
  if (!width || !height) throw new ClubActivityImageError("not_image");
  if (width * height > CLUB_ACTIVITY_IMAGE_MAX_INPUT_PIXELS) {
    throw new ClubActivityImageError("too_many_pixels");
  }

  try {
    const { data, info } = await sharp(input, {
      limitInputPixels: CLUB_ACTIVITY_IMAGE_MAX_INPUT_PIXELS,
      // Truncated/corrupt input must fail here, not silently produce a
      // half-grey image.
      failOn: "error",
    })
      // Bakes EXIF orientation into the pixels (the output carries no EXIF,
      // so nothing downstream could apply it later).
      .rotate()
      .resize({
        width: CLUB_ACTIVITY_IMAGE_MAX_EDGE,
        height: CLUB_ACTIVITY_IMAGE_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      // No .withMetadata()/.keepMetadata(): sharp strips EXIF (incl. GPS),
      // XMP, IPTC and ICC from the output by default.
      .webp({ quality: CLUB_ACTIVITY_IMAGE_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, format: "webp" };
  } catch {
    throw new ClubActivityImageError("processing_failed");
  }
}
