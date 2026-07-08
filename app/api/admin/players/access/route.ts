import { NextResponse } from "next/server";
import { getPlayersForAccessManagement } from "@/features/admin";

export async function GET() {
  try {
    const players = await getPlayersForAccessManagement();
    return NextResponse.json({ players });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось загрузить игроков",
      },
      { status: 500 }
    );
  }
}
