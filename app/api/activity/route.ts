import { type NextRequest, NextResponse } from "next/server";
import { logActivityEvent } from "@/lib/activity-logger";
import { resolveCurrentServerActor } from "@/lib/admin-auth";

// Identity for a logged event is NEVER taken from the request body. Before
// this fix, the client sent its own `player_id` (cached in sessionStorage,
// see lib/activity-client.ts) and this route trusted it outright -- so a
// stale post-merge browser tab would keep logging events under a
// merged-away source player's id even though every session-based auth path
// already resolves through lib/canonical-player.ts's fail-closed
// resolveCanonicalPlayer(). The only identity source here is the
// server-verified caller, resolved through the exact same dual
// header/cookie + canonical-resolution path every /api/admin/** route and
// Server Action guard already uses (lib/admin-auth.ts) -- so a stale
// session now logs under the canonical target, never the source, and no
// client-supplied id, real or forged, can log an event as anyone else, an
// admin, or a merged-away player. Mirrors Sterling/spb-poker's equivalent
// fix (commit 63394bf).
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const { event_type, event_label, metadata, platform, session_id } = body;

    if (!event_type || typeof event_type !== "string") return NextResponse.json({ ok: true });

    const player = await resolveCurrentServerActor();

    // No valid session/header -- there is currently no legitimate
    // anonymous/pre-login event (every real call site in
    // lib/activity-client.ts only fires once a player id has been cached
    // after a successful login), so this is either a forged/expired
    // request or a race before login finished. No-op rather than log
    // anything under a client-asserted identity.
    if (!player) return NextResponse.json({ ok: true });

    await logActivityEvent({
      player_id: player.id,
      event_type,
      event_label: typeof event_label === "string" ? event_label : undefined,
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : undefined,
      platform: typeof platform === "string" ? platform : "unknown",
      session_id: typeof session_id === "string" ? session_id : undefined,
      // Derived exclusively from the server-resolved canonical player --
      // never from anything the client sends -- so a non-admin session
      // (stale or otherwise) can never flip its own logged events to
      // admin-attributed ones.
      is_admin: player.role === "admin",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/activity] error:", err);
    return NextResponse.json({ ok: true });
  }
}
