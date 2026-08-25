import { NextResponse } from "next/server";
import { setTournamentPlayerAttendance } from "@/features/tournaments";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as
      | { player_id?: string; arrived?: boolean }
      | null;

    if (!body?.player_id || typeof body.arrived !== "boolean") {
      return NextResponse.json(
        { error: "player_id и arrived обязательны" },
        { status: 400 }
      );
    }

    const result = await setTournamentPlayerAttendance(
      id,
      body.player_id,
      body.arrived
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update attendance status",
      },
      { status: 500 }
    );
  }
}
