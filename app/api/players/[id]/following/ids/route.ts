import { NextResponse } from "next/server";
import { listFollowingIds } from "@/features/follows";
import { followsErrorResponse } from "@/lib/follows-error-response";

export const dynamic = "force-dynamic";

// GET /api/players/[id]/following/ids -- public. EVERY followed player id,
// deliberately without the 1..100 page cap of the list routes: the season
// leaderboard's "Подписки" filter must never silently drop follows.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ ids: await listFollowingIds(id) });
  } catch (error) {
    return followsErrorResponse(error, "Не удалось загрузить список. Попробуйте ещё раз.");
  }
}
