import { NextResponse } from "next/server";
import { acceptInvitation } from "@/features/teams";
import { resolveTeamsActor } from "@/lib/teams-auth";
import { teamsErrorResponse } from "@/lib/teams-error-response";

export const dynamic = "force-dynamic";

// POST /api/teams/invitations/[invitationId]/accept -- the invited
// player's own action.
export async function POST(_request: Request, context: { params: Promise<{ invitationId: string }> }) {
  try {
    const actor = await resolveTeamsActor();
    if (!actor) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }

    const { invitationId } = await context.params;
    const team = await acceptInvitation(actor.id, invitationId);
    return NextResponse.json({ team });
  } catch (error) {
    return teamsErrorResponse(error);
  }
}
