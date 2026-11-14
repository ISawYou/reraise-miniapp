import { NextResponse } from "next/server";
import { completeTournamentFromLiveEntries, getTournamentById } from "@/features/tournaments";
import { logCompletionError, resolveCompletionError } from "@/lib/tournament-completion-errors";
import { TournamentAlreadyCompletedError } from "@/lib/tournament-errors";
import { assertServerActorRole } from "@/lib/admin-auth";

const OPERATION = "complete-live";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  try {
    await assertServerActorRole(["admin", "operator"]);

    // Re-completion guard, fail fast before the authoritative completion.
    // The locked check is inside
    // completeTournamentFromLiveEntries -> commitTournamentCompletion
    // (features/tournament-completion-commit.ts).
    const tournament = await getTournamentById(id);
    if (tournament.status === "completed") {
      throw new TournamentAlreadyCompletedError();
    }

    const result = await completeTournamentFromLiveEntries(id);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    logCompletionError({ operation: OPERATION, tournamentId: id, error });
    const { status, message } = resolveCompletionError(error);

    return NextResponse.json({ error: message }, { status });
  }
}
