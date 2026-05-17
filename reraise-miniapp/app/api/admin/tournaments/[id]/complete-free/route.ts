import { NextResponse } from "next/server";
import { saveTournamentResults } from "@/features/tournaments";
import { syncTournamentSheet } from "@/app/api/admin/tournaments/[id]/export-sheet/route";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      rows?: Array<{
        player_id: string;
        arrived?: boolean;
        rebuys: number;
        addons?: number;
        knockouts: number;
        place: number;
      }>;
      entryPrice?: number;
      addonPrice?: number;
      bountyPrice?: number;
    };

    const rows = body.rows ?? [];

    await saveTournamentResults(
      id,
      rows.map((row) => ({
        player_id: row.player_id,
        place: row.place,
        reentries: row.rebuys,
        knockouts: row.knockouts,
        rating_points: 0, // TODO: restore automatic rating calculation for free tournaments.
      }))
    );

    await syncTournamentSheet(
      id,
      rows.map((row) => ({
        player_id: row.player_id,
        arrived: row.arrived ?? false,
        rebuys: row.rebuys,
        addons: row.addons ?? 0,
        knockouts: row.knockouts,
        place: row.place,
      })),
      body.entryPrice ?? 0,
      body.addonPrice ?? 0,
      body.bountyPrice ?? 0
    );

    return NextResponse.json({
      ok: true,
      completedCount: rows.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to complete free tournament",
      },
      { status: 500 }
    );
  }
}
