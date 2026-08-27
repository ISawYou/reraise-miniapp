import { NextResponse } from "next/server";
import { seasonRepository } from "@/lib/repositories";
import { getOfficialSeasonLeaderboard } from "@/features/leaderboard";

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
  let outOfCompetition;
  try {
    // Official standings: raw rating totals minus "Вне зачёта" season
    // exclusions -- see features/leaderboard.ts. Excluded players are
    // returned separately (outOfCompetition), never with an official rank.
    ({ leaderboard, outOfCompetition } = await getOfficialSeasonLeaderboard(season.id));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  return NextResponse.json({
    season: { id: season.id, title: season.title },
    leaderboard,
    outOfCompetition,
  });
}
