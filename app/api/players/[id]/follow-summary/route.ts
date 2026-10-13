import { NextResponse } from "next/server";
import { getFollowSummary } from "@/features/follows";
import { resolveFollowViewer } from "@/lib/follows-auth";
import { followsErrorResponse } from "@/lib/follows-error-response";
import type { Player } from "@/types/domain";

export const dynamic = "force-dynamic";

// GET /api/players/[id]/follow-summary -- counts are public; auth is OPTIONAL
// and only decides `isFollowing` (false for anonymous viewers and on one's own
// profile). Each field degrades to null independently.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;

    let viewer: Player | null = null;
    let viewerUnresolved = false;
    try {
      viewer = await resolveFollowViewer();
    } catch (error) {
      // Identity lookup failed (e.g. DB hiccup): the counts are still public,
      // but we cannot honestly say whether this viewer follows the player.
      console.error("[GET /api/players/[id]/follow-summary] viewer resolution failed:", error);
      viewerUnresolved = true;
    }

    const summary = await getFollowSummary(id, viewer);
    return NextResponse.json(viewerUnresolved ? { ...summary, isFollowing: null } : summary);
  } catch (error) {
    return followsErrorResponse(error, "Не удалось загрузить данные подписок. Попробуйте ещё раз.");
  }
}
