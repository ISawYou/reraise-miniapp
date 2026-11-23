import { NextResponse } from "next/server";
import { getCompletedTournamentResults } from "@/features/tournaments";
import {
  CompletedResultsNotReadyError,
  CompletedResultsUnavailableError,
  UnsupportedCompletedResultsTypeError,
} from "@/lib/completed-results";
import { verifyIntegrationRequest } from "@/lib/integration-auth";
import { TournamentNotFoundError } from "@/lib/tournament-errors";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store" };

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!verifyIntegrationRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  }

  const { id } = await context.params;
  try {
    const result = await getCompletedTournamentResults(id);
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof TournamentNotFoundError) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404, headers: noStoreHeaders });
    }
    if (error instanceof CompletedResultsNotReadyError) {
      return NextResponse.json(
        { code: error.code, error: "Official results are not ready" },
        { status: 409, headers: noStoreHeaders },
      );
    }
    if (error instanceof CompletedResultsUnavailableError) {
      return NextResponse.json(
        { code: error.code, error: "Official results are unavailable" },
        { status: 502, headers: noStoreHeaders },
      );
    }
    if (error instanceof UnsupportedCompletedResultsTypeError) {
      return NextResponse.json(
        { code: error.code, error: "Unsupported tournament type" },
        { status: 422, headers: noStoreHeaders },
      );
    }

    console.error("[integrations/v1/tournaments/:id/completed-results] unexpected error", {
      tournamentId: id,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500, headers: noStoreHeaders });
  }
}
