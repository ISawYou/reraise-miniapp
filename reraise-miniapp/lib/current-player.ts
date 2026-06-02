import { ensurePlayerFromTelegramUser } from "@/features/auth";
import { getTelegramUser } from "@/lib/telegram";
import type { Player } from "@/types/domain";

export async function resolveCurrentPlayer(): Promise<Player> {
  const telegramUser = getTelegramUser();

  if (telegramUser) {
    return ensurePlayerFromTelegramUser(telegramUser);
  }

  const response = await fetch("/api/auth/me", {
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Необходимо войти в систему");
  }

  const payload = (await response.json()) as { player: Player };
  return payload.player;
}
