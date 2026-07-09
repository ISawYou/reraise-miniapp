// One-time (but re-runnable) migration: existing players.custom_avatar_url
// values that still point at Supabase Storage (either proxied through
// nginx's own /supabase/storage/v1/ location, or the direct supabase.co
// domain) get downloaded and written into the same local storage
// LocalAvatarStorageRepository now uses for new uploads
// (storage/avatars/{playerId}/{avatar|telegram-avatar}.{ext}), and the row
// is rewritten to the new https://re-raise.ru/storage/avatars/... URL.
//
// Follows the same shape as scripts/migrate-telegram-avatars.ts and
// poker-clock's scripts/migrate-storage-images.mjs: a plain, standalone
// script, not a Route Handler, deliberately bypassing the Repository Layer
// (same reasoning as scripts/backfill-postgres.mjs's header comment).
//
// Why contentTypeToExtension is redeclared here instead of imported from
// lib/repositories/avatar-storage/contentTypeToExtension.ts: same reason
// backfill-postgres.mjs redeclares its Drizzle tables instead of importing
// lib/db/schema -- this project's extension-less relative imports resolve
// fine under Next.js's bundler but not under plain `node`.
//
// Does NOT touch Supabase Storage itself (read-only fetch over public
// HTTPS, no service-role key needed -- the bucket is public) and does NOT
// rewrite/delete anything that isn't recognized as one of the two legacy
// URL shapes.
//
// Must be run with cwd = repo root (same convention as
// LocalAvatarStorageRepository's own STORAGE_ROOT): files land under
// ./storage/avatars/, the same host path docker-compose.yml's bind mount
// (./storage:/app/public/storage) uses.
//
// Usage:
//   node scripts/migrate-local-avatars.mjs                  (all players)
//   node scripts/migrate-local-avatars.mjs --only=<playerId> (one player)
//   node scripts/migrate-local-avatars.mjs --dry-run          (no writes)
// Requires DATABASE_URL in the environment (.env.local picked up
// automatically, same as the existing db:*/backfill scripts).

import postgres from "postgres";
import { access, mkdir, writeFile } from "fs/promises";
import path from "path";

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function contentTypeToExtension(contentType) {
  return EXTENSIONS[contentType] ?? "jpg";
}

export const STORAGE_ROOT = path.join(process.cwd(), "storage", "avatars");
export const LOCAL_BASE_URL = "https://re-raise.ru/storage/avatars";

// Rows already migrated by a previous run -- nothing to do.
const LOCAL_URL_RE =
  /^https:\/\/re-raise\.ru\/storage\/avatars\/([^/]+)\/(avatar|telegram-avatar)\.[a-z0-9]+$/i;

// The two legacy shapes seen in production data (see
// docs/POSTGRES_MIGRATION_AUDIT.md's Storage follow-up):
// - proxied through nginx's own /supabase/storage/v1/ location
//   (https://re-raise.ru/supabase/storage/v1/object/public/avatars/...)
// - the direct Supabase Storage domain
//   (https://<project-ref>.supabase.co/storage/v1/object/public/avatars/...)
// Both may carry a trailing "?v=..." cache-busting query string.
const SUPABASE_URL_RE =
  /^https:\/\/(?:re-raise\.ru\/supabase|[^/]+\.supabase\.co)\/storage\/v1\/object\/public\/avatars\/([^/]+)\/(avatar|telegram-avatar)(?:\?.*)?$/i;

