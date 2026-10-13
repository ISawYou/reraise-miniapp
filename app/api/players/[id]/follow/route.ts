import { NextResponse } from "next/server";
import { followPlayer, unfollowPlayer } from "@/features/follows";
import { assertFollowMutationOrigin, requireFollowViewer } from "@/lib/follows-auth";
import { followsErrorResponse } from "@/lib/follows-error-response";

export const dynamic = "force-dynamic";

// POST /api/players/[id]/follow -- the follower is ALWAYS the authenticated
// viewer (Telegram initData header or signed session cookie, resolved
// server-side by lib/follows-auth.ts). The request body and query string are
// never read, so nothing the client sends can name or override the follower.
// Idempotent: following an already-followed player is a plain 200.
//
// CSRF: both mutations first run the Origin gate (lib/request-origin.ts via
// assertFollowMutationOrigin) BEFORE anything is authenticated or written --
// a cross-origin request is a 403, and a request without same-origin evidence
// may only authenticate with a verified initData header, never the cookie.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireFollowViewer(assertFollowMutationOrigin(request));
    const { id } = await context.params;
    return NextResponse.json(await followPlayer(viewer, id));
  } catch (error) {
    return followsErrorResponse(error, "Не удалось подписаться. Попробуйте ещё раз.");
  }
}

// DELETE /api/players/[id]/follow -- idempotent: a missing edge is a 200.
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireFollowViewer(assertFollowMutationOrigin(request));
    const { id } = await context.params;
    return NextResponse.json(await unfollowPlayer(viewer, id));
  } catch (error) {
    return followsErrorResponse(error, "Не удалось отписаться. Попробуйте ещё раз.");
  }
}
