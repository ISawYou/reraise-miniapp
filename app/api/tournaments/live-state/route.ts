import { NextResponse } from "next/server";
import { getPokerClockLiveState } from "@/lib/poker-clock-client";
import { getArrivedPlayersForIntegration } from "@/features/tournaments";
import { getTournamentStateForIntegration } from "@/features/late-registration";
import type { TournamentLiveSummary } from "@/types/poker-clock-live-state";

// Browser-facing home page endpoint -- the browser must never call Poker
// Clock's internal URL or see POKER_CLOCK_LIVE_STATE_TOKEN directly (see
// lib/poker-clock-client.ts). This route is the only bridge, and it never
// forwards Poker Clock's raw response: every field is re-derived from
// validated data or Re-Raise's own repositories.
export const dynamic = "force-dynamic";

const MAX_IDS_PER_REQUEST = 20;

async function buildLiveSummary(tournamentId: string): Promise<TournamentLiveSummary> {
  const clock = await getPokerClockLiveState(tournamentId).catch(() => null);
  const isLive = clock?.status === "running" || clock?.status === "paused";

  const [lateRegistration, attendance] = await Promise.all([
    // Only free/rating tournaments have a late-registration concept --
    // getTournamentStateForIntegration throws for everything else (see
    // features/late-registration.ts's assertFreeTournament). That, a
    // missing tournament, or any other lookup failure all collapse to
    // `null` here: "not applicable / unknown", never "open".
    getTournamentStateForIntegration(tournamentId)
      .then((state) => state.lateRegistration)
      .catch(() => null),
    // Player counts come straight from Re-Raise's own existing aggregate
    // (features/tournaments.ts, already used by the Poker Clock ->
    // Re-Raise players endpoint) -- no second counting mechanism. Only
    // computed while the clock reports the tournament as actually running,
    // to avoid the extra DB work on every poll of a pre-start card.
    isLive
      ? getArrivedPlayersForIntegration(tournamentId)
          .then((players) => ({
            arrived: players.length,
            active: players.filter((player) => !player.eliminated).length,
          }))
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  return { clock, attendance, lateRegistration };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawIds = searchParams.get("ids") ?? "";

  const ids = Array.from(
    new Set(
      rawIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    )
  ).slice(0, MAX_IDS_PER_REQUEST);

  if (ids.length === 0) {
    return NextResponse.json({ results: {} });
  }

  const entries = await Promise.all(
    ids.map(async (id) => [id, await buildLiveSummary(id)] as const)
  );

  return NextResponse.json({
    results: Object.fromEntries(entries) as Record<string, TournamentLiveSummary>,
  });
}
