import { NextResponse } from "next/server";
import { getPlayersForReferral } from "@/features/admin";

export async function GET() {
  try {
    const players = await getPlayersForReferral();
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
