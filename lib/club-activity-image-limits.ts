// Client-safe limits/messages for Club Activity image uploads. Deliberately
// free of any `sharp`/fs import: the admin page imports this for instant
// pre-checks, while the real validation stays server-side in
// lib/club-activity-image.ts.

// 8 MB, not 10: /api/admin/** runs through middleware (Next "proxy"), which
// buffers at most `proxyClientMaxBodySize` (Next default 10 MiB) of a
// request body and silently truncates the rest. 8 MB keeps a full multipart
// upload comfortably inside that buffer without raising a global limit, and
// still covers typical phone photos (12-24 MP JPEG is ~2-6 MB). nginx allows
// 20 MB (client_max_body_size), so it is never the binding limit.
export const CLUB_ACTIVITY_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export const CLUB_ACTIVITY_IMAGE_ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

// Also used as the file input's `accept`. Listing concrete types (no HEIC)
// lets iOS photo pickers transcode a HEIC photo to JPEG on selection; a HEIC
// that still arrives is rejected with a clear message (see "heic" below).
export const CLUB_ACTIVITY_IMAGE_ACCEPT_ATTRIBUTE = CLUB_ACTIVITY_IMAGE_ACCEPTED_TYPES.join(",");

export type ClubActivityImageErrorCode =
  | "empty"
  | "too_large"
  | "unsupported_type"
  | "heic"
  | "not_image"
  | "too_many_pixels"
  | "processing_failed";

export const CLUB_ACTIVITY_IMAGE_MESSAGES: Record<ClubActivityImageErrorCode, string> = {
  empty: "Файл пустой",
  too_large: "Файл слишком большой (максимум 8 МБ)",
  unsupported_type: "Этот формат изображения не поддерживается. Используйте JPEG, PNG или WebP",
  heic: "Этот формат изображения не поддерживается (HEIC). Сохраните фото как JPEG или PNG",
  not_image: "Не удалось обработать изображение: файл повреждён или не является изображением",
  too_many_pixels: "Изображение слишком большое по разрешению",
  processing_failed: "Не удалось обработать изображение",
};

/** Instant client-side pre-check; returns a user-facing error or null. */
export function getClubActivityImageClientError(file: { size: number; type: string }): string | null {
  if (file.size <= 0) return CLUB_ACTIVITY_IMAGE_MESSAGES.empty;
  if (file.size > CLUB_ACTIVITY_IMAGE_MAX_BYTES) return CLUB_ACTIVITY_IMAGE_MESSAGES.too_large;
  const type = file.type.toLowerCase();
  if (/^image\/(heic|heif)/.test(type)) return CLUB_ACTIVITY_IMAGE_MESSAGES.heic;
  if (!(CLUB_ACTIVITY_IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type)) {
    return CLUB_ACTIVITY_IMAGE_MESSAGES.unsupported_type;
  }
  return null;
}
