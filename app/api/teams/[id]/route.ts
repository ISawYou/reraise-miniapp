import { NextResponse } from "next/server";
import { getTeamDetail, updateTeamIdentity, type TeamScopeInput } from "@/features/teams";
import { resolveTeamsActor } from "@/lib/teams-auth";
import { teamsErrorResponse } from "@/lib/teams-error-response";

export const dynamic = "force-dynamic";

// GET /api/teams/[id]?scope=current|all_time|archive&seasonId=... -- public
// team detail page. No auth required.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const scopeParam = searchParams.get("scope") ?? "current";
    const seasonId = searchParams.get("seasonId");

    let scope: TeamScopeInput;
    if (scopeParam === "all_time") {
      scope = { kind: "all_time" };
    } else if (scopeParam === "archive") {
      if (!seasonId) {
        return NextResponse.json({ error: "seasonId обязателен для архива" }, { status: 400 });
      }
      scope = { kind: "archive", seasonId };
    } else {
      scope = { kind: "current" };
    }

    const team = await getTeamDetail(id, scope);
    if (!team) {
      return NextResponse.json({ error: "Команда не найдена" }, { status: 404 });
    }
    return NextResponse.json({ team });
  } catch (error) {
    return teamsErrorResponse(error);
  }
}

// PATCH /api/teams/[id] -- captain-only rename/re-emblem.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveTeamsActor();
    if (!actor) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }

    const { id } = await context.params;
    const body = (await request.json()) as { name?: string; emblem?: string };

    const team = await updateTeamIdentity(actor.id, id, { name: body.name, emblem: body.emblem });
    return NextResponse.json({ team });
  } catch (error) {
    return teamsErrorResponse(error);
  }
}
