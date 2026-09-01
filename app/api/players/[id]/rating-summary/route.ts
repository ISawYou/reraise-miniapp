import { NextResponse } from "next/server";
import { getPlayerRatingSummary } from "@/features/leaderboard";

// Public, unauthenticated read -- same pattern as
// /api/players/[id]/achievements (a profile, own or someone else's, is
// already publicly viewable by player id). Player-safe payload only: no
// season start_date/end_date, no PII beyond what the profile already
// shows. See features/leaderboard.ts::getPlayerRatingSummary.
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  try {
    const summary = await getPlayerRatingSummary(id);
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить рейтинг игрока" },
      { status: 500 }
    );
  }
}
