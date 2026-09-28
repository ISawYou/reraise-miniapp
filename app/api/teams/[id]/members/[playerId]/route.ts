import { NextResponse } from "next/server";
import { removeMember } from "@/features/teams";
import { resolveTeamsActor } from "@/lib/teams-auth";
import { teamsErrorResponse } from "@/lib/teams-error-response";

export const dynamic = "force-dynamic";

// DELETE /api/teams/[id]/members/[playerId] -- captain-only kick. The
// captain can never target their own id this way (features/teams.ts's
// removeMember refuses it -- CaptainCannotBeRemovedError).
export async function DELETE(_request: Request, context: { params: Promise<{ id: string; playerId: string }> }) {
  try {
    const actor = await resolveTeamsActor();
    if (!actor) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }

    const { id, playerId } = await context.params;
    await removeMember(actor.id, id, playerId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return teamsErrorResponse(error);
  }
}
