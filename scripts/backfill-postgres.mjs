// One-time (but re-runnable) Supabase -> PostgreSQL backfill for the five
// domains that already have a Postgres implementation: app_settings,
// seasons, activity_events, email_otp_codes, player_achievements.
//
// Follows the same shape as poker-clock/scripts/migrate-design-presets.mjs:
// a plain, standalone script, not a Route Handler. Reads directly via
// @supabase/supabase-js and writes directly via drizzle-orm/postgres-js,
// deliberately bypassing the app's Repository Layer.
//
// Why not import lib/db/client.ts or lib/db/schema/*.ts: their internal
// relative imports (e.g. "./schema", "./players") omit file extensions,
// which every Repository file's real caller (Next.js's bundler) resolves
// automatically but plain `node` does not -- confirmed empirically, not
// assumed (`node -e "import('./lib/db/client.ts')"` throws
// ERR_UNSUPPORTED_DIR_IMPORT / "Cannot find module './players'").
// Reusing those files here would require either a custom resolve loader or
// editing app source for a script's sake -- out of scope for a throwaway
// migration tool. Instead, the five tables this script touches are
// redeclared locally below, matching the real schema's table/column names
// exactly (verified against lib/db/schema/*.ts at the time of writing).
//
// Idempotency, per table:
// - app_settings / seasons / player_achievements have a natural conflict
//   key, so every run just re-applies the same values (onConflictDoUpdate /
//   onConflictDoNothing) -- safe to run any number of times.
// - activity_events / email_otp_codes have a surrogate uuid PK with no
//   natural business key, so instead they're gated by a table-level guard:
//   if Postgres already has any rows, the whole table is skipped rather
//   than risking duplicates.
//
// Usage:
//   npm run backfill:postgres                                  (all tables)
//   npm run backfill:postgres -- --only=seasons                (one table)
//   npm run backfill:postgres -- --only=app_settings,seasons    (a subset)
// --table= and --tables= are accepted as synonyms for --only=.
// Requires DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// in the environment (.env.local is picked up automatically, same as the
// existing db:* scripts).

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { pgTable, text, jsonb, timestamp, uuid, date, boolean, integer } from "drizzle-orm/pg-core";

