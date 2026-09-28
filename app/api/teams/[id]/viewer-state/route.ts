import { NextResponse } from "next/server";
import { getTeamViewerState } from "@/features/teams";
import { resolveTeamsActor } from "@/lib/teams-auth";
import { teamsErrorResponse } from "@/lib/teams-error-response";

export const dynamic = "force-dynamic";

// GET /api/teams/[id]/viewer-state -- per-VIEWER CTA state for the public
// team detail page ("Подать заявку" / "Заявка отправлена" / nothing).
// Auth required (this is private-to-the-caller state, unlike the rest of
// the team detail page); an anonymous visitor simply gets no CTA on the
// client (401 is treated the same as "no state" there).
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveTeamsActor();
    if (!actor) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }

    const { id } = await context.params;
    const state = await getTeamViewerState(id, actor.id);
    return NextResponse.json(state);
  } catch (error) {
    return teamsErrorResponse(error);
  }
}
