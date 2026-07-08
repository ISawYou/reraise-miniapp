import { ensurePlayerFromTelegramUser } from "@/features/auth";
import { getTelegramUser } from "@/lib/telegram";
import type { Player } from "@/types/domain";

let _cachedPlayer: Player | null = null;
let _inflight: Promise<Player> | null = null;

export async function resolveCurrentPlayer(): Promise<Player> {
  if (_cachedPlayer) return _cachedPlayer;
  if (_inflight) return _inflight;

  _inflight = (async () => {
    const telegramUser = getTelegramUser();
    let player: Player;

    if (telegramUser) {
      player = await ensurePlayerFromTelegramUser(telegramUser);
    } else {
      const response = await fetch("/api/auth/me", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Необходимо войти в систему");
      }
      const payload = (await response.json()) as { player: Player };
      player = payload.player;
    }

    _cachedPlayer = player;
    _inflight = null;
    return player;
  })();

  return _inflight;
}

export function invalidateCurrentPlayerCache(): void {
  _cachedPlayer = null;
  _inflight = null;
}
