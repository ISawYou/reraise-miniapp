import { NextResponse } from "next/server";
import { completeTournamentFromLiveEntries } from "@/features/tournaments";
import { syncTournamentLiveSheet } from "@/app/api/admin/tournaments/[id]/live-sync/route";
import { logCompletionError, resolveCompletionError } from "@/lib/tournament-completion-errors";

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
