import { NextResponse } from "next/server";
import { getPlayersForNicknameDirectory } from "@/features/admin";

export async function GET() {
  try {
    const players = await getPlayersForNicknameDirectory();
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
