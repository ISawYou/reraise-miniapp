/**
 * BATCH MIGRATION: Telegram avatars → Supabase Storage
 *
 * Скачивает telegram_avatar_url каждого игрока и кладёт копию в Storage,
 * затем обновляет custom_avatar_url на proxy-URL нашего домена.
 *
 * ЗАПУСК (вручную, после проверки):
 *   npx tsx scripts/migrate-telegram-avatars.ts
 *
 * Требует в окружении:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Безопасен для повторного запуска: upsert=true, пропускает игроков
 * у которых custom_avatar_url уже указывает на /telegram-avatar.
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Требуются NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TELEGRAM_SYNC_FILENAME = "telegram-avatar";
const DELAY_MS = 500; // пауза между игроками, чтобы не флудить Telegram CDN

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { data: players, error } = await supabase
    .from("players")
    .select("id, telegram_avatar_url, custom_avatar_url")
    .not("telegram_avatar_url", "is", null);

  if (error) {
    console.error("Ошибка получения игроков:", error.message);
    process.exit(1);
  }

  const candidates = (players ?? []).filter((p) => {
    // Пропускаем тех, у кого уже есть telegram-synced копия
    if (p.custom_avatar_url?.includes(`/${TELEGRAM_SYNC_FILENAME}`)) return false;
    // Пропускаем тех, у кого есть вручную загруженный аватар (/avatar без /telegram-avatar)
    if (
      p.custom_avatar_url?.includes("/avatar") &&
      !p.custom_avatar_url?.includes(`/${TELEGRAM_SYNC_FILENAME}`)
    )
      return false;
    return true;
  });

  console.log(
    `Всего игроков с telegram_avatar_url: ${players?.length ?? 0}`,
    `\nКандидатов для миграции: ${candidates.length}`
  );

  let ok = 0;
  let fail = 0;

  for (const player of candidates) {
    const photoUrl = player.telegram_avatar_url as string;
    console.log(`[${player.id}] Скачиваем ${photoUrl}`);

    try {
      const res = await fetch(photoUrl, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        console.warn(`  → HTTP ${res.status} — пропускаем`);
        fail++;
        await sleep(DELAY_MS);
        continue;
      }

      const contentType = res.headers.get("content-type") ?? "image/jpeg";
      if (!contentType.startsWith("image/")) {
        console.warn(`  → неожиданный content-type: ${contentType} — пропускаем`);
        fail++;
        await sleep(DELAY_MS);
        continue;
      }

      const arrayBuffer = await res.arrayBuffer();
      const filePath = `${player.id}/${TELEGRAM_SYNC_FILENAME}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, arrayBuffer, { upsert: true, contentType });

      if (uploadError) {
        console.warn(`  → ошибка загрузки: ${uploadError.message} — пропускаем`);
        fail++;
        await sleep(DELAY_MS);
        continue;
      }

      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(filePath);
      const localUrl = pub.publicUrl;

      const { error: updateError } = await supabase
        .from("players")
        .update({ custom_avatar_url: localUrl })
        .eq("id", player.id);

      if (updateError) {
        console.warn(`  → ошибка обновления БД: ${updateError.message}`);
        fail++;
      } else {
        console.log(`  → OK: ${localUrl}`);
        ok++;
      }
    } catch (err) {
      console.warn(`  → исключение:`, err);
      fail++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\nГотово. Успешно: ${ok}, ошибок: ${fail}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
