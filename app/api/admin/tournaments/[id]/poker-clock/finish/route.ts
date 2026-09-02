import { NextResponse } from "next/server";
import { getTournamentById } from "@/features/tournaments";
import { finishPokerClockTournament } from "@/lib/poker-clock-client";

// Narrow admin retry for ONLY the Poker Clock finish side effect of
// completing a points/free tournament -- see
// app/api/admin/tournaments/[id]/complete-free/route.ts's own doc comment.
// Used when that route's own attempt reported
// pokerClockSync.status === "failed" (e.g. a transient network issue, or
// Poker Clock's linked Clock tournament still being draft -- a 409
// lifecycle conflict this route does NOT try to work around by starting the
// clock itself).
//
// Deliberately does nothing else: no rating recalculation, no
// saveTournamentResults, no Google Sheets sync, no ReRaise tournament-data
// write of any kind. Requires the ReRaise tournament to already be
// status === "completed" -- this is a resync of an already-finished
// tournament's clock, never a way to trigger/redo ReRaise completion.
// Safe to click repeatedly: finishPokerClockTournament calls Poker Clock's
// idempotent finish endpoint, and this route itself has no other side
// effect to duplicate.
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  try {
    const tournament = await getTournamentById(id);

    if (tournament.status !== "completed") {
      return NextResponse.json(
        {
          error:
            "Синхронизация Poker Clock доступна только после завершения турнира в ReRaise",
        },
        { status: 409 }
      );
    }

    const result = await finishPokerClockTournament(id);

    return NextResponse.json({ pokerClockSync: { status: result.status } });
  } catch (error) {
    console.error("[poker-clock/finish] unexpected error", {
      tournamentId: id,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "Не удалось повторить синхронизацию Poker Clock" },
      { status: 500 }
    );
  }
}
