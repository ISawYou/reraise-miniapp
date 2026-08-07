import { NextResponse } from "next/server";
import { getTournamentById, saveTournamentResults } from "@/features/tournaments";
import { calculateRatingPoints } from "@/features/rating";
import { getMysteryBountySnapshot } from "@/features/mystery-bounty";
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
        payment_type?: string;
        free_reentries?: number;
        rebuys: number;
        addons?: number;
        knockouts: number;
        boss_knockouts?: number;
        mystery_bounty_points?: number;
        place: number;
        eliminated?: boolean;
        eliminated_at?: string | null;
      }>;
      entryPrice?: number;
      addonPrice?: number;
      bountyPrice?: number;
    };

    const rows = body.rows ?? [];
    const tournament = await getTournamentById(id);

    // Mystery Bounty: completion is only allowed once every drawn envelope
    // point has actually been recorded against a player — otherwise the
    // rating pipeline would silently under/over-count the pool (spec §21
    // "Завершение турнира").
    if (tournament.tournament_type === "mystery_bounty") {
      const snapshot = await getMysteryBountySnapshot(id);

      if (!snapshot) {
        return NextResponse.json(
          { error: "Mystery Bounty: Late Registration ещё не закрыта" },
          { status: 400 }
        );
      }

      const awarded = rows.reduce((sum, row) => sum + (row.mystery_bounty_points ?? 0), 0);

      if (awarded !== snapshot.mystery_pool) {
        return NextResponse.json(
          {
            error:
              awarded > snapshot.mystery_pool
                ? `Mystery Bounty: выдано больше очков (${awarded}), чем в пуле (${snapshot.mystery_pool})`
                : `Mystery Bounty: не все очки распределены — выдано ${awarded} из ${snapshot.mystery_pool}`,
          },
          { status: 400 }
        );
      }
    }

    const ratingMap = new Map(
      calculateRatingPoints(
        rows.map((row) => ({
          player_id: row.player_id,
          place: row.place,
          knockouts: row.knockouts,
          boss_knockouts: row.boss_knockouts ?? 0,
          mystery_bounty_points: row.mystery_bounty_points ?? 0,
          arrived: row.arrived ?? false,
        })),
        tournament.tournament_type
      ).map((r) => [r.player_id, r.rating_points])
    );

    await saveTournamentResults(
      id,
      rows.map((row) => ({
        player_id: row.player_id,
        place: row.place,
        reentries: row.rebuys,
        knockouts: row.knockouts,
        boss_knockouts: row.boss_knockouts ?? 0,
        mystery_bounty_points: row.mystery_bounty_points ?? 0,
        rating_points: ratingMap.get(row.player_id) ?? 0,
      }))
    );

    await syncTournamentSheet(
      id,
      rows.map((row) => ({
        player_id: row.player_id,
        arrived: row.arrived ?? false,
        paid: row.paid ?? false,
        payment_type: row.payment_type ?? "",
        free_reentries: row.free_reentries ?? 0,
        rebuys: row.rebuys,
        addons: row.addons ?? 0,
        knockouts: row.knockouts,
        boss_knockouts: row.boss_knockouts ?? 0,
        mystery_bounty_points: row.mystery_bounty_points ?? 0,
        place: row.place,
        rating_points: ratingMap.get(row.player_id) ?? 0,
        eliminated: row.eliminated ?? false,
        eliminated_at: row.eliminated_at ?? null,
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
