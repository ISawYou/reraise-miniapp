import { NextResponse } from "next/server";
import { seasonRepository, resultRepository } from "@/lib/repositories";

export const revalidate = 60;

export async function GET() {
  const season = await seasonRepository.findActive();

  if (!season) {
    return NextResponse.json({ error: "Активный сезон не найден" }, { status: 404 });
  }

  let results;
  try {
    results = await resultRepository.findWithPlayerBySeasonId(season.id);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  const leaderboardMap = new Map<
    string,
    {
      player_id: string;
      username: string | null;
      display_name: string;
      telegram_avatar_url: string | null;
      custom_avatar_url: string | null;
      rating: number;
    }
  >();

  for (const row of results) {
    const existing = leaderboardMap.get(row.player_id);
    if (existing) {
      existing.rating += row.rating_points ?? 0;
    } else {
      leaderboardMap.set(row.player_id, {
        player_id: row.player_id,
        username: row.username,
        display_name: row.display_name,
        telegram_avatar_url: row.telegram_avatar_url,
        custom_avatar_url: row.custom_avatar_url,
        rating: row.rating_points ?? 0,
      });
    }
  }

  const leaderboard = Array.from(leaderboardMap.values()).sort(
    (a, b) => b.rating - a.rating
  );

  return NextResponse.json({ season: { id: season.id, title: season.title }, leaderboard });
}
