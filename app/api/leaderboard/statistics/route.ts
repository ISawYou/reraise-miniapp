import { NextResponse } from "next/server";
import { CLUB_STATISTIC_METRICS, getClubStatisticTop, type ClubStatisticMetric } from "@/features/club-statistics";

// Read-only, public (same access class as /api/leaderboard/all-time --
// no admin auth, no mutation). `metric` is validated against a fixed
// server-side allowlist (CLUB_STATISTIC_METRICS) -- never used to build
// arbitrary SQL, only as a switch key inside getClubStatisticTop.
const VALID_METRICS = new Set<string>(CLUB_STATISTIC_METRICS);

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const metric = new URL(request.url).searchParams.get("metric");

  if (!metric || !VALID_METRICS.has(metric)) {
    return NextResponse.json({ error: "Unknown metric" }, { status: 400 });
  }

  try {
    const topPlayers = await getClubStatisticTop(metric as ClubStatisticMetric);
    return NextResponse.json({ metric, topPlayers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить статистику" },
      { status: 500 }
    );
  }
}
