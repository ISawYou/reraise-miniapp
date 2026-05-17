import { supabase } from "@/lib/supabase";
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
    created_at: row.created_at,
  };
}

export async function getPlayersForAccessManagement(): Promise<Player[]> {
  const { data, error } = await supabase
    .from("players")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Ошибка загрузки игроков: ${error.message}`);
  }

  return (data ?? []).map((row) => mapPlayerRowToDomain(row as PlayerRow));
}

export async function getPlayersForNicknameDirectory(): Promise<Player[]> {
  const { data, error } = await supabase
    .from("players")
    .select("*")
    .order("display_name", { ascending: true });

  if (error) {
    throw new Error(`Ошибка загрузки игроков: ${error.message}`);
  }

  return (data ?? []).map((row) => mapPlayerRowToDomain(row as PlayerRow));
}

export async function updatePlayerAdminDisplayName(
  playerId: string,
  adminDisplayName: string | null
): Promise<Player> {
  const normalizedDisplayName = adminDisplayName?.trim() ?? "";

  const { data, error } = await supabase
    .from("players")
    .update({
      admin_display_name: normalizedDisplayName || null,
    })
    .eq("id", playerId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Ошибка обновления админского ника: ${error.message}`);
  }

  return mapPlayerRowToDomain(data as PlayerRow);
}

export async function deleteManualPlayer(playerId: string): Promise<void> {
  const { data: player, error: fetchError } = await supabase
    .from("players")
    .select("id")
    .eq("id", playerId)
    .single();

  if (fetchError || !player) throw new Error("Игрок не найден");

  const { error: liveEntriesError } = await supabase
    .from("tournament_live_entries")
    .delete()
    .eq("player_id", playerId);
  if (liveEntriesError) {
    throw new Error(`Ошибка удаления live-записей: ${liveEntriesError.message}`);
  }

  const { error: achievementsError } = await supabase
    .from("player_achievements")
    .delete()
    .eq("player_id", playerId);
  if (achievementsError) {
    throw new Error(`Ошибка удаления достижений: ${achievementsError.message}`);
  }

  const { error: resultsError } = await supabase
    .from("results")
    .delete()
    .eq("player_id", playerId);
  if (resultsError) {
    throw new Error(`Ошибка удаления results: ${resultsError.message}`);
  }

  const { error: registrationsError } = await supabase
    .from("registrations")
    .delete()
    .eq("player_id", playerId);
  if (registrationsError) {
    throw new Error(`Ошибка удаления registrations: ${registrationsError.message}`);
  }

  const { error } = await supabase.from("players").delete().eq("id", playerId);
  if (error) throw new Error(`Ошибка удаления: ${error.message}`);
}

export async function updatePlayerTournamentAccess(
  playerId: string,
  input: {
    can_access_free?: boolean;
    can_access_paid?: boolean;
    can_access_cash?: boolean;
  }
): Promise<Player> {
  const payload: {
    can_access_free?: boolean;
    can_access_paid?: boolean;
    can_access_cash?: boolean;
  } = {};

  if (typeof input.can_access_free === "boolean") {
    payload.can_access_free = input.can_access_free;
  }

  if (typeof input.can_access_paid === "boolean") {
    payload.can_access_paid = input.can_access_paid;
  }

  if (typeof input.can_access_cash === "boolean") {
    payload.can_access_cash = input.can_access_cash;
  }

  const { data, error } = await supabase
    .from("players")
    .update(payload)
    .eq("id", playerId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Ошибка обновления доступа: ${error.message}`);
  }

  return mapPlayerRowToDomain(data as PlayerRow);
}
