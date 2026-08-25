import { NextResponse } from "next/server";
import {
  getTournamentAttendance,
  getTournamentById,
  getTournamentRebuyState,
  saveTournamentResults,
} from "@/features/tournaments";
import { calculateRatingPointsForTournament } from "@/features/rating-v2";
import { getMysteryBountySnapshot } from "@/features/mystery-bounty";
import { syncTournamentSheet } from "@/app/api/admin/tournaments/[id]/export-sheet/route";
import { logCompletionError, resolveCompletionError } from "@/lib/tournament-completion-errors";

const OPERATION = "complete-free";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  try {
    const body = (await request.json()) as {
      rows?: Array<{
        player_id: string;
        display_name?: string;
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

    const rawRows = body.rows ?? [];
    const tournament = await getTournamentById(id);

    // Reconcile against tournament_attendance (the live "Пришёл" state --
    // see features/tournaments.ts::setTournamentPlayerAttendance) before
    // this feeds BOTH the rating calculation below and results.arrived.
    // In the normal single-tab flow the submitted `arrived` already matches
    // it (the results page hydrates from and immediately persists to this
    // same table), but this closes the gap for a stale second tab/session so
    // results.arrived -- and the rating computed from it -- can never
    // diverge from what the live checkbox actually says at completion time.
    // A player with no row in tournament_attendance at all (never toggled)
    // falls back to whatever the client submitted, then to false.
    //
    // Same reconciliation, same reason, for Re-buy/Add-on against
    // tournament_rebuy_state -- the live state a direct UI edit (onBlur) or
    // an explicit "Обновить из GS" commit already wrote. Authoritative
    // semantics at completion: live Postgres state wins whenever a row
    // exists for that player, exactly like arrived above, so a stale
    // second tab/session's submitted numbers can never silently overwrite
    // what's actually live in the DB. A player with no live rebuy-state row
    // at all (never touched) falls back to whatever the client submitted,
    // then to 0 -- there is no other case where "no row yet" should mean
    // anything other than the untouched default.
    const [attendance, rebuyState] = await Promise.all([
      getTournamentAttendance(id),
      getTournamentRebuyState(id),
    ]);
    const rows = rawRows.map((row) => {
      const liveRebuyState = rebuyState.get(row.player_id);

      return {
        ...row,
        arrived: attendance.get(row.player_id)?.arrived ?? row.arrived ?? false,
        rebuys: liveRebuyState?.rebuys ?? row.rebuys ?? 0,
        addons: liveRebuyState?.addons ?? row.addons ?? 0,
      };
    });

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

    // row.rebuys is each player's TOTAL entries (initial entry + every
    // rebuy) -- the same admin-facing field/convention used throughout the
    // app (see lib/mystery-bounty.ts's doc comment), not a rebuy-only count.
    const { results: ratingResults } = calculateRatingPointsForTournament(
      rows.map((row) => ({
        player_id: row.player_id,
        place: row.place,
        knockouts: row.knockouts,
        boss_knockouts: row.boss_knockouts ?? 0,
        mystery_bounty_points: row.mystery_bounty_points ?? 0,
        arrived: row.arrived ?? false,
        entries: row.rebuys,
        addons: row.addons ?? 0,
      })),
      tournament.tournament_type,
      tournament.rating_formula_version,
      { ratingGuarantee: tournament.rating_guarantee }
    );
    const ratingMap = new Map(ratingResults.map((r) => [r.player_id, r]));

    await saveTournamentResults(
      id,
      rows.map((row) => {
        const rating = ratingMap.get(row.player_id);

        return {
          player_id: row.player_id,
          display_name: row.display_name,
          place: row.place,
          reentries: row.rebuys,
          knockouts: row.knockouts,
          boss_knockouts: row.boss_knockouts ?? 0,
          mystery_bounty_points: row.mystery_bounty_points ?? 0,
          addons: row.addons ?? 0,
          rating_points: rating?.rating_points ?? 0,
          // Rating Breakdown -- same calculator call above, not a second
          // computation.
          arrived: row.arrived ?? false,
          participation_points: rating?.participation_points ?? null,
          knockout_points: rating?.knockout_points ?? null,
          boss_bounty_points: rating?.boss_bounty_points ?? null,
          itm_points: rating?.itm_points ?? null,
        };
      })
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
        rating_points: ratingMap.get(row.player_id)?.rating_points ?? 0,
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
    logCompletionError({ operation: OPERATION, tournamentId: id, error });
    const { status, message } = resolveCompletionError(error);

    return NextResponse.json({ error: message }, { status });
  }
}
