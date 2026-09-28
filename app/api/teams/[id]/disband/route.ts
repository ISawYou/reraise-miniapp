import { NextResponse } from "next/server";
import { disbandTeam } from "@/features/teams";
import { resolveTeamsActor } from "@/lib/teams-auth";
import { teamsErrorResponse } from "@/lib/teams-error-response";

export const dynamic = "force-dynamic";

// POST /api/teams/[id]/disband -- captain-only, one transaction (see
// features/teams.ts::disbandTeam).
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveTeamsActor();
    if (!actor) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }

    const { id } = await context.params;
    await disbandTeam(actor.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return teamsErrorResponse(error);
  }
}
