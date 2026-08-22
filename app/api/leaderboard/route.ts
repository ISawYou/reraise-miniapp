import { NextResponse } from "next/server";
import { seasonRepository } from "@/lib/repositories";
import { getSeasonLeaderboard } from "@/features/leaderboard";

// Always run at request time -- never statically generated. `revalidate`
// used to make Next.js execute this handler during `next build` itself (to
// produce the initial cached snapshot), which meant every Docker build
// needed a live, reachable database and a real SUPABASE_SERVICE_ROLE_KEY
// just to compile the image -- the same fix already applied to spb-poker's
// identical route. A route this cheap doesn't need build-time caching to
// justify that cost.
export const dynamic = "force-dynamic";

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
