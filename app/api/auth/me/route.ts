import { type NextRequest, NextResponse } from "next/server";
import { getPlayerByIdServer } from "@/features/auth-server";
import { verifySession, COOKIE_NAME } from "@/lib/telegram-web-session";
import { resolveCanonicalPlayer } from "@/lib/canonical-player";

export async function GET(request: NextRequest) {
  const cookieValue = request.cookies.get(COOKIE_NAME)?.value;

  if (!cookieValue) {
    return NextResponse.json({ error: "No session" }, { status: 401 });
  }

  const playerId = verifySession(cookieValue);

  if (!playerId) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  try {
    // A still-validly-signed cookie for a player that was later soft-merged
    // into another one (lib/player-merge.ts -- self-service or Super-Admin
    // merge) must resolve to the surviving account, never the merged-away
    // row: this endpoint is the web session bootstrap
    // (lib/current-player.ts), so returning the raw row would make the whole
    // client act as the dead account. Fails closed on a corrupted chain
    // (see lib/canonical-player.ts). is_blocked handling is unchanged.
    const player = await resolveCanonicalPlayer(await getPlayerByIdServer(playerId));

    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    return NextResponse.json({ player });
  } catch {
    return NextResponse.json({ error: "Failed to load player" }, { status: 500 });
  }
}
