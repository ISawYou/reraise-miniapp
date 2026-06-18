// Client-side activity logging — fire-and-forget, never throws

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

export function setActivityPlayerId(id: string): void {
  try {
    sessionStorage.setItem("reraise.activity.player_id", id);
  } catch {}
}

function getActivityPlayerId(): string | null {
  try {
    return sessionStorage.getItem("reraise.activity.player_id");
  } catch {
    return null;
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

  const player_id = getActivityPlayerId();
  if (!player_id) return;

  const session_id = getSessionId();
  const platform = getPlatform();

  fetch("/api/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      player_id,
      event_type,
      event_label: options?.event_label ?? null,
      metadata: options?.metadata ?? null,
      platform,
      session_id,
    }),
  }).catch(() => {});
}
