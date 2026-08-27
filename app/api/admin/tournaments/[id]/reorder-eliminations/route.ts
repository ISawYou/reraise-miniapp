import { NextResponse } from "next/server";
import { reorderTournamentEliminationsThroughSheet } from "@/features/tournament-sheet-sync";

// "Исправить порядок выбывания" -- corrects the elimination ORDER when
// every affected player genuinely is eliminated, just in the wrong
// sequence. `player_ids` must be exactly the tournament's current
// eliminated set, in the admin's corrected chronological order (first
// entry = eliminated first = worst place) -- validated server-side so a
// stale client can never corrupt state (see
// features/tournaments.ts::reorderTournamentEliminations).
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as { player_ids?: string[] } | null;

    if (!Array.isArray(body?.player_ids) || body.player_ids.some((v) => typeof v !== "string")) {
      return NextResponse.json({ error: "player_ids (string[]) обязателен" }, { status: 400 });
    }

    const result = await reorderTournamentEliminationsThroughSheet(id, body.player_ids);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось сохранить порядок выбывания",
      },
      { status: 500 }
    );
  }
}
