import "server-only";

import sharp from "sharp";

// Card-sized derivative of a tournament's original PNG artwork -- the SAME
// image at a smaller footprint, not a separate visual identity (see
// config/tournament-visuals.ts's TournamentVisualConfig.cardAssetUrl doc
// comment). Used both at upload time (features/tournament-visuals.ts's
// uploadTournamentVisualPng) and by
// scripts/generate-tournament-card-derivatives.mjs, which produced the
// committed built-in public/tournament-assets/pineapple-card.png -- keep
// the resize parameters below in sync with that script if they ever change.
//
// fit: "contain" on a transparent background never crops or recomposes the
// artwork, only uniformly downscales it (padding, not cropping, fills any
// leftover space for a non-square source). No sharpening, no color
// changes: sharp's default resize kernel (lanczos3) applies no sharpening
// unless .sharpen() is called, which this never does.
export const TOURNAMENT_CARD_DERIVATIVE_SIZE = 512;

export async function createTournamentCardDerivative(
  originalBytes: ArrayBuffer | Buffer,
): Promise<Buffer> {
  const buffer = Buffer.isBuffer(originalBytes) ? originalBytes : Buffer.from(originalBytes);
  return sharp(buffer)
    .resize(TOURNAMENT_CARD_DERIVATIVE_SIZE, TOURNAMENT_CARD_DERIVATIVE_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
