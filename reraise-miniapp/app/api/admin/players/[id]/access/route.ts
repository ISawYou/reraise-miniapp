import { NextResponse } from "next/server";
import { updatePlayerTournamentAccess } from "@/features/admin";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      can_access_free?: boolean;
      can_access_paid?: boolean;
      can_access_cash?: boolean;
    };

    const player = await updatePlayerTournamentAccess(id, body);
    return NextResponse.json({ player });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось обновить права игрока",
      },
      { status: 500 }
    );
  }
}
