import { NextResponse } from "next/server";
import { getMyTeamState } from "@/features/teams";
import { resolveTeamsActor } from "@/lib/teams-auth";
import { teamsErrorResponse } from "@/lib/teams-error-response";

export const dynamic = "force-dynamic";

// GET /api/teams/me -- the caller's own team (if any) + their pending
// invitations. Identity comes only from resolveTeamsActor(), same
// convention as /api/dealer/me.
export async function GET() {
  try {
    const actor = await resolveTeamsActor();
    if (!actor) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }

    const state = await getMyTeamState(actor.id);
    return NextResponse.json(state);
  } catch (error) {
    return teamsErrorResponse(error);
  }
}
