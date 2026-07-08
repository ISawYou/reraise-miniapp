import { NextResponse } from "next/server";
import { setTournamentPlayerElimination } from "@/features/tournaments";

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

    const result = await setTournamentPlayerElimination(
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
