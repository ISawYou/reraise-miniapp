import { NextResponse } from "next/server";
import { getAllTimeLeaderboard } from "@/features/leaderboard";

// All-time standings -- cumulative raw historical rating_points across
// every completed result ever recorded, regardless of season. See
// features/leaderboard.ts::getAllTimeLeaderboard's doc comment: no
// recalculation, no season_rating_exclusions applied (season-specific
// "Вне зачёта" never erases all-time points).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const leaderboard = await getAllTimeLeaderboard();
    return NextResponse.json({ leaderboard });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
