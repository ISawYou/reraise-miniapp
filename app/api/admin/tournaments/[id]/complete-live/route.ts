import { NextResponse } from "next/server";
import { completeTournamentFromLiveEntries, getTournamentById } from "@/features/tournaments";
import { syncTournamentLiveSheet } from "@/app/api/admin/tournaments/[id]/live-sync/route";
import { logCompletionError, resolveCompletionError } from "@/lib/tournament-completion-errors";
import { TournamentAlreadyCompletedError } from "@/lib/tournament-errors";

const OPERATION = "complete-live";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  try {
    const body = (await request.json().catch(() => null)) as
      | {
          rows?: Array<{
            player_id: string;
            arrived: boolean;
            paid?: boolean;
            payment_type?: string;
            free_reentries?: number;
            rebuys: number;
            addons: number;
            knockouts: number;
            boss_knockouts?: number;
            place: number | null;
          }>;
          entryPrice?: number;
          addonPrice?: number;
          bountyPrice?: number;
        }
      | null;

    // Re-completion guard, fail fast BEFORE the pre-completion live-entry /
    // Google Sheets sync below. The authoritative (locked) check is inside
    // completeTournamentFromLiveEntries -> commitTournamentCompletion
    // (features/tournament-completion-commit.ts).
    const tournament = await getTournamentById(id);
    if (tournament.status === "completed") {
      throw new TournamentAlreadyCompletedError();
    }

    if (body?.rows?.length) {
      await syncTournamentLiveSheet(
        id,
        body.rows,
        body.entryPrice ?? 0,
        body.addonPrice ?? 0,
        body.bountyPrice ?? 0
      );
    }

    const result = await completeTournamentFromLiveEntries(id);
    await syncTournamentLiveSheet(
      id,
      body?.rows,
      body?.entryPrice ?? 0,
      body?.addonPrice ?? 0,
      body?.bountyPrice ?? 0
    );

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
