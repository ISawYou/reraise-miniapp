// One-time (but re-runnable) Supabase -> PostgreSQL backfill for all eleven
// domains that now have a Postgres implementation: app_settings, seasons,
// players, tournaments, registrations, results, tournament_live_entries,
// tournament_player_eliminations, activity_events, email_otp_codes,
// player_achievements.
//
// DOMAINS below is ordered to satisfy every FK in the schema for a full,
// from-scratch run (players before anything that references player_id;
// tournaments before anything that references tournament_id; registrations
// before tournament_live_entries, which FKs registration_id) -- notably this
// moved activity_events / email_otp_codes / player_achievements later than
// they were in the original five-table version, since all three FK to
// players and players did not exist yet as a domain at the time.
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
// migration tool. Instead, all eleven tables this script touches are
// redeclared locally below, matching the real schema's table/column names
// exactly (verified against lib/db/schema/*.ts at the time of writing).
//
// Idempotency, per table (see each backfillXxx function for the specific
// reasoning):
// - app_settings / player_achievements have a natural conflict key (a
//   business column, not just the surrogate id), so every run re-applies
//   the same values via onConflictDoUpdate.
// - seasons / players / tournaments / registrations / results /
//   tournament_live_entries use onConflictDoNothing on id: ids are never
//   remapped from Supabase, so re-running with the same source rows is a
//   per-row no-op, and this also keeps every FK between these tables
//   automatically consistent.
// - tournament_player_eliminations has no surrogate id at all (composite PK
//   in the real schema), so onConflictDoNothing targets
//   (tournament_id, player_id) instead.
// - activity_events / email_otp_codes have a surrogate uuid PK with no
//   natural business key and nothing referencing their id, so instead
//   they're gated by a table-level guard: if Postgres already has any rows,
//   the whole table is skipped rather than risking duplicates.
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
import { pgTable, text, jsonb, timestamp, uuid, date, boolean, integer, bigint } from "drizzle-orm/pg-core";

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

