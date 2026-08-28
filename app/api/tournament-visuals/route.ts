import { NextResponse } from "next/server";
import { getTournamentVisualConfigs } from "@/features/tournament-visuals";

// Without this, the route has no request-bound API calls and is eligible
// for static generation -- `next build` would execute it once and every
// client would keep getting that build-time response (including scale/
// offset/opacity saved in admin afterwards) until the next deploy, same
// class of bug already fixed on /api/leaderboard.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ visuals: await getTournamentVisualConfigs() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить оформление турниров" },
      { status: 500 },
    );
  }
}
