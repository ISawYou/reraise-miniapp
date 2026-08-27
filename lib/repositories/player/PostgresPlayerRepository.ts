import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { players } from "@/lib/db/schema";
import type { Player, PlayerRole } from "@/types/domain";
import type {
  PlayerRepository,
  PlayerInsert,
  PlayerPatch,
  PlayerActivitySummary,
  DisplayNameCandidate,
  AccessRecipient,
  ReferralFields,
} from "./PlayerRepository";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function mapRowToPlayer(row: typeof players.$inferSelect): Player {
  return {
    id: row.id,
    telegram_id: row.telegramId,
    email: row.email ?? undefined,
    username: row.username,
    display_name: row.displayName,
    admin_display_name: row.adminDisplayName ?? undefined,
    telegram_avatar_url: row.telegramAvatarUrl ?? undefined,
    custom_avatar_url: row.customAvatarUrl ?? undefined,
    avatar_updated_at: row.avatarUpdatedAt ? row.avatarUpdatedAt.toISOString() : undefined,
    role: row.role as PlayerRole,
    is_blocked: row.isBlocked,
    accepted_terms_at: row.acceptedTermsAt ? row.acceptedTermsAt.toISOString() : undefined,
    accepted_terms_version: row.acceptedTermsVersion ?? undefined,
    profile_completed_at: row.profileCompletedAt ? row.profileCompletedAt.toISOString() : undefined,
    nickname_status: (row.nicknameStatus as "approved" | "pending") ?? undefined,
    pending_display_name: row.pendingDisplayName ?? undefined,
    can_access_free: row.canAccessFree,
    can_access_paid: row.canAccessPaid,
    can_access_cash: row.canAccessCash,
    referral_count: row.referralCount,
    free_reentries_balance: row.freeReentriesBalance,
    yandex_review_bonus_claimed: row.yandexReviewBonusClaimed,
    created_at: row.createdAt.toISOString(),
  };
}

// PlayerInsert/PlayerPatch are both Partial<PlayerRow> (snake_case, ISO
// strings) -- this maps only the keys actually present, so create()'s
// omitted columns still get their table defaults and update()'s patch
// semantics stay partial, exactly like the Supabase implementation's plain
// `.insert(data)` / `.update(patch)` passthrough.
function toColumnValues(data: PlayerInsert | PlayerPatch): Partial<typeof players.$inferInsert> {
  const values: Partial<typeof players.$inferInsert> = {};
  if (data.id !== undefined) values.id = data.id;
  if (data.telegram_id !== undefined) values.telegramId = data.telegram_id;
  if (data.email !== undefined) values.email = data.email;
  if (data.username !== undefined) values.username = data.username;
  if (data.display_name !== undefined) values.displayName = data.display_name;
  if (data.admin_display_name !== undefined) values.adminDisplayName = data.admin_display_name;
  if (data.pending_display_name !== undefined) values.pendingDisplayName = data.pending_display_name;
  if (data.nickname_status !== undefined) values.nicknameStatus = data.nickname_status;
  if (data.telegram_avatar_url !== undefined) values.telegramAvatarUrl = data.telegram_avatar_url;
  if (data.custom_avatar_url !== undefined) values.customAvatarUrl = data.custom_avatar_url;
  if (data.avatar_updated_at !== undefined) {
    values.avatarUpdatedAt = data.avatar_updated_at ? new Date(data.avatar_updated_at) : null;
  }
  if (data.role !== undefined) values.role = data.role;
  if (data.is_blocked !== undefined) values.isBlocked = data.is_blocked;
  if (data.accepted_terms_at !== undefined) {
    values.acceptedTermsAt = data.accepted_terms_at ? new Date(data.accepted_terms_at) : null;
  }
  if (data.accepted_terms_version !== undefined) values.acceptedTermsVersion = data.accepted_terms_version;
  if (data.profile_completed_at !== undefined) {
    values.profileCompletedAt = data.profile_completed_at ? new Date(data.profile_completed_at) : null;
  }
  if (data.can_access_free !== undefined) values.canAccessFree = data.can_access_free;
  if (data.can_access_paid !== undefined) values.canAccessPaid = data.can_access_paid;
  if (data.can_access_cash !== undefined) values.canAccessCash = data.can_access_cash;
  if (data.referral_count !== undefined) values.referralCount = data.referral_count;
  if (data.free_reentries_balance !== undefined) values.freeReentriesBalance = data.free_reentries_balance;
  if (data.yandex_review_bonus_claimed !== undefined) {
    values.yandexReviewBonusClaimed = data.yandex_review_bonus_claimed;
  }
  if (data.created_at !== undefined) values.createdAt = new Date(data.created_at);
  return values;
}

const ACCESS_COLUMNS = {
  can_access_free: players.canAccessFree,
  can_access_paid: players.canAccessPaid,
  can_access_cash: players.canAccessCash,
} as const;

