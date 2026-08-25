import { NextResponse } from "next/server";
import { verifyIntegrationRequest } from "@/lib/integration-auth";
import { getIntegrationTournamentList } from "@/features/tournaments";

// GET /api/integrations/v1/tournaments
// Read-only, Bearer-auth. Feeds the Poker Clock "link a tournament"
// dropdown -- open tournaments only (see getIntegrationTournamentList's doc
// comment for why completed tournaments were deliberately dropped from
// this list). An already-linked tournament that later completes keeps
// working via GET .../tournaments/:id/players, which is unaffected by this
// endpoint's status filtering.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyIntegrationRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tournaments = await getIntegrationTournamentList();

  return NextResponse.json({ tournaments });
}
