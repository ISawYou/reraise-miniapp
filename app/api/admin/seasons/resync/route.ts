import { NextResponse } from "next/server";
import { resyncUpcomingTournamentSeasonAssignments } from "@/features/seasons";

// Season management -- Super-Admin-only, same gate as the rest of
// /api/admin/seasons/**. Idempotent: reconciles every NON-completed
// tournament's season_id against the current season configuration. See
// features/seasons.ts::resyncUpcomingTournamentSeasonAssignments -- never
// touches a completed tournament, results, or rating_points.
export async function POST() {
  try {
    const result = await resyncUpcomingTournamentSeasonAssignments();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось пересчитать сезоны турниров" },
      { status: 500 }
    );
  }
}
