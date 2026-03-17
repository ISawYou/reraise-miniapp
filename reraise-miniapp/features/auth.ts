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