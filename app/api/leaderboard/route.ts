import { NextResponse } from "next/server";
import { seasonRepository } from "@/lib/repositories";
import { getSeasonLeaderboard } from "@/features/leaderboard";

export const revalidate = 60;

export async function GET() {
  const season = await seasonRepository.findActive();

  if (!season) {
    return NextResponse.json({ error: "Активный сезон не найден" }, { status: 404 });
  }

  let leaderboard;
  try {
    leaderboard = await getSeasonLeaderboard(season.id);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  return NextResponse.json({ season: { id: season.id, title: season.title }, leaderboard });
}
