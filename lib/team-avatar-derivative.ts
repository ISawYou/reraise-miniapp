import "server-only";

import sharp from "sharp";

// Normalized derivative of a captain-uploaded team photo -- mirrors
// lib/tournament-visual-card-derivative.ts's Sharp usage pattern, but with
// DIFFERENT resize semantics: a team photo is a face/logo-style square
// identity (like a player avatar), so it is CENTER-CROPPED to fill the
// frame ("cover"), never letterboxed like the tournament artwork's
// "contain". `.rotate()` with no arguments auto-orients using the source's
// EXIF orientation tag before that crop, so a photo taken sideways on a
// phone still crops around the right axis. Metadata (EXIF/ICC/etc.) is
// intentionally stripped by NOT calling `.withMetadata()` -- sharp omits
// it by default -- so uploaded photos never leak a phone's GPS/orientation
// metadata into the served file.
export const TEAM_AVATAR_DERIVATIVE_SIZE = 512;
const TEAM_AVATAR_WEBP_QUALITY = 85;

export async function createTeamAvatarDerivative(
  originalBytes: ArrayBuffer | Buffer,
): Promise<Buffer> {
  const buffer = Buffer.isBuffer(originalBytes) ? originalBytes : Buffer.from(originalBytes);
  return sharp(buffer)
    .rotate()
    .resize(TEAM_AVATAR_DERIVATIVE_SIZE, TEAM_AVATAR_DERIVATIVE_SIZE, {
      fit: "cover",
      position: "centre",
    })
    .webp({ quality: TEAM_AVATAR_WEBP_QUALITY })
    .toBuffer();
}
