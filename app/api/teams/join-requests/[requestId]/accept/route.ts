import { NextResponse } from "next/server";
import { acceptJoinRequest } from "@/features/teams";
import { resolveTeamsActor } from "@/lib/teams-auth";
import { teamsErrorResponse } from "@/lib/teams-error-response";

export const dynamic = "force-dynamic";

// POST /api/teams/join-requests/[requestId]/accept -- captain-only.
export async function POST(_request: Request, context: { params: Promise<{ requestId: string }> }) {
  try {
    const actor = await resolveTeamsActor();
    if (!actor) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }

    const { requestId } = await context.params;
    const team = await acceptJoinRequest(actor.id, requestId);
    return NextResponse.json({ team });
  } catch (error) {
    return teamsErrorResponse(error);
  }
}
