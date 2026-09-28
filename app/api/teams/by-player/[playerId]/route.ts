import { NextResponse } from "next/server";
import { getPlayerActiveTeamSummary } from "@/features/teams";
import { teamsErrorResponse } from "@/lib/teams-error-response";

export const dynamic = "force-dynamic";

// GET /api/teams/by-player/[playerId] -- public. Player profile Team card
// (own AND public profiles) reads this; no auth needed, same public-ness
// as the rest of a player's profile page.
export async function GET(_request: Request, context: { params: Promise<{ playerId: string }> }) {
  try {
    const { playerId } = await context.params;
    const team = await getPlayerActiveTeamSummary(playerId);
    return NextResponse.json({ team });
  } catch (error) {
    return teamsErrorResponse(error);
  }
}
