import { NextResponse } from "next/server";
import { seasonRepository } from "@/lib/repositories";
import { getOfficialSeasonLeaderboardWithMovement } from "@/features/leaderboard";

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
    // exclusions, PLUS rank movement since the most recent completed
    // tournament of this season -- see features/leaderboard.ts. Excluded
    // players are returned separately (outOfCompetition), never with an
    // official rank, and never with a rankMovement field either -- "Вне
    // зачёта" rows have no official rank to move from/to. `rankMovement` is
    // additive on top of the exact same leaderboard entries this route
    // already returned -- no existing field removed/renamed.
    ({ leaderboard, outOfCompetition } = await getOfficialSeasonLeaderboardWithMovement(season.id));
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
