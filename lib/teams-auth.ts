import "server-only";

import { resolveCurrentServerActor } from "@/lib/admin-auth";
import type { Player } from "@/types/domain";

// THE one entry point every Teams API route uses to find out who is
// calling -- never a client-supplied playerId. resolveCurrentServerActor()
// (lib/admin-auth.ts) already resolves BOTH the Telegram Mini App identity
// (HMAC-verified `X-Telegram-Init-Data`) and the email/OTP web session
// cookie, and already follows a soft account merge to the canonical player
// (lib/canonical-player.ts) -- the same strength of identity resolution
// /api/dealer/me uses for its own player-facing self-service surface. This
// wrapper adds the one thing that resolver doesn't itself check: a blocked
// player must never be able to create, join, or manage a team, even with a
// technically-valid identity.
export async function resolveTeamsActor(): Promise<Player | null> {
  const actor = await resolveCurrentServerActor();
  if (!actor) {
    return null;
  }
  if (actor.is_blocked) {
    return null;
  }
  return actor;
}
