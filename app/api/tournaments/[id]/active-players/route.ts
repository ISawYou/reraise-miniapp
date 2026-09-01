import { NextResponse } from "next/server";
import { getActiveTournamentPlayersForPublicView } from "@/features/tournaments";

// Player-facing "В игре" tab data. Reads the same authoritative
// attendance + elimination state as the Poker Clock integration, but only
// the feature layer's already-sanitized PublicActiveTournamentPlayer shape
// ever reaches the browser -- see
// features/tournaments.ts's getActiveTournamentPlayersForPublicView.
// Returns EVERY arrived player (active AND eliminated, each with
// `eliminated`/`place`) in one payload -- the tab splits it client-side
// into "В игре" / "Выбыли" off this single poll.
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const players = await getActiveTournamentPlayersForPublicView(id);
    return NextResponse.json({ players });
  } catch {
    // Unknown tournament id or a lookup failure -- collapse to an empty
    // list rather than surfacing an error, same resiliency philosophy as
    // /api/tournaments/live-state.
    return NextResponse.json({ players: [] });
  }
}
