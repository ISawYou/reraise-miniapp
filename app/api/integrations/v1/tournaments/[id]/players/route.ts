import { NextResponse } from "next/server";
import { verifyIntegrationRequest } from "@/lib/integration-auth";
import { getArrivedPlayersForIntegration } from "@/features/tournaments";
import { TournamentNotFoundError } from "@/lib/tournament-errors";

// GET /api/integrations/v1/tournaments/:id/players
// Read-only, Bearer-auth. The main endpoint of the Poker Clock integration:
// returns only players currently marked "Пришёл" for this tournament (see
// features/tournaments.ts::getArrivedPlayersForIntegration and
// lib/db/schema/tournamentLiveState.ts's tournamentAttendance doc comment).
// Works while the tournament is still in progress -- does NOT require
// status='completed' and does NOT read registrations.status or
// results.arrived.
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!verifyIntegrationRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const players = await getArrivedPlayersForIntegration(id);
    return NextResponse.json({ players });
  } catch (error) {
    if (error instanceof TournamentNotFoundError) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
