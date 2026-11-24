import { NextResponse } from "next/server";
import { setTournamentPlayerElimination } from "@/features/tournaments";
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

    const result = await setTournamentPlayerElimination(
      id,
      body.player_id,
      false
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
