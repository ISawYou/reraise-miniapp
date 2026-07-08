import "server-only";

import { getSupabaseServer } from "@/lib/supabase-server";
import type { Player } from "@/types/domain";

const TELEGRAM_SYNC_FILENAME = "telegram-avatar";

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

    if (!contentType.startsWith("image/")) {
      console.warn("[avatar-sync] Unexpected content-type:", contentType);
      return player;
    }

    arrayBuffer = await res.arrayBuffer();
  } catch (err) {
    console.warn("[avatar-sync] Fetch error:", err);
    return player;
  }

  // --- Загружаем в Supabase Storage ---
  const supabase = getSupabaseServer();
  const filePath = `${player.id}/${TELEGRAM_SYNC_FILENAME}`;

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(filePath, arrayBuffer, {
      upsert: true,
      contentType,
    });

  if (uploadError) {
    console.warn("[avatar-sync] Storage upload failed:", uploadError.message);
    return player;
  }

  const { data: publicData } = supabase.storage
    .from("avatars")
    .getPublicUrl(filePath);

  const localUrl = publicData.publicUrl;

  // --- Сохраняем URL в БД ---
  const { error: updateError } = await supabase
    .from("players")
    .update({ custom_avatar_url: localUrl })
    .eq("id", player.id);

  if (updateError) {
    console.warn("[avatar-sync] DB update failed:", updateError.message);
    return player;
  }

  return { ...player, custom_avatar_url: localUrl };
}
