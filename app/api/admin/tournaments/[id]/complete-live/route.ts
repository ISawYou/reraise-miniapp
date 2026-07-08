import { NextResponse } from "next/server";
import { completeTournamentFromLiveEntries } from "@/features/tournaments";
import { syncTournamentLiveSheet } from "@/app/api/admin/tournaments/[id]/live-sync/route";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
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
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to complete live tournament",
      },
      { status: 500 }
    );
  }
}
