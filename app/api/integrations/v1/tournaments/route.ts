import { NextResponse } from "next/server";
import { verifyIntegrationRequest } from "@/lib/integration-auth";
import { getIntegrationTournamentList } from "@/features/tournaments";

// GET /api/integrations/v1/tournaments
// Read-only, Bearer-auth. Feeds a future Poker Clock "link a tournament"
// dropdown -- open tournaments in full (naturally small/bounded) plus the
// most recently completed ones (bounded, see
// getIntegrationTournamentList's doc comment), never the club's full
// history.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyIntegrationRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tournaments = await getIntegrationTournamentList();

  return NextResponse.json({ tournaments });
}