// Classifies a stored custom_avatar_url so the caller knows what (if
// anything) needs to happen -- never throws, unrecognized/empty values are
// just left alone.
export function classifyUrl(url) {
  if (!url) return { kind: "empty" };
  if (LOCAL_URL_RE.test(url)) return { kind: "already-local" };

  const match = url.match(SUPABASE_URL_RE);
  if (!match) return { kind: "unrecognized" };

  const [, , filename] = match;
  return { kind: "supabase", filename };
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Thrown for a non-ok fetch response -- carries `status` as a real field
// (not just baked into the message string) so callers can single out 404s
// in the report without parsing error text.
class FetchStatusError extends Error {
  constructor(status, statusText) {
    super(`HTTP ${status} ${statusText}`);
    this.name = "FetchStatusError";
    this.status = status;
  }
}

// Migrates one player's avatar. Idempotent by construction:
// - if the row is already local, the caller never gets here;
// - if a file from a previous (interrupted) run already exists on disk,
//   this skips re-downloading and only (re-)points the DB row at it;
// - dry-run still performs the real HTTP fetch (so real errors --
//   404s, network failures, unexpected content-type -- surface in the
//   report), it just never writes to disk or to the database.
export async function migratePlayer({ sql, playerId, sourceUrl, filename, dryRun }) {
  const targetDir = path.join(STORAGE_ROOT, playerId);

  for (const ext of Object.values(EXTENSIONS)) {
    const candidate = path.join(targetDir, `${filename}.${ext}`);
    if (await fileExists(candidate)) {
      const newUrl = `${LOCAL_BASE_URL}/${playerId}/${filename}.${ext}`;
      if (!dryRun) {
        await sql`update players set custom_avatar_url = ${newUrl} where id = ${playerId}`;
      }
      return { action: "db-update-only", newUrl, ext, filename };
    }
  }

  const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new FetchStatusError(res.status, res.statusText);
  }

  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Unexpected content-type: ${contentType}`);
  }

  const ext = contentTypeToExtension(contentType);
  const newUrl = `${LOCAL_BASE_URL}/${playerId}/${filename}.${ext}`;

  if (dryRun) {
    await res.arrayBuffer(); // drain the body so the connection closes cleanly
    return { action: "would-migrate", newUrl, ext, filename };
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const destination = path.join(targetDir, `${filename}.${ext}`);

  await mkdir(targetDir, { recursive: true });
  await writeFile(destination, buffer);
  await sql`update players set custom_avatar_url = ${newUrl} where id = ${playerId}`;

  return { action: "migrated", newUrl, ext, filename };
}

export function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const onlyFlag = argv.find((arg) => arg.startsWith("--only="));
  const only = onlyFlag ? onlyFlag.slice("--only=".length).trim() : null;
  return { dryRun, only };
}

async function main() {
  const { dryRun, only } = parseArgs(process.argv.slice(2));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing DATABASE_URL environment variable");

  const sql = postgres(databaseUrl, { max: 1 });

  console.log(`Starting local avatar migration${dryRun ? " (dry run, no writes)" : ""}...\n`);

  const counts = { total: 0, migrated: 0, alreadyLocal: 0, skipped: 0, errors: 0 };
  const byFilename = { avatar: 0, "telegram-avatar": 0 };
  const byExt = { jpg: 0, png: 0, webp: 0 };
  let notFoundCount = 0;
  const errors = [];

  try {
    const rows = only
      ? await sql`select id, custom_avatar_url from players where id = ${only}`
      : await sql`select id, custom_avatar_url from players where custom_avatar_url is not null`;

    counts.total = rows.length;

    for (const row of rows) {
      const playerId = row.id;
      const classification = classifyUrl(row.custom_avatar_url);

      if (classification.kind === "already-local") {
        counts.alreadyLocal += 1;
        console.log(`✔ ${playerId}  already local`);
        continue;
      }

      if (classification.kind === "empty" || classification.kind === "unrecognized") {
        counts.skipped += 1;
        console.log(
          `- ${playerId}  skipped (${classification.kind === "empty" ? "no avatar" : "unrecognized URL"})`
        );
        continue;
      }

      try {
        const result = await migratePlayer({
          sql,
          playerId,
          sourceUrl: row.custom_avatar_url,
          filename: classification.filename,
          dryRun,
        });
        counts.migrated += 1;
        byFilename[result.filename] += 1;
        byExt[result.ext] += 1;
        console.log(`✔ ${playerId}  ${result.action} -> ${result.newUrl}`);
      } catch (err) {
        counts.errors += 1;
        if (err instanceof FetchStatusError && err.status === 404) {
          notFoundCount += 1;
        }
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ playerId, message });
        console.warn(`✘ ${playerId}  error: ${message}`);
      }
    }
  } finally {
    await sql.end();
  }

  console.log("\n" + "-".repeat(40));
  console.log(dryRun ? "Dry run completed\n" : "Migration completed\n");
  console.log(`Найдено игроков с custom_avatar_url: ${counts.total}`);
  console.log(`  ${dryRun ? "Будет мигрировано" : "Мигрировано"}: ${counts.migrated}`);
  console.log(`  Уже локальные: ${counts.alreadyLocal}`);
  console.log(`  Пропущено (нераспознанный URL / нет аватара): ${counts.skipped}`);
  console.log(`  Ошибок: ${counts.errors}`);

  if (counts.migrated > 0) {
    console.log(`\n${dryRun ? "Будет мигрировано" : "Мигрировано"} по типу файла:`);
    console.log(`  avatar: ${byFilename.avatar}`);
    console.log(`  telegram-avatar: ${byFilename["telegram-avatar"]}`);

    console.log("\nПо расширениям:");
    console.log(`  jpg: ${byExt.jpg}`);
    console.log(`  png: ${byExt.png}`);
    console.log(`  webp: ${byExt.webp}`);
  }

  if (counts.errors > 0) {
    console.log(`\n404: ${notFoundCount}`);
    if (counts.errors - notFoundCount > 0) {
      console.log(`Прочие ошибки: ${counts.errors - notFoundCount}`);
    }

    console.log("\nОшибки:");
    for (const e of errors) {
      console.log(`  ${e.playerId}: ${e.message}`);
    }
  }

  console.log("\nDone.");
}

// Guarded so this module can be imported (e.g. from a test) without
// immediately trying to connect to Postgres.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Migration failed:");
    console.error(err);
    process.exit(1);
  });
}
