import { NextResponse } from "next/server";
import { searchInvitablePlayers } from "@/features/teams";
import { resolveTeamsActor } from "@/lib/teams-auth";
import { teamsErrorResponse } from "@/lib/teams-error-response";

export const dynamic = "force-dynamic";

// GET /api/teams/search-players?q=... -- player-safe search for the
// captain's invite picker. Auth required (not a fully public endpoint,
// since it's only useful for inviting), but not captain-gated here --
// inviteToTeam itself is the real captain-only gate; this just returns
// safe display data no different from what /players/[id] already shows.
export async function GET(request: Request) {
  try {
    const actor = await resolveTeamsActor();
    if (!actor) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? "";

    const players = await searchInvitablePlayers(actor.id, query);
    return NextResponse.json({ players });
  } catch (error) {
    return teamsErrorResponse(error);
  }
}
