import { supabase } from "@/lib/supabase";
import type { Player } from "@/types/domain";
import type { PlayerRow } from "@/types/database";
import type { TelegramWebAppUser } from "@/lib/telegram";

function mapPlayerRowToDomain(row: PlayerRow): Player {
  return {
    id: row.id,
    telegram_id: row.telegram_id,
    username: row.username,
    display_name: row.display_name,
    role: row.role as "player" | "admin",
    accepted_terms_at: row.accepted_terms_at ?? undefined,
    accepted_terms_version: row.accepted_terms_version ?? undefined,
    profile_completed_at: row.profile_completed_at ?? undefined,
    nickname_status: (row.nickname_status as "approved" | "pending") ?? undefined,
    pending_display_name: row.pending_display_name ?? undefined,
    created_at: row.created_at,
  };
}

export async function getPlayerByTelegramId(
  telegramId: number
): Promise<Player | null> {
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

export async function getPlayerById(playerId: string): Promise<Player | null> {
  const { data, error } = await supabase
    .from("players")
    .select("*")
    .eq("id", playerId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch player: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapPlayerRowToDomain(data as PlayerRow);
}

export async function createPlayerFromTelegramUser(
  telegramUser: TelegramWebAppUser
): Promise<Player> {
  const displayName =
    telegramUser.username ||
    [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(" ") ||
    `Player ${telegramUser.id}`;

  const { data, error } = await supabase
    .from("players")
    .insert({
      telegram_id: telegramUser.id,
      username: telegramUser.username ?? null,
      display_name: displayName,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create player: ${error.message}`);
  }

  return mapPlayerRowToDomain(data as PlayerRow);
}

export async function ensurePlayerFromTelegramUser(
  telegramUser: TelegramWebAppUser
): Promise<Player> {
  const existingPlayer = await getPlayerByTelegramId(telegramUser.id);

  if (existingPlayer) {
    return existingPlayer;
  }

  return createPlayerFromTelegramUser(telegramUser);
}

export const TERMS_VERSION = "v1";

export async function acceptTerms(playerId: string): Promise<Player> {
  const { data, error } = await supabase
    .from("players")
    .update({
      accepted_terms_at: new Date().toISOString(),
      accepted_terms_version: TERMS_VERSION,
    })
    .eq("id", playerId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to accept terms: ${error.message}`);
  }

  return mapPlayerRowToDomain(data as PlayerRow);
}

export async function isDisplayNameTaken(
  displayName: string,
  currentPlayerId: string
): Promise<boolean> {
  const normalizedDisplayName = displayName.trim();

  const { data, error } = await supabase
    .from("players")
    .select("id, display_name, pending_display_name")
    .neq("id", currentPlayerId);

  if (error) {
    throw new Error(`Failed to check display name: ${error.message}`);
  }

  return (data ?? []).some((player: any) => {
    const currentDisplayName = (player.display_name ?? "").trim().toLowerCase();
    const pendingDisplayName = (player.pending_display_name ?? "").trim().toLowerCase();

    return (
      currentDisplayName === normalizedDisplayName.toLowerCase() ||
      pendingDisplayName === normalizedDisplayName.toLowerCase()
    );
  });
}

export async function completeProfile(
  player: Player,
  nextDisplayName: string
): Promise<{
  player: Player;
  moderationRequired: boolean;
}> {
  const normalizedDisplayName = nextDisplayName.trim();

  if (!normalizedDisplayName) {
    throw new Error("Введите ник");
  }

  const baseDisplayName = player.display_name.trim();

  if (normalizedDisplayName.toLowerCase() !== baseDisplayName.toLowerCase()) {
    const isTaken = await isDisplayNameTaken(normalizedDisplayName, player.id);

    if (isTaken) {
      throw new Error("Данный ник уже занят");
    }

    const { data, error } = await supabase
      .from("players")
      .update({
        profile_completed_at: new Date().toISOString(),
        nickname_status: "pending",
        pending_display_name: normalizedDisplayName,
      })
      .eq("id", player.id)
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to complete profile: ${error.message}`);
    }

    return {
      player: mapPlayerRowToDomain(data as PlayerRow),
      moderationRequired: true,
    };
  }

  const { data, error } = await supabase
    .from("players")
    .update({
      profile_completed_at: new Date().toISOString(),
      nickname_status: "approved",
      pending_display_name: null,
    })
    .eq("id", player.id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to complete profile: ${error.message}`);
  }

  return {
    player: mapPlayerRowToDomain(data as PlayerRow),
    moderationRequired: false,
  };
}

// ==========================
// MODERATION: NICKNAMES
// ==========================

export async function getPendingNicknames(): Promise<Player[]> {
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

export async function approveNickname(playerId: string): Promise<Player> {
  // сначала получаем игрока
  const { data: currentPlayer, error: fetchError } = await supabase
    .from("players")
    .select("*")
    .eq("id", playerId)
    .single();

  if (fetchError) {
    throw new Error(`Failed to fetch player: ${fetchError.message}`);
  }

  const newDisplayName = currentPlayer.pending_display_name?.trim();

  if (!newDisplayName) {
    throw new Error("Нет ника на модерации");
  }

  // обновляем
  const { data, error } = await supabase
    .from("players")
    .update({
      display_name: newDisplayName,
      pending_display_name: null,
      nickname_status: "approved",
    })
    .eq("id", playerId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to approve nickname: ${error.message}`);
  }

  return mapPlayerRowToDomain(data as PlayerRow);
}

export async function rejectNickname(playerId: string): Promise<Player> {
  const { data, error } = await supabase
    .from("players")
    .update({
      pending_display_name: null,
      nickname_status: "approved",
    })
    .eq("id", playerId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to reject nickname: ${error.message}`);
  }

  return mapPlayerRowToDomain(data as PlayerRow);
}
