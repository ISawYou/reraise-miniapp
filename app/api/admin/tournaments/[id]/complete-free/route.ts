import { NextResponse } from "next/server";
import {
  getDerivedEliminationPlaces,
  getTournamentAttendance,
  getTournamentById,
  getTournamentEliminations,
  getTournamentRebuyState,
  saveTournamentResults,
} from "@/features/tournaments";
import { calculateRatingPointsForTournament } from "@/features/rating-v2";
import { isRatingEligibleTournament } from "@/lib/tournament-helpers";
import { getMysteryBountySnapshot } from "@/features/mystery-bounty";
import { getTournamentLateRegistrationSnapshot } from "@/features/late-registration";
import { syncTournamentSheet } from "@/app/api/admin/tournaments/[id]/export-sheet/route";
import {
  applyLiveFieldsFromSheetSnapshot,
  readAndParseFreeTournamentSheet,
} from "@/features/tournament-sheet-sync";
import type { NormalizedFreeSheetRow } from "@/lib/tournament-sheet-parsing";
import { logCompletionError, resolveCompletionError } from "@/lib/tournament-completion-errors";
import { finishPokerClockTournament } from "@/lib/poker-clock-client";

// ReRaise is the authoritative tournament/results system -- everything
// through the GS sync below is completion as it already worked before
// Poker Clock existed, unreordered and untouched. Poker Clock finish
// (product item #8) is a POST-COMPLETION side effect ONLY, attempted after
// every step above has already fully succeeded: it can never block, delay,
// or roll back ReRaise's own completion, and its outcome (finished/
// not_linked/failed) is only ever reported alongside an already-successful
// response, never as this route's own error. A tournament with no linked
// Poker Clock tournament resolves to a normal "not_linked" no-op (Poker
// Clock's canonical generic 404), not a warning. See
// lib/poker-clock-client.ts::finishPokerClockTournament and
// app/api/admin/tournaments/[id]/poker-clock/finish/route.ts (the separate,
// narrow admin retry for when this step itself fails).
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

    // For a GS-linked free tournament, completion must guarantee freshness
    // itself -- the admin must never need to remember "Обновить из GS,
    // then Завершить турнир". Read the sheet fresh, right here,
    // server-side, then push it into live Postgres via the SAME
    // reconciliation the background synchronizer uses
    // (features/tournament-sheet-sync.ts), so arrived/eliminated/rebuys/
    // addons are current regardless of whether the ~15s poller happened to
    // run immediately before this request. Fail CLOSED here (unlike the
    // poller's fail-open philosophy): completion freezes `results`
    // irreversibly, so proceeding on a stale/unreadable sheet is worse than
    // making the admin retry.
    let freshSheetSnapshot: Map<string, NormalizedFreeSheetRow> | null = null;

    if (tournament.google_sheet_tab_name?.trim()) {
      const sheetResult = await readAndParseFreeTournamentSheet(tournament);

      if (!sheetResult.ok) {
        return NextResponse.json(
          { error: "Не удалось получить актуальные данные из Google Sheets. Повторите попытку." },
          { status: 409 }
        );
      }

      freshSheetSnapshot = sheetResult.rows;
      await applyLiveFieldsFromSheetSnapshot(
        id,
        sheetResult.rows,
        new Set(rawRows.map((row) => row.player_id))
      );
    }

    // Reconcile against tournament_attendance (the live "Пришёл" state --
    // see features/tournaments.ts::setTournamentPlayerAttendance) before
    // this feeds BOTH the rating calculation below and results.arrived.
    // In the normal single-tab flow the submitted `arrived` already matches
    // it (the results page hydrates from and immediately persists to this
    // same table), but this closes the gap for a stale second tab/session so
    // results.arrived -- and the rating computed from it -- can never
    // diverge from what the live checkbox actually says at completion time.
    // A player with no row in tournament_attendance at all (never toggled)
    // falls back to whatever the client submitted, then to false. When a
    // sheet was just read fresh above, this read already reflects it (the
    // reconciliation call above wrote it first).
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
    const [attendance, rebuyState, eliminations, lateRegistrationSnapshot] = await Promise.all([
      getTournamentAttendance(id),
      getTournamentRebuyState(id),
      getTournamentEliminations(id),
      getTournamentLateRegistrationSnapshot(id),
    ]);

    // Before validation/rating, reconcile the SAME authoritative derived
    // elimination placement everything else uses (see
    // lib/tournament-placement.ts) -- computed fresh from the
    // attendance/eliminations state just reconciled above, so completion
    // never calculates from a stale client-cached place for an eliminated
    // player. Only ever overrides an ELIMINATED player's place below --
    // non-eliminated (winner/top-finisher) rows keep the existing
    // sheet/client value untouched, same as before.
    const derivedPlaces = await getDerivedEliminationPlaces(id);

    const rows = rawRows.map((row) => {
      const liveRebuyState = rebuyState.get(row.player_id);
      const sheetRow = freshSheetSnapshot?.get(row.player_id);
      const eliminationState = eliminations.get(row.player_id);
      const isEliminated = eliminationState?.eliminated ?? row.eliminated ?? false;

      return {
        ...row,
        arrived: attendance.get(row.player_id)?.arrived ?? row.arrived ?? false,
        rebuys: liveRebuyState?.rebuys ?? row.rebuys ?? 0,
        addons: liveRebuyState?.addons ?? row.addons ?? 0,
        // eliminated_at is never read from the sheet (never trusted) --
        // only eliminated itself; the timestamp stays whatever
        // setTournamentPlayerElimination derived/preserved server-side.
        eliminated: isEliminated,
        eliminated_at: eliminationState?.eliminated_at ?? row.eliminated_at ?? null,
        // KO/Boss KO/Mystery points have no live Postgres mirror -- the
        // fresh sheet snapshot itself is the freshness fix for these,
        // falling back to the submitted value only for a player absent
        // from the sheet (e.g. registered in ReRaise but not yet
        // reflected there).
        knockouts: sheetRow?.knockouts ?? row.knockouts,
        boss_knockouts: sheetRow?.boss_knockouts ?? row.boss_knockouts ?? 0,
        mystery_bounty_points: sheetRow?.mystery_bounty_points ?? row.mystery_bounty_points ?? 0,
        // Eliminated players: the derived placement algorithm wins,
        // falling back to the fresh sheet value then the client value only
        // if a derived place genuinely isn't available. Non-eliminated
        // (active/winner) rows are untouched -- ReRaise only owns place
        // for eliminated rows.
        place: isEliminated
          ? derivedPlaces.get(row.player_id) ?? sheetRow?.place ?? row.place
          : sheetRow?.place ?? row.place,
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
      {
        ratingGuarantee: tournament.rating_guarantee,
        // Backward compatibility: tournaments completed without ever using
        // the new close operation keep today's fresh calculation. Once a
        // generic snapshot exists, only its placement distribution is used;
        // live KO/Mystery components still come from the engine above.
        ratingPlaces: lateRegistrationSnapshot?.rating_places,
      },
      isRatingEligibleTournament(tournament)
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
          // Free entry -- now persisted canonically (lib/db/schema/results.ts),
          // not only synced to the Google Sheet export below.
          free_reentries: row.free_reentries ?? 0,
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

    // Poker Clock synchronization is a POST-COMPLETION side effect only --
    // everything above (reconciliation, rating, saveTournamentResults, the
    // GS sync) has already fully succeeded by this point, and ReRaise's own
    // completion is unconditionally final regardless of what happens next.
    // finishPokerClockTournament never throws, and its result is never
    // allowed to turn this response into anything but success -- see that
    // function's doc comment (lib/poker-clock-client.ts) and this route's
    // own module doc comment above.
    const pokerClockResult = await finishPokerClockTournament(id);

    return NextResponse.json({
      ok: true,
      completedCount: rows.length,
      pokerClockSync: { status: pokerClockResult.status },
    });
  } catch (error) {
    logCompletionError({ operation: OPERATION, tournamentId: id, error });
    const { status, message } = resolveCompletionError(error);

    return NextResponse.json({ error: message }, { status });
  }
}
