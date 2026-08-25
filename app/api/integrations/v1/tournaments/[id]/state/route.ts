import { NextResponse } from "next/server";
import { getTournamentStateForIntegration } from "@/features/late-registration";
import { verifyIntegrationRequest } from "@/lib/integration-auth";
import { TournamentNotFoundError } from "@/lib/tournament-errors";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!verifyIntegrationRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  try {
    return NextResponse.json(await getTournamentStateForIntegration(id));
  } catch (error) {
    if (error instanceof TournamentNotFoundError) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    if (error instanceof Error && error.message.includes("только для рейтинговых free")) {
      return NextResponse.json({ error: "Tournament does not support rating state" }, { status: 400 });
    }

    console.error("[integrations/v1/tournaments/:id/state] unexpected error", {
      tournamentId: id,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
