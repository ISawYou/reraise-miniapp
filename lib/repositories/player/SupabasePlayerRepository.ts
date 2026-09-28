import "server-only";

import { getSupabaseServer } from "@/lib/database";
import type { Player, PlayerRole } from "@/types/domain";
import type { PlayerRow } from "@/types/database";
import type {
  PlayerRepository,
  PlayerInsert,
  PlayerPatch,
  PlayerActivitySummary,
  DisplayNameCandidate,
  AccessRecipient,
  ReferralFields,
} from "./PlayerRepository";

// Moved here from features/auth.ts / features/auth-server.ts, where the
// exact same function was duplicated verbatim in both files.
function mapPlayerRowToDomain(row: PlayerRow): Player {
  return {
    id: row.id,
    telegram_id: row.telegram_id,
    email: row.email ?? undefined,
    username: row.username,
    display_name: row.display_name,
    admin_display_name: row.admin_display_name ?? undefined,
    telegram_avatar_url: row.telegram_avatar_url ?? undefined,
    custom_avatar_url: row.custom_avatar_url ?? undefined,
    avatar_updated_at: row.avatar_updated_at ?? undefined,
    // The Supabase-backed deployment's own `players_role_check` is NOT
    // updated by this app's Drizzle/Postgres migrations (separate
    // database, no migration tooling here -- same precedent as Dealer
    // Payroll V1 being Postgres-only). Writing role: 'operator' there will
    // fail at the DB constraint until that schema is separately widened;
    // this cast only keeps the shared PlayerRole type consistent for reads.
    role: row.role as PlayerRole,
    is_blocked: row.is_blocked,
    accepted_terms_at: row.accepted_terms_at ?? undefined,
    accepted_terms_version: row.accepted_terms_version ?? undefined,
    profile_completed_at: row.profile_completed_at ?? undefined,
    nickname_status: (row.nickname_status as "approved" | "pending") ?? undefined,
    pending_display_name: row.pending_display_name ?? undefined,
    can_access_free: row.can_access_free,
    can_access_paid: row.can_access_paid,
    can_access_cash: row.can_access_cash,
    referral_count: row.referral_count,
    free_reentries_balance: row.free_reentries_balance,
    yandex_review_bonus_claimed: row.yandex_review_bonus_claimed,
    // Defensive default, same reasoning as the players_role_check comment
    // above: this Supabase database only has the column once
    // sql/players_club_discount_percent.sql has been run against it
    // separately (no migration tooling here) -- undefined until then,
    // never treated as anything but "no discount".
    club_discount_percent: row.club_discount_percent ?? 0,
    created_at: row.created_at,
  };
}

// Current, active implementation — wraps the exact same Supabase queries
// that were previously spread across features/auth.ts,
// features/auth-server.ts, features/admin.ts, features/tournaments.ts,
// lib/avatar-sync.ts and a couple of API routes. No new behavior.
export class SupabasePlayerRepository implements PlayerRepository {
  async findById(playerId: string): Promise<Player | null> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("id", playerId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      return null;
    }

