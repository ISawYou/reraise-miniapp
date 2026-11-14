import { ensurePlayerFromTelegramUser } from "@/features/auth";
import { getTelegramUser, isTelegramMiniAppContext } from "@/lib/telegram";
import type { Player } from "@/types/domain";

let _cachedPlayer: Player | null = null;
let _inflight: Promise<Player> | null = null;
let _cacheGeneration = 0;

export const AUTH_STATE_CHANGED_EVENT = "reraise-auth-state-changed";

export function subscribeToAuthState(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  window.addEventListener(AUTH_STATE_CHANGED_EVENT, listener);
  return () => window.removeEventListener(AUTH_STATE_CHANGED_EVENT, listener);
}

export async function resolveCurrentPlayer(): Promise<Player> {
  if (_cachedPlayer) return _cachedPlayer;
  if (_inflight) return _inflight;

  const generation = ++_cacheGeneration;

  _inflight = (async () => {
    try {
      // A Telegram user cached in sessionStorage belongs to the Mini App
      // context only. Never let that cache silently authenticate a normal web
      // tab after the user has switched accounts or logged out.
      const telegramUser = isTelegramMiniAppContext() ? getTelegramUser() : null;
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

      if (_cacheGeneration === generation) {
        _cachedPlayer = player;
      }
      return player;
    } finally {
      // A rejected bootstrap must never poison the module-level promise and
      // make every later login attempt reuse the same failed request.
      if (_cacheGeneration === generation) {
        _inflight = null;
      }
    }
  })();

  return _inflight;
}

export function invalidateCurrentPlayerCache(): void {
  _cachedPlayer = null;
  _inflight = null;
  _cacheGeneration += 1;

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_STATE_CHANGED_EVENT));
  }
}