const appSettingsTable = pgTable("app_settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

const seasonsTable = pgTable("seasons", {
  id: uuid().primaryKey(),
  title: text().notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  isActive: boolean("is_active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

const activityEventsTable = pgTable("activity_events", {
  id: uuid().primaryKey(),
  playerId: uuid("player_id").notNull(),
  eventType: text("event_type").notNull(),
  eventLabel: text("event_label"),
  metadata: jsonb(),
  platform: text().notNull(),
  sessionId: text("session_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

const emailOtpCodesTable = pgTable("email_otp_codes", {
  id: uuid().primaryKey(),
  email: text().notNull(),
  purpose: text().notNull(),
  playerId: uuid("player_id"),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  resendAfterAt: timestamp("resend_after_at", { withTimezone: true }).notNull(),
  failedAttempts: integer("failed_attempts").notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

const playerAchievementsTable = pgTable("player_achievements", {
  id: uuid().primaryKey(),
  playerId: uuid("player_id").notNull(),
  achievementCode: text("achievement_code").notNull(),
  currentValue: integer("current_value").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

async function tableRowCount(db, table) {
  const rows = await db.select({ count: sql`count(*)`.mapWith(Number) }).from(table);
  return rows[0].count;
}

// app_settings -- tiny, naturally idempotent via onConflictDoUpdate.
async function backfillAppSettings({ supabase, db }) {
  const { data: rows, error } = await supabase.from("app_settings").select("key, value, updated_at");
  if (error) throw new Error(`Failed to read app_settings from Supabase: ${error.message}`);

  for (const row of rows) {
    await db
      .insert(appSettingsTable)
      .values({ key: row.key, value: row.value, updatedAt: new Date(row.updated_at) })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: { value: sql`excluded.value`, updatedAt: sql`excluded.updated_at` },
      });
  }
  return { status: "copied", count: rows.length };
}

// seasons -- naturally idempotent via onConflictDoNothing on id (the
// original id must survive intact for tournaments.season_id to reference
// later, once Tournament migrates).
async function backfillSeasons({ supabase, db }) {
  const { data: rows, error } = await supabase.from("seasons").select("*");
  if (error) throw new Error(`Failed to read seasons from Supabase: ${error.message}`);

  for (const row of rows) {
    await db
      .insert(seasonsTable)
      .values({
        id: row.id,
        title: row.title,
        startDate: row.start_date,
        endDate: row.end_date,
        isActive: row.is_active,
        createdAt: new Date(row.created_at),
      })
      .onConflictDoNothing({ target: seasonsTable.id });
  }
  return { status: "copied", count: rows.length };
}

// activity_events -- surrogate uuid PK, no natural conflict key ->
// table-level guard instead of per-row idempotency.
async function backfillActivityEvents({ supabase, db }) {
  const existing = await tableRowCount(db, activityEventsTable);
  if (existing > 0) {
    return { status: "skipped", count: existing };
  }

  const { data: rows, error } = await supabase
    .from("activity_events")
    .select("id, player_id, event_type, event_label, metadata, platform, session_id, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to read activity_events from Supabase: ${error.message}`);

  for (const row of rows) {
    await db.insert(activityEventsTable).values({
      id: row.id,
      playerId: row.player_id,
      eventType: row.event_type,
      eventLabel: row.event_label,
      metadata: row.metadata,
      platform: row.platform,
      sessionId: row.session_id,
      createdAt: new Date(row.created_at),
    });
  }
  return { status: "copied", count: rows.length };
}

// email_otp_codes -- same surrogate-PK situation as activity_events.
// Original created_at/updated_at are preserved (reading Supabase's raw
// columns directly makes this free, unlike going through
// EmailOtpRepository.create(), which has no field for the original
// timestamp).
async function backfillEmailOtpCodes({ supabase, db }) {
  const existing = await tableRowCount(db, emailOtpCodesTable);
  if (existing > 0) {
    return { status: "skipped", count: existing };
  }

  const { data: rows, error } = await supabase.from("email_otp_codes").select("*");
  if (error) throw new Error(`Failed to read email_otp_codes from Supabase: ${error.message}`);

  for (const row of rows) {
    await db.insert(emailOtpCodesTable).values({
      id: row.id,
      email: row.email,
      purpose: row.purpose,
      playerId: row.player_id,
      codeHash: row.code_hash,
      expiresAt: new Date(row.expires_at),
      resendAfterAt: new Date(row.resend_after_at),
      failedAttempts: row.failed_attempts,
      consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }
  return { status: "copied", count: rows.length };
}

// player_achievements -- naturally idempotent via onConflictDoUpdate on the
// composite (player_id, achievement_code) unique index. Read straight from
// Supabase's player_achievements table -- no need to enumerate players
// first, unlike the Repository-based approach this replaces.
async function backfillPlayerAchievements({ supabase, db }) {
  const { data: rows, error } = await supabase.from("player_achievements").select("*");
  if (error) throw new Error(`Failed to read player_achievements from Supabase: ${error.message}`);

  for (const row of rows) {
    await db
      .insert(playerAchievementsTable)
      .values({
        id: row.id,
        playerId: row.player_id,
        achievementCode: row.achievement_code,
        currentValue: row.current_value,
        completedAt: row.completed_at ? new Date(row.completed_at) : null,
        updatedAt: new Date(row.updated_at),
      })
      .onConflictDoUpdate({
        target: [playerAchievementsTable.playerId, playerAchievementsTable.achievementCode],
        set: {
          currentValue: sql`excluded.current_value`,
          completedAt: sql`excluded.completed_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  return { status: "copied", count: rows.length };
}

// Order here is also the default run order and the order tables are
// listed in the final report.
const DOMAINS = {
  app_settings: backfillAppSettings,
  seasons: backfillSeasons,
  activity_events: backfillActivityEvents,
  email_otp_codes: backfillEmailOtpCodes,
  player_achievements: backfillPlayerAchievements,
};

const NAME_WIDTH = Math.max(...Object.keys(DOMAINS).map((name) => name.length)) + 2;

function parseSelectedDomains(argv) {
  const flag = argv.find(
    (arg) => arg.startsWith("--only=") || arg.startsWith("--table=") || arg.startsWith("--tables=")
  );
  if (!flag) {
    return Object.keys(DOMAINS);
  }

  const requested = flag.slice(flag.indexOf("=") + 1).split(",").map((name) => name.trim()).filter(Boolean);
  const unknown = requested.filter((name) => !(name in DOMAINS));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown table(s): ${unknown.join(", ")}. Available: ${Object.keys(DOMAINS).join(", ")}`
    );
  }
  return requested;
}

async function main() {
  const selected = parseSelectedDomains(process.argv.slice(2));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl = process.env.DATABASE_URL;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable");
  if (!databaseUrl) throw new Error("Missing DATABASE_URL environment variable");

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const queryClient = postgres(databaseUrl, { max: 1 });
  const db = drizzle(queryClient);

  console.log("Starting PostgreSQL backfill...\n");

  const results = [];
  try {
    for (const name of selected) {
      const result = await DOMAINS[name]({ supabase, db });
      results.push({ name, ...result });

      const label = name.padEnd(NAME_WIDTH);
      if (result.status === "copied") {
        console.log(`✔ ${label} copied ${result.count} rows`);
      } else {
        console.log(`✔ ${label} skipped (already contains data)`);
      }
    }
  } finally {
    await queryClient.end();
  }

  const copied = results.filter((r) => r.status === "copied");
  const skipped = results.filter((r) => r.status === "skipped");

  console.log("\n" + "-".repeat(40));
  console.log("Backfill completed successfully\n");

  if (copied.length > 0) {
    console.log("Copied:");
    for (const r of copied) {
      console.log(`  ${r.name}: ${r.count}`);
    }
    console.log("");
  }

  if (skipped.length > 0) {
    console.log("Skipped:");
    for (const r of skipped) {
      console.log(`  ${r.name}`);
    }
    console.log("");
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Backfill failed:");
  console.error(err);
  process.exit(1);
});
