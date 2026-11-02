const SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  "image/jpeg": (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/png": (bytes) => bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value),
  "image/webp": (bytes) => bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP",
};

export const PLAYER_AVATAR_CONTENT_TYPES = new Set(Object.keys(SIGNATURES));
export const MAX_PLAYER_AVATAR_SIZE_BYTES = 20 * 1024 * 1024;

export function hasValidPlayerAvatarSignature(contentType: string, buffer: ArrayBuffer): boolean {
  const matcher = SIGNATURES[contentType];
  return Boolean(matcher?.(new Uint8Array(buffer)));
}
