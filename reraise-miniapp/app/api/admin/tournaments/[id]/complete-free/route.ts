import { NextResponse } from "next/server";
import { saveTournamentResults } from "@/features/tournaments";
import { calculateRatingPoints } from "@/features/rating";
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
        paid?: boolean;
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
    const hasKnockouts = (body.bountyPrice ?? 0) > 0;

    const ratingMap = new Map(
      calculateRatingPoints(
        rows.map((row) => ({
          player_id: row.player_id,
          place: row.place,
          knockouts: row.knockouts,
          arrived: row.arrived ?? false,
        })),
        hasKnockouts
      ).map((r) => [r.player_id, r.rating_points])
    );

    await saveTournamentResults(
      id,
      rows.map((row) => ({
        player_id: row.player_id,
        place: row.place,
        reentries: row.rebuys,
        knockouts: row.knockouts,
        rating_points: ratingMap.get(row.player_id) ?? 0,
      }))
    );

    await syncTournamentSheet(
      id,
      rows.map((row) => ({
        player_id: row.player_id,
        arrived: row.arrived ?? false,
        paid: row.paid ?? false,
        rebuys: row.rebuys,
        addons: row.addons ?? 0,
        knockouts: row.knockouts,
        place: row.place,
        rating_points: ratingMap.get(row.player_id) ?? 0,
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
