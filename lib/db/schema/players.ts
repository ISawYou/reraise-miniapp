import { pgTable, uuid, text, bigint, boolean, integer, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Target schema per docs/POSTGRES_MIGRATION_AUDIT.md — not a 1:1 copy of the
// current Supabase table. Three columns are deliberately dropped:
// requires_prepayment, no_show_count, last_no_show_at — an unfinished
// "no-show" feature never wired to any app code (absent even from
// PlayerRow in types/database.ts; confirmed via pg_stats that all 173
// existing rows hold only the default value).
export const players = pgTable("players", {
  id: uuid().primaryKey().defaultRandom(),

  // Identity: either Telegram or email, never neither — see the
  // players_identity_present check below. Both stay nullable because
  // either origin can create a player without the other.
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

  acceptedTermsAt: timestamp("accepted_terms_at", { withTimezone: true }),
  acceptedTermsVersion: text("accepted_terms_version"),
  profileCompletedAt: timestamp("profile_completed_at", { withTimezone: true }),

  canAccessFree: boolean("can_access_free").notNull().default(true),
  canAccessPaid: boolean("can_access_paid").notNull().default(false),
  canAccessCash: boolean("can_access_cash").notNull().default(false),

  referralCount: integer("referral_count").notNull().default(0),
  freeReentriesBalance: integer("free_reentries_balance").notNull().default(0),
  yandexReviewBonusClaimed: boolean("yandex_review_bonus_claimed").notNull().default(false),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("players_role_check", sql`${table.role} IN ('player', 'admin')`),
  check("players_identity_present", sql`${table.telegramId} IS NOT NULL OR ${table.email} IS NOT NULL`),
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
]);
