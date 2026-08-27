import { NextResponse } from "next/server";
import { setTournamentPlayerEliminationThroughSheet } from "@/features/tournament-sheet-sync";

// "Вернуть в игру" -- the dedicated one-player elimination correction (see
// the Google Sheets live-sync's setTournamentPlayerEliminationThroughSheet
// doc comment for why this needs its own fail-closed mode instead of
// reusing the ordinary /eliminate checkbox's fail-open behavior). If the
// required Google Sheets checkbox write can't be performed, this returns a
// clear error instead of reporting success while leaving GS=true and
// Postgres=false -- that split would just get "corrected" back to
// eliminated=true by the next ~15s poller tick.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as { player_id?: string } | null;

    if (!body?.player_id) {
      return NextResponse.json({ error: "player_id обязателен" }, { status: 400 });
    }

    const result = await setTournamentPlayerEliminationThroughSheet(
      id,
      body.player_id,
      false,
      { failClosedOnSheetWrite: true }
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось вернуть игрока в игру",
      },
      { status: 500 }
    );
  }
}
