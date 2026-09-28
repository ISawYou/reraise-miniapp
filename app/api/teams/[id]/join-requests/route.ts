import { NextResponse } from "next/server";
import { requestToJoinTeam } from "@/features/teams";
import { resolveTeamsActor } from "@/lib/teams-auth";
import { teamsErrorResponse } from "@/lib/teams-error-response";

export const dynamic = "force-dynamic";

// POST /api/teams/[id]/join-requests -- the acting player's own request to
// join this team. See features/teams.ts::requestToJoinTeam for the full
// eligibility contract.
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveTeamsActor();
    if (!actor) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }

    const { id } = await context.params;
    await requestToJoinTeam(actor.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return teamsErrorResponse(error);
  }
}
