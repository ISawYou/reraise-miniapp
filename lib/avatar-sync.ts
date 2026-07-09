import "server-only";

import { avatarStorageRepository, contentTypeToExtension, playerRepository } from "@/lib/repositories";
import type { Player } from "@/types/domain";

const TELEGRAM_SYNC_FILENAME = "telegram-avatar";

// Telegram serves an SVG monogram placeholder (colored circle + initials)
// instead of a real photo when the user has no visible profile picture --
// same content-types contentTypeToExtension() actually knows how to name
// on disk. Anything outside this set (notably image/svg+xml) isn't a real
// photo worth persisting as the player's avatar.
const SUPPORTED_TELEGRAM_AVATAR_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// URL вида .../avatars/{id}/telegram-avatar
function isTelegramSyncedUrl(url: string | null | undefined): boolean {
  return Boolean(url?.includes(`/${TELEGRAM_SYNC_FILENAME}`));
}

// URL вида .../avatars/{id}/avatar  (загружен пользователем вручную)
function isUserUploadedUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes("/avatar") && !url.includes(`/${TELEGRAM_SYNC_FILENAME}`);
}

/**
 * Скачивает аватар из Telegram и кладёт его в Supabase Storage.
 * Вызывается при каждом Telegram-логине; пропускает работу если копия уже есть.
 *
 * Пропускает если:
 * - photoUrl не передан
 * - у игрока уже есть вручную загруженный custom_avatar_url
 * - у игрока уже есть telegram-synced копия в Storage
 *
 * Ошибки (недоступен Telegram CDN, ошибка загрузки) логируются и
 * не бросают исключение — авторизация продолжается без аватарки.
 */
export async function syncTelegramAvatar(
  player: Player,
  photoUrl: string | null | undefined
): Promise<Player> {
  if (!photoUrl) return player;

  // Не трогаем аватар, загруженный пользователем вручную
  if (isUserUploadedUrl(player.custom_avatar_url)) return player;

  // Уже есть локальная копия telegram-аватарки — пропускаем
  if (isTelegramSyncedUrl(player.custom_avatar_url)) return player;

  // --- Скачиваем из Telegram ---
  let arrayBuffer: ArrayBuffer;
  let contentType: string;

  try {
    const res = await fetch(photoUrl, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(
        `[avatar-sync] Telegram fetch failed: ${res.status} ${res.statusText}`,
        photoUrl
      );
      return player;
    }

    contentType = res.headers.get("content-type") ?? "image/jpeg";

    if (!SUPPORTED_TELEGRAM_AVATAR_CONTENT_TYPES.has(contentType)) {
      console.warn("[avatar-sync] Unsupported content-type, skipping:", contentType);
      return player;
    }

    arrayBuffer = await res.arrayBuffer();
  } catch (err) {
    console.warn("[avatar-sync] Fetch error:", err);
    return player;
  }

  // --- Загружаем в Storage ---
  const filePath = `${player.id}/${TELEGRAM_SYNC_FILENAME}.${contentTypeToExtension(contentType)}`;

  const { error: uploadError } = await avatarStorageRepository.upload(
    filePath,
    arrayBuffer,
    contentType
  );

  if (uploadError) {
    console.warn("[avatar-sync] Storage upload failed:", uploadError);
    return player;
  }

  const localUrl = avatarStorageRepository.getPublicUrl(filePath);

  // --- Сохраняем URL в БД ---
  try {
    await playerRepository.update(player.id, { custom_avatar_url: localUrl });
  } catch (err) {
    console.warn(
      "[avatar-sync] DB update failed:",
      err instanceof Error ? err.message : String(err)
    );
    return player;
  }

  return { ...player, custom_avatar_url: localUrl };
}
