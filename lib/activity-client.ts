// Client-side activity logging — fire-and-forget, never throws

import { getTelegramInitData } from "@/lib/telegram";

const onceFiredInSession = new Set<string>();

function getSessionId(): string {
  try {
    const key = "reraise.session_id";
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

function getPlatform(): string {
  try {
    if (typeof window === "undefined") return "unknown";
    const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram;
    if (tg?.WebApp?.initData) return "telegram";
    return "web";
  } catch {
    return "unknown";
  }
}

// Purely a "has this tab established an identity yet" gate, to avoid firing
// analytics before login -- NOT an identity/security mechanism. The server
// (app/api/activity/route.ts) never reads or trusts this value; it derives
// the real player id itself from the verified session/header on every
// request, so this cached id being stale (e.g. after an account merge, or
// just wrong) has no effect on whose id an event gets logged under.
export function setActivityPlayerId(id: string): void {
  try {
    sessionStorage.setItem("reraise.activity.player_id", id);
  } catch {}
}

function hasEstablishedIdentity(): boolean {
  try {
    return sessionStorage.getItem("reraise.activity.player_id") !== null;
  } catch {
    return false;
  }
}

export function logEvent(
  event_type: string,
  options?: {
    event_label?: string;
    metadata?: Record<string, unknown>;
    once?: boolean;
  }
): void {
  if (options?.once) {
    if (onceFiredInSession.has(event_type)) return;
    onceFiredInSession.add(event_type);
  }

  // Skip firing before login -- the server would no-op an unauthenticated
  // call anyway (see app/api/activity/route.ts), this just avoids the
  // pointless request. Not a security check.
  if (!hasEstablishedIdentity()) return;

  const session_id = getSessionId();
  const platform = getPlatform();

  // Fire-and-forget, but the server needs *some* proof of identity to
  // attribute the event to anyone at all: the reraise_session cookie covers
  // email-authenticated sessions, but a Telegram Mini App user typically has
  // no session cookie at all (see lib/current-player.ts's
  // resolveCurrentPlayer(), which resolves identity via the Telegram
  // WebApp SDK directly, not a cookie) -- so this attaches the same
  // x-telegram-init-data header every admin request already does
  // (lib/client-request.ts), letting the server verify identity itself
  // instead of trusting anything from this module.
  void getTelegramInitData().then((initData) => {
    fetch("/api/activity", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(initData ? { "x-telegram-init-data": initData } : {}),
      },
      credentials: "include",
      body: JSON.stringify({
        // No player_id -- the server derives identity from the session
        // cookie/header itself (see app/api/activity/route.ts). Never send
        // an identity claim the server would have to trust.
        event_type,
        event_label: options?.event_label ?? null,
        metadata: options?.metadata ?? null,
        platform,
        session_id,
      }),
    }).catch(() => {});
  });
}
