import { pgTable, uuid, text, bigint, boolean, integer, timestamp, uniqueIndex, index, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Target schema per docs/POSTGRES_MIGRATION_AUDIT.md — not a 1:1 copy of the
// current Supabase table. Three columns are deliberately dropped:
// requires_prepayment, no_show_count, last_no_show_at — an unfinished
// "no-show" feature never wired to any app code (absent even from
// PlayerRow in types/database.ts; confirmed via pg_stats that all 173
// existing rows hold only the default value).
export const players = pgTable("players", {
  id: uuid().primaryKey().defaultRandom(),

  // Identity: usually Telegram or email, but neither is enforced at the DB
  // level — addAdminTournamentParticipant() (features/tournaments.ts)
  // deliberately creates offline/manual players with both null, and real
  // production data already depends on that (see
  // docs/POSTGRES_MIGRATION_AUDIT.md's follow-up: a players_identity_present
  // CHECK was tried and reverted for exactly this reason). Both stay
  // nullable because either origin -- or neither -- can create a player.
  telegramId: bigint("telegram_id", { mode: "number" }).unique(),
  email: text(),
  username: text(),

  displayName: text("display_name").notNull(),
  adminDisplayName: text("admin_display_name"),
  pendingDisplayName: text("pending_display_name"),
  nicknameStatus: text("nickname_status").notNull().default("approved"),

  telegramAvatarUrl: text("telegram_avatar_url"),
  customAvatarUrl: text("custom_avatar_url"),
  avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true }),

  role: text().notNull().default("player"),
  isBlocked: boolean("is_blocked").notNull().default(false),

  acceptedTermsAt: timestamp("accepted_terms_at", { withTimezone: true }),
  acceptedTermsVersion: text("accepted_terms_version"),
  profileCompletedAt: timestamp("profile_completed_at", { withTimezone: true }),

  canAccessFree: boolean("can_access_free").notNull().default(true),
  canAccessPaid: boolean("can_access_paid").notNull().default(false),
  canAccessCash: boolean("can_access_cash").notNull().default(false),

  referralCount: integer("referral_count").notNull().default(0),
  freeReentriesBalance: integer("free_reentries_balance").notNull().default(0),
  yandexReviewBonusClaimed: boolean("yandex_review_bonus_claimed").notNull().default(false),

  // Account merge (ported from Sterling/spb-poker commit 770ce78d) -- set
  // once, atomically, by lib/player-merge.ts's executeMerge(). Never
  // deleted, never cleared: a player row is soft-merged in place, not
  // removed, so historical FKs elsewhere that still point at this row's id
  // keep resolving. Every identity-resolution entry point (getSessionPlayer
  // equivalent in features/auth-server.ts, lib/admin-auth.ts) must follow
  // this pointer via lib/canonical-player.ts::resolveCanonicalPlayer rather
  // than trusting a raw lookup -- see that module's doc comment for why.
  mergedIntoPlayerId: uuid("merged_into_player_id").references((): AnyPgColumn => players.id, { onDelete: "set null" }),
  mergedAt: timestamp("merged_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // 'operator' added for the on-site tournament-admin role -- existing
  // 'admin' rows are untouched by this change and keep meaning Super Admin
  // (unrestricted access), so widening this CHECK can never downgrade or
  // lock out an existing admin. See lib/roles.ts for the three-tier model.
  check("players_role_check", sql`${table.role} IN ('player', 'operator', 'admin')`),
  check("players_display_name_length", sql`char_length(${table.displayName}) BETWEEN 1 AND 100`),
  check(
    "players_pending_display_name_length",
    sql`${table.pendingDisplayName} IS NULL OR char_length(${table.pendingDisplayName}) BETWEEN 1 AND 100`,
  ),
  check(
    "players_admin_display_name_length",
    sql`${table.adminDisplayName} IS NULL OR char_length(${table.adminDisplayName}) BETWEEN 1 AND 100`,
  ),

  // Case-insensitive uniqueness matching features/auth.ts's normalizeEmail()
  // (lowercase before every insert/lookup). The old Supabase schema also
  // carried a second, non-partial `players_telegram_id_key` UNIQUE
  // constraint alongside a partial one on telegram_id — redundant, since a
  // plain UNIQUE already permits multiple NULLs. Collapsed here to the
  // single `.unique()` above; only email genuinely needs a partial index
  // (case-folding has no plain-UNIQUE equivalent).
  uniqueIndex("players_email_unique_idx").on(sql`lower(${table.email})`).where(sql`${table.email} IS NOT NULL`),

  index("players_role_idx").on(table.role),
  index("players_nickname_status_idx").on(table.nicknameStatus),

  index("players_merged_into_player_id_idx").on(table.mergedIntoPlayerId),
  check(
    "players_merged_into_not_self",
    sql`${table.mergedIntoPlayerId} IS NULL OR ${table.mergedIntoPlayerId} != ${table.id}`,
  ),
]);
