import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

export const revalidate = 60;

export async function GET() {
  const supabase = getSupabaseServer();

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, title")
    .eq("is_active", true)
    .limit(1)
    .single();

  if (seasonError || !season) {
    return NextResponse.json({ error: "Активный сезон не найден" }, { status: 404 });
  }

  const { data: results, error: resultsError } = await supabase
    .from("results")
    .select(`
      player_id,
      rating_points,
      players (
        username,
        display_name,
        telegram_avatar_url,
        custom_avatar_url
      )
    `)
    .eq("season_id", season.id);

  if (resultsError) {
    return NextResponse.json({ error: resultsError.message }, { status: 500 });
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

  for (const row of results ?? []) {
    const player = Array.isArray((row as any).players)
      ? (row as any).players[0]
      : (row as any).players;

    const existing = leaderboardMap.get(row.player_id);
    if (existing) {
      existing.rating += row.rating_points ?? 0;
    } else {
      leaderboardMap.set(row.player_id, {
        player_id: row.player_id,
        username: player?.username ?? null,
        display_name: player?.display_name ?? "Игрок",
        telegram_avatar_url: player?.telegram_avatar_url ?? null,
        custom_avatar_url: player?.custom_avatar_url ?? null,
        rating: row.rating_points ?? 0,
      });
    }
  }

  const leaderboard = Array.from(leaderboardMap.values()).sort(
    (a, b) => b.rating - a.rating
  );

  return NextResponse.json({ season: { id: season.id, title: season.title }, leaderboard });
}
