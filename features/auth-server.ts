import "server-only";

import { getSupabaseServer } from "@/lib/supabase-server";
import type { Player } from "@/types/domain";
import type { PlayerRow } from "@/types/database";

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
    role: row.role as "player" | "admin",
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
    created_at: row.created_at,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getPlayerByIdServer(playerId: string): Promise<Player | null> {
  const supabaseServer = getSupabaseServer();
  const { data, error } = await supabaseServer
    .from("players")
    .select("*")
    .eq("id", playerId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch player by id: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapPlayerRowToDomain(data as PlayerRow);
}

export async function getPlayerByEmailServer(email: string): Promise<Player | null> {
  const normalized = normalizeEmail(email);
  const supabaseServer = getSupabaseServer();
  const { data, error } = await supabaseServer
    .from("players")
    .select("*")
    .eq("email", normalized)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch player by email: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapPlayerRowToDomain(data as PlayerRow);
}

export async function ensurePlayerFromEmailServer(email: string): Promise<Player> {
  const normalized = normalizeEmail(email);
  const existing = await getPlayerByEmailServer(normalized);

  if (existing) {
    return existing;
  }

  const localPart = normalized.split("@")[0] ?? "player";
  const displayName =
    localPart.replace(/[^a-zA-Zа-яА-ЯёЁ0-9]/g, "") || "Игрок";

  const supabaseServer = getSupabaseServer();
  const { data, error } = await supabaseServer
    .from("players")
    .insert({
      email: normalized,
      display_name: displayName,
      telegram_id: null,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create player from email: ${error.message}`);
  }

  return mapPlayerRowToDomain(data as PlayerRow);
}

export async function linkEmailToPlayerServer(
  playerId: string,
  email: string
): Promise<Player> {
  const normalized = normalizeEmail(email);
  const existing = await getPlayerByEmailServer(normalized);

  if (existing && existing.id !== playerId) {
    throw new Error("Этот email уже привязан к другому игроку");
  }

  const supabaseServer = getSupabaseServer();
  const { data, error } = await supabaseServer
    .from("players")
    .update({ email: normalized })
    .eq("id", playerId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to link email to player: ${error.message}`);
  }

  return mapPlayerRowToDomain(data as PlayerRow);
}
