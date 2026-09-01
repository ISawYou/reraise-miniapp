import { NextResponse } from "next/server";
import { getOfficialSeasonLeaderboard } from "@/features/leaderboard";
import { listSeasonsPublic } from "@/features/seasons";

// Archived-season standings -- reuses getOfficialSeasonLeaderboard
// unchanged (the exact same official-rank/OOC calculation the current
// leaderboard and season finalization use), just for a specified season id
// instead of the active one. Season-specific "Вне зачёта" still applies to
// that season. Public payload: id/title only, never start_date/end_date
// (see features/seasons.ts::PublicSeason).
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ seasonId: string }> }
) {
  const { seasonId } = await context.params;

  try {
    const [seasons, { leaderboard, outOfCompetition }] = await Promise.all([
      listSeasonsPublic(),
      getOfficialSeasonLeaderboard(seasonId),
    ]);

    const season = seasons.find((s) => s.id === seasonId);

    if (!season) {
      return NextResponse.json({ error: "Сезон не найден" }, { status: 404 });
    }

    return NextResponse.json({ season, leaderboard, outOfCompetition });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
