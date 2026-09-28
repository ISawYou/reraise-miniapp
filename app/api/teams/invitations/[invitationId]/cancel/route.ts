import { NextResponse } from "next/server";
import { cancelInvitation } from "@/features/teams";
import { resolveTeamsActor } from "@/lib/teams-auth";
import { teamsErrorResponse } from "@/lib/teams-error-response";

export const dynamic = "force-dynamic";

// POST /api/teams/invitations/[invitationId]/cancel -- captain-only
// (of the invitation's own team), cancelling an invitation they sent.
export async function POST(_request: Request, context: { params: Promise<{ invitationId: string }> }) {
  try {
    const actor = await resolveTeamsActor();
    if (!actor) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }

    const { invitationId } = await context.params;
    await cancelInvitation(actor.id, invitationId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return teamsErrorResponse(error);
  }
}
