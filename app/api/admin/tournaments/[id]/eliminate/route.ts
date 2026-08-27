import { NextResponse } from "next/server";
import { setTournamentPlayerEliminationThroughSheet } from "@/features/tournament-sheet-sync";

// For a GS-linked active free tournament, Google Sheets owns "Выбыл" --
// this write-through's job is exactly to make sure a ReRaise-side click
// can never be silently reverted by the next ~15s poller tick (see
// setTournamentPlayerEliminationThroughSheet's own doc comment). For a
// tournament with no linked sheet, behavior is unchanged from before.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as
      | { player_id?: string; eliminated?: boolean }
      | null;

    if (!body?.player_id || typeof body.eliminated !== "boolean") {
      return NextResponse.json(
        { error: "player_id и eliminated обязательны" },
        { status: 400 }
      );
    }

    const result = await setTournamentPlayerEliminationThroughSheet(
      id,
      body.player_id,
      body.eliminated
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update elimination status",
      },
      { status: 500 }
    );
  }
}