    return mapPlayerRowToDomain(data as PlayerRow);
  }

  async findByIds(playerIds: string[]): Promise<Player[]> {
    if (playerIds.length === 0) {
      return [];
    }
    const supabase = getSupabaseServer();
    const { data, error } = await supabase.from("players").select("*").in("id", playerIds);

    if (error) {
      throw new Error(error.message);
    }

    return ((data ?? []) as PlayerRow[]).map(mapPlayerRowToDomain);
  }

  async findByIdOrThrow(playerId: string): Promise<Player> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("id", playerId)
      .single();

    if (error) {
      throw new Error(`Failed to fetch player: ${error.message}`);
    }

    return mapPlayerRowToDomain(data as PlayerRow);
  }

  async findByTelegramId(telegramId: number): Promise<Player | null> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch player: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    return mapPlayerRowToDomain(data as PlayerRow);
  }

  // Case-insensitive, mirroring PostgresPlayerRepository's own findByEmail --
  // same reasoning: a plain .eq() would miss a row whose email isn't
  // already stored lowercase. ilike's %/_ wildcard chars are escaped first
  // so this stays an exact (case-insensitive) match, not a pattern search.
  async findByEmail(email: string): Promise<Player | null> {
    const supabase = getSupabaseServer();
    const escaped = email.replace(/[%_\\]/g, (char) => `\\${char}`);
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .ilike("email", escaped)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch player by email: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    return mapPlayerRowToDomain(data as PlayerRow);
  }

  async findRoleById(playerId: string): Promise<{ id: string; role: string } | null> {
    const supabase = getSupabaseServer();
    const { data } = await supabase
      .from("players")
      .select("id, role")
      .eq("id", playerId)
      .maybeSingle();

    return data ?? null;
  }

  async findSummariesByIds(playerIds: string[]): Promise<PlayerActivitySummary[]> {
    if (playerIds.length === 0) {
      return [];
    }

    const supabase = getSupabaseServer();
    const { data } = await supabase
      .from("players")
      .select("id, display_name, username, email, role")
      .in("id", playerIds);

    return (data ?? []) as PlayerActivitySummary[];
  }

  async findClubDiscountPercentsByIds(
    playerIds: string[]
  ): Promise<{ id: string; club_discount_percent: number }[]> {
    if (playerIds.length === 0) {
      return [];
    }

    const supabase = getSupabaseServer();
    const { data } = await supabase
      .from("players")
      .select("id, club_discount_percent")
      .in("id", playerIds);

    // Defensive default, same reasoning as mapPlayerRowToDomain above: 0
    // until sql/players_club_discount_percent.sql has been run against
    // this Supabase database.
    return ((data ?? []) as { id: string; club_discount_percent: number | null }[]).map((row) => ({
      id: row.id,
      club_discount_percent: row.club_discount_percent ?? 0,
    }));
  }

  async listOrderedByCreatedAtDesc(): Promise<Player[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Ошибка загрузки игроков: ${error.message}`);
    }

    return (data ?? []).map((row) => mapPlayerRowToDomain(row as PlayerRow));
  }

  async listOrderedByDisplayName(): Promise<Player[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .order("display_name", { ascending: true });

    if (error) {
      throw new Error(`Ошибка загрузки игроков: ${error.message}`);
    }

    return (data ?? []).map((row) => mapPlayerRowToDomain(row as PlayerRow));
  }

  async listPendingNicknames(): Promise<Player[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("nickname_status", "pending")
      .not("pending_display_name", "is", null)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch pending nicknames: ${error.message}`);
    }

    return (data ?? []).map((row) => mapPlayerRowToDomain(row as PlayerRow));
  }

  async listDisplayNameCandidates(excludePlayerId: string): Promise<DisplayNameCandidate[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("players")
      .select("id, display_name, pending_display_name")
      .neq("id", excludePlayerId);

    if (error) {
      throw new Error(`Failed to check display name: ${error.message}`);
    }

    return (data ?? []) as DisplayNameCandidate[];
  }

  async listByAccessColumn(
    column: "can_access_free" | "can_access_paid" | "can_access_cash"
  ): Promise<AccessRecipient[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("players")
      .select("id, telegram_id, display_name")
      .eq(column, true);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as AccessRecipient[];
  }

  async findReferralFieldsById(playerId: string): Promise<ReferralFields | null> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("players")
      .select("referral_count, free_reentries_balance, yandex_review_bonus_claimed")
      .eq("id", playerId)
      .single();

    if (error || !data) {
      return null;
    }

    return data as ReferralFields;
  }

  async create(data: PlayerInsert): Promise<Player> {
    const supabase = getSupabaseServer();
    const { data: row, error } = await supabase
      .from("players")
      .insert(data)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return mapPlayerRowToDomain(row as PlayerRow);
  }

  async update(playerId: string, patch: PlayerPatch): Promise<Player> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("players")
      .update(patch)
      .eq("id", playerId)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return mapPlayerRowToDomain(data as PlayerRow);
  }

  async delete(playerId: string): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase.from("players").delete().eq("id", playerId);

    if (error) {
      throw new Error(`Ошибка удаления: ${error.message}`);
    }
  }

  // Account merge (lib/player-merge.ts) is Postgres-only -- the Supabase
  // schema has no merged_into_player_id column at all, so no row can ever
  // be a merge source under this provider.
  async hasMergeSources(_playerId: string): Promise<boolean> {
    return false;
  }
}