// players -- schema.ts deliberately drops three dead columns
// (requires_prepayment, no_show_count, last_no_show_at, per
// docs/POSTGRES_MIGRATION_AUDIT.md section 2/9), so only the columns that
// exist in the Postgres schema are selected/inserted here.
const playersTable = pgTable("players", {
  id: uuid().primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }),
  email: text(),
  username: text(),
  displayName: text("display_name").notNull(),
  adminDisplayName: text("admin_display_name"),
  pendingDisplayName: text("pending_display_name"),
  nicknameStatus: text("nickname_status").notNull(),
  telegramAvatarUrl: text("telegram_avatar_url"),
  customAvatarUrl: text("custom_avatar_url"),
  avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true }),
  role: text().notNull(),
  acceptedTermsAt: timestamp("accepted_terms_at", { withTimezone: true }),
  acceptedTermsVersion: text("accepted_terms_version"),
  profileCompletedAt: timestamp("profile_completed_at", { withTimezone: true }),
  canAccessFree: boolean("can_access_free").notNull(),
  canAccessPaid: boolean("can_access_paid").notNull(),
  canAccessCash: boolean("can_access_cash").notNull(),
  referralCount: integer("referral_count").notNull(),
  freeReentriesBalance: integer("free_reentries_balance").notNull(),
  yandexReviewBonusClaimed: boolean("yandex_review_bonus_claimed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

const tournamentsTable = pgTable("tournaments", {
  id: uuid().primaryKey(),
  title: text().notNull(),
  description: text(),
  location: text(),
  googleSheetTabName: text("google_sheet_tab_name"),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  maxPlayers: integer("max_players").notNull(),
  status: text().notNull(),
  kind: text().notNull(),
  tournamentType: text("tournament_type").notNull(),
  seasonId: uuid("season_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

const registrationsTable = pgTable("registrations", {
  id: uuid().primaryKey(),
  playerId: uuid("player_id").notNull(),
  tournamentId: uuid("tournament_id").notNull(),
  status: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

// results -- includes boss_knockouts (added by migration 0001, see
// docs/POSTGRES_MIGRATION_AUDIT.md / the Boss Bounty schema-drift fix).
const resultsTable = pgTable("results", {
  id: uuid().primaryKey(),
  tournamentId: uuid("tournament_id").notNull(),
  playerId: uuid("player_id").notNull(),
  seasonId: uuid("season_id"),
  place: integer().notNull(),
  reentries: integer().notNull(),
  knockouts: integer().notNull(),
  bossKnockouts: integer("boss_knockouts").notNull(),
  ratingPoints: integer("rating_points").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

// tournament_live_entries -- also includes boss_knockouts (migration 0001).
const tournamentLiveEntriesTable = pgTable("tournament_live_entries", {
  id: uuid().primaryKey(),
  tournamentId: uuid("tournament_id").notNull(),
  playerId: uuid("player_id").notNull(),
  registrationId: uuid("registration_id").notNull(),
  arrived: boolean().notNull(),
  rebuys: integer().notNull(),
  addons: integer().notNull(),
  knockouts: integer().notNull(),
  bossKnockouts: integer("boss_knockouts").notNull(),
  place: integer(),
  sheetRowNumber: integer("sheet_row_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// tournament_player_eliminations -- composite PK (tournament_id, player_id),
// no surrogate id column, same as in lib/db/schema/tournamentLiveState.ts.
const tournamentPlayerEliminationsTable = pgTable("tournament_player_eliminations", {
  tournamentId: uuid("tournament_id").notNull(),
  playerId: uuid("player_id").notNull(),
  eliminated: boolean().notNull(),
  eliminatedAt: timestamp("eliminated_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

async function tableRowCount(db, table) {
  const rows = await db.select({ count: sql`count(*)`.mapWith(Number) }).from(table);
  return rows[0].count;
}

// PostgREST (Supabase's query API) caps any single .select() at 1000 rows
// regardless of table size -- a plain, unranged select silently truncates
// instead of erroring. This reads a Supabase table in full by paging
// through .range() until a page comes back short. Only activity_events
// needs this today (the only source table over 1000 rows); everything else
// still uses a single select() as before.
const SUPABASE_PAGE_SIZE = 1000;

async function fetchAllRows(supabase, table, columns, orderColumn) {
  const rows = [];
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to read ${table} from Supabase: ${error.message}`);

    rows.push(...data);
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return rows;
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
// table-level guard instead of per-row idempotency. Paginated read via
// fetchAllRows: this table already has ~3900 rows, well past PostgREST's
// 1000-row cap on a single select().
async function backfillActivityEvents({ supabase, db }) {
  const existing = await tableRowCount(db, activityEventsTable);
  if (existing > 0) {
    return { status: "skipped", count: existing };
  }

  const rows = await fetchAllRows(
    supabase,
    "activity_events",
    "id, player_id, event_type, event_label, metadata, platform, session_id, created_at",
    "created_at"
  );

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

// players -- surrogate uuid PK, but unlike activity_events/email_otp_codes
// its id IS load-bearing: registrations/results/tournament_live_entries/
// tournament_player_eliminations/activity_events/email_otp_codes/
// player_achievements all FK to it, and ids are never remapped (see the
// seasons comment above) -- so idempotency here is onConflictDoNothing(id),
// same as seasons, not the table-level guard used for activity_events.
async function backfillPlayers({ supabase, db }) {
  const { data: rows, error } = await supabase
    .from("players")
    .select(
      "id, telegram_id, email, username, display_name, admin_display_name, pending_display_name, " +
        "nickname_status, telegram_avatar_url, custom_avatar_url, avatar_updated_at, role, " +
        "accepted_terms_at, accepted_terms_version, profile_completed_at, can_access_free, " +
        "can_access_paid, can_access_cash, referral_count, free_reentries_balance, " +
        "yandex_review_bonus_claimed, created_at"
    );
  if (error) throw new Error(`Failed to read players from Supabase: ${error.message}`);

  for (const row of rows) {
    await db
      .insert(playersTable)
      .values({
        id: row.id,
        telegramId: row.telegram_id,
        email: row.email,
        username: row.username,
        displayName: row.display_name,
        adminDisplayName: row.admin_display_name,
        pendingDisplayName: row.pending_display_name,
        nicknameStatus: row.nickname_status,
        telegramAvatarUrl: row.telegram_avatar_url,
        customAvatarUrl: row.custom_avatar_url,
        avatarUpdatedAt: row.avatar_updated_at ? new Date(row.avatar_updated_at) : null,
        role: row.role,
        acceptedTermsAt: row.accepted_terms_at ? new Date(row.accepted_terms_at) : null,
        acceptedTermsVersion: row.accepted_terms_version,
        profileCompletedAt: row.profile_completed_at ? new Date(row.profile_completed_at) : null,
        canAccessFree: row.can_access_free,
        canAccessPaid: row.can_access_paid,
        canAccessCash: row.can_access_cash,
        referralCount: row.referral_count,
        freeReentriesBalance: row.free_reentries_balance,
        yandexReviewBonusClaimed: row.yandex_review_bonus_claimed,
        createdAt: new Date(row.created_at),
      })
      .onConflictDoNothing({ target: playersTable.id });
  }
  return { status: "copied", count: rows.length };
}

// tournaments -- id referenced by registrations/results/tournament_live_entries/
// tournament_player_eliminations -> same onConflictDoNothing(id) strategy.
async function backfillTournaments({ supabase, db }) {
  const { data: rows, error } = await supabase
    .from("tournaments")
    .select(
      "id, title, description, location, google_sheet_tab_name, start_at, max_players, " +
        "status, kind, tournament_type, season_id, created_at"
    );
  if (error) throw new Error(`Failed to read tournaments from Supabase: ${error.message}`);

  for (const row of rows) {
    await db
      .insert(tournamentsTable)
      .values({
        id: row.id,
        title: row.title,
        description: row.description,
        location: row.location,
        googleSheetTabName: row.google_sheet_tab_name,
        startAt: new Date(row.start_at),
        maxPlayers: row.max_players,
        status: row.status,
        kind: row.kind,
        tournamentType: row.tournament_type,
        seasonId: row.season_id,
        createdAt: new Date(row.created_at),
      })
      .onConflictDoNothing({ target: tournamentsTable.id });
  }
  return { status: "copied", count: rows.length };
}

// registrations -- id referenced by tournament_live_entries.registration_id
// -> onConflictDoNothing(id).
async function backfillRegistrations({ supabase, db }) {
  const { data: rows, error } = await supabase
    .from("registrations")
    .select("id, player_id, tournament_id, status, created_at");
  if (error) throw new Error(`Failed to read registrations from Supabase: ${error.message}`);

  for (const row of rows) {
    await db
      .insert(registrationsTable)
      .values({
        id: row.id,
        playerId: row.player_id,
        tournamentId: row.tournament_id,
        status: row.status,
        createdAt: new Date(row.created_at),
      })
      .onConflictDoNothing({ target: registrationsTable.id });
  }
  return { status: "copied", count: rows.length };
}

// results -- nothing FKs to results.id, but onConflictDoNothing(id) is kept
// for the same reason as everywhere else in this script: ids are never
// remapped, so re-running with the same source data is naturally a no-op
// per row, without needing a separate table-level guard.
async function backfillResults({ supabase, db }) {
  const { data: rows, error } = await supabase
    .from("results")
    .select(
      "id, tournament_id, player_id, season_id, place, reentries, knockouts, boss_knockouts, " +
        "rating_points, created_at"
    );
  if (error) throw new Error(`Failed to read results from Supabase: ${error.message}`);

  for (const row of rows) {
    await db
      .insert(resultsTable)
      .values({
        id: row.id,
        tournamentId: row.tournament_id,
        playerId: row.player_id,
        seasonId: row.season_id,
        place: row.place,
        reentries: row.reentries,
        knockouts: row.knockouts,
        bossKnockouts: row.boss_knockouts ?? 0,
        ratingPoints: row.rating_points,
        createdAt: new Date(row.created_at),
      })
      .onConflictDoNothing({ target: resultsTable.id });
  }
  return { status: "copied", count: rows.length };
}

// tournament_live_entries -- same onConflictDoNothing(id) approach; depends
// on tournaments/players/registrations already being present.
async function backfillTournamentLiveEntries({ supabase, db }) {
  const { data: rows, error } = await supabase
    .from("tournament_live_entries")
    .select(
      "id, tournament_id, player_id, registration_id, arrived, rebuys, addons, knockouts, " +
        "boss_knockouts, place, sheet_row_number, created_at, updated_at"
    );
  if (error) throw new Error(`Failed to read tournament_live_entries from Supabase: ${error.message}`);

  for (const row of rows) {
    await db
      .insert(tournamentLiveEntriesTable)
      .values({
        id: row.id,
        tournamentId: row.tournament_id,
        playerId: row.player_id,
        registrationId: row.registration_id,
        arrived: row.arrived,
        rebuys: row.rebuys,
        addons: row.addons,
        knockouts: row.knockouts,
        bossKnockouts: row.boss_knockouts ?? 0,
        place: row.place,
        sheetRowNumber: row.sheet_row_number,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      })
      .onConflictDoNothing({ target: tournamentLiveEntriesTable.id });
  }
  return { status: "copied", count: rows.length };
}

// tournament_player_eliminations -- no surrogate id, so idempotency uses
// the table's actual composite PK (tournament_id, player_id) as the
// onConflictDoNothing target instead.
async function backfillTournamentPlayerEliminations({ supabase, db }) {
  const { data: rows, error } = await supabase
    .from("tournament_player_eliminations")
    .select("tournament_id, player_id, eliminated, eliminated_at, updated_at");
  if (error) throw new Error(`Failed to read tournament_player_eliminations from Supabase: ${error.message}`);

  for (const row of rows) {
    await db
      .insert(tournamentPlayerEliminationsTable)
      .values({
        tournamentId: row.tournament_id,
        playerId: row.player_id,
        eliminated: row.eliminated,
        eliminatedAt: row.eliminated_at ? new Date(row.eliminated_at) : null,
        updatedAt: new Date(row.updated_at),
      })
      .onConflictDoNothing({
        target: [tournamentPlayerEliminationsTable.tournamentId, tournamentPlayerEliminationsTable.playerId],
      });
  }
  return { status: "copied", count: rows.length };
}

// Order here is also the default run order and the order tables are
// listed in the final report -- must satisfy every FK for a full run (see
// the file-header comment): players/tournaments/registrations/results/
// tournament_live_entries/tournament_player_eliminations before the three
// tables that FK to players (activity_events, email_otp_codes,
// player_achievements).
const DOMAINS = {
  app_settings: backfillAppSettings,
  seasons: backfillSeasons,
  players: backfillPlayers,
  tournaments: backfillTournaments,
  registrations: backfillRegistrations,
  results: backfillResults,
  tournament_live_entries: backfillTournamentLiveEntries,
  tournament_player_eliminations: backfillTournamentPlayerEliminations,
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

  // Re-sorted to DOMAINS' own (FK-safe) order rather than the order the user
  // typed them in -- e.g. `--only=tournaments,players` must still insert
  // players first, or the tournaments insert has nothing to reference.
  return Object.keys(DOMAINS).filter((name) => requested.includes(name));
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
