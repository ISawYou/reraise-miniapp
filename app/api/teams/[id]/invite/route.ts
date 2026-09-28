import { NextResponse } from "next/server";
import { inviteToTeam } from "@/features/teams";
import { resolveTeamsActor } from "@/lib/teams-auth";
import { teamsErrorResponse } from "@/lib/teams-error-response";

export const dynamic = "force-dynamic";

// POST /api/teams/[id]/invite { playerId } -- captain-only.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveTeamsActor();
    if (!actor) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }

    const { id } = await context.params;
    const body = (await request.json()) as { playerId?: string };
    if (!body.playerId) {
      return NextResponse.json({ error: "Укажите игрока" }, { status: 400 });
    }

    await inviteToTeam(actor.id, id, body.playerId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return teamsErrorResponse(error);
  }
}
