import { NextResponse } from "next/server";
import { createTeam, getTeamLeaderboard, type TeamScopeInput } from "@/features/teams";
import { resolveTeamsActor } from "@/lib/teams-auth";
import { teamsErrorResponse } from "@/lib/teams-error-response";

export const dynamic = "force-dynamic";

// GET /api/teams?scope=current|all_time|archive&seasonId=... -- public
// "Рейтинг" leaderboard, no auth required (same as /api/leaderboard).
export async function GET(request: Request) {
  try {
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

    const standings = await getTeamLeaderboard(scope);
    return NextResponse.json({ standings });
  } catch (error) {
    return teamsErrorResponse(error);
  }
}

// POST /api/teams -- create a team. Auth via resolveTeamsActor only; the
// request body never carries a player/captain id.
export async function POST(request: Request) {
  try {
    const actor = await resolveTeamsActor();
    if (!actor) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }

    const body = (await request.json()) as { name?: string; emblem?: string };
    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "Укажите название команды" }, { status: 400 });
    }

    const team = await createTeam(actor.id, { name: body.name, emblem: body.emblem });
    return NextResponse.json({ team });
  } catch (error) {
    return teamsErrorResponse(error);
  }
}
