import { NextResponse } from "next/server";
import { declineInvitation } from "@/features/teams";
import { resolveTeamsActor } from "@/lib/teams-auth";
import { teamsErrorResponse } from "@/lib/teams-error-response";

export const dynamic = "force-dynamic";

// POST /api/teams/invitations/[invitationId]/decline -- the invited
// player's own action.
export async function POST(_request: Request, context: { params: Promise<{ invitationId: string }> }) {
  try {
    const actor = await resolveTeamsActor();
    if (!actor) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }

    const { invitationId } = await context.params;
    await declineInvitation(actor.id, invitationId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return teamsErrorResponse(error);
  }
}