// Drizzle/Postgres counterpart of SupabasePlayerRepository -- same
// contract, no new behavior. Same compensations as every other domain:
// `.limit(1)` + array-destructure standing in for `.maybeSingle()`,
// timestamp columns converted to ISO strings, and errors either left to
// propagate with Drizzle's own bare message (matching Supabase's
// `throw new Error(error.message)` call sites) or wrapped with the same
// fixed prefix the Supabase implementation uses (delete()).
export class PostgresPlayerRepository implements PlayerRepository {
  async findById(playerId: string): Promise<Player | null> {
    const rows = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
    const [row] = rows;
    return row ? mapRowToPlayer(row) : null;
  }

  async findByIdOrThrow(playerId: string): Promise<Player> {
    const rows = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to fetch player: no rows returned");
    }
    return mapRowToPlayer(row);
  }

  async findByTelegramId(telegramId: number): Promise<Player | null> {
    const rows = await db.select().from(players).where(eq(players.telegramId, telegramId)).limit(1);
    const [row] = rows;
    return row ? mapRowToPlayer(row) : null;
  }

  async findByEmail(email: string): Promise<Player | null> {
    const rows = await db.select().from(players).where(eq(players.email, email)).limit(1);
    const [row] = rows;
    return row ? mapRowToPlayer(row) : null;
  }

  async findRoleById(playerId: string): Promise<{ id: string; role: string } | null> {
    const rows = await db
      .select({ id: players.id, role: players.role })
      .from(players)
      .where(eq(players.id, playerId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findSummariesByIds(playerIds: string[]): Promise<PlayerActivitySummary[]> {
    if (playerIds.length === 0) {
      return [];
    }

    return db
      .select({
        id: players.id,
        display_name: players.displayName,
        username: players.username,
        email: players.email,
        role: players.role,
      })
      .from(players)
      .where(inArray(players.id, playerIds));
  }

  async listOrderedByCreatedAtDesc(): Promise<Player[]> {
    try {
      const rows = await db.select().from(players).orderBy(desc(players.createdAt));
      return rows.map(mapRowToPlayer);
    } catch (err) {
      throw new Error(`Ошибка загрузки игроков: ${errorMessage(err)}`);
    }
  }

  async listOrderedByDisplayName(): Promise<Player[]> {
    try {
      const rows = await db.select().from(players).orderBy(asc(players.displayName));
      return rows.map(mapRowToPlayer);
    } catch (err) {
      throw new Error(`Ошибка загрузки игроков: ${errorMessage(err)}`);
    }
  }

  async listPendingNicknames(): Promise<Player[]> {
    try {
      const rows = await db
        .select()
        .from(players)
        .where(and(eq(players.nicknameStatus, "pending"), isNotNull(players.pendingDisplayName)))
        .orderBy(desc(players.createdAt));
      return rows.map(mapRowToPlayer);
    } catch (err) {
      throw new Error(`Failed to fetch pending nicknames: ${errorMessage(err)}`);
    }
  }

  async listDisplayNameCandidates(excludePlayerId: string): Promise<DisplayNameCandidate[]> {
    try {
      return await db
        .select({
          id: players.id,
          display_name: players.displayName,
          pending_display_name: players.pendingDisplayName,
        })
        .from(players)
        .where(ne(players.id, excludePlayerId));
    } catch (err) {
      throw new Error(`Failed to check display name: ${errorMessage(err)}`);
    }
  }

  async listByAccessColumn(
    column: "can_access_free" | "can_access_paid" | "can_access_cash"
  ): Promise<AccessRecipient[]> {
    return db
      .select({ id: players.id, telegram_id: players.telegramId, display_name: players.displayName })
      .from(players)
      .where(eq(ACCESS_COLUMNS[column], true));
  }

  async findReferralFieldsById(playerId: string): Promise<ReferralFields | null> {
    try {
      const rows = await db
        .select({
          referral_count: players.referralCount,
          free_reentries_balance: players.freeReentriesBalance,
          yandex_review_bonus_claimed: players.yandexReviewBonusClaimed,
        })
        .from(players)
        .where(eq(players.id, playerId))
        .limit(1);
      return rows[0] ?? null;
    } catch {
      return null;
    }
  }

  async create(data: PlayerInsert): Promise<Player> {
    const rows = await db.insert(players).values(toColumnValues(data) as typeof players.$inferInsert).returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to create player: no rows returned");
    }
    return mapRowToPlayer(row);
  }

  async update(playerId: string, patch: PlayerPatch): Promise<Player> {
    const rows = await db
      .update(players)
      .set(toColumnValues(patch))
      .where(eq(players.id, playerId))
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to update player: no rows returned");
    }
    return mapRowToPlayer(row);
  }

  async delete(playerId: string): Promise<void> {
    try {
      await db.delete(players).where(eq(players.id, playerId));
    } catch (err) {
      throw new Error(`Ошибка удаления: ${errorMessage(err)}`);
    }
  }
}
