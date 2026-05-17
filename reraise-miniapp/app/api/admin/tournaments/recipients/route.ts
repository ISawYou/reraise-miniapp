import { NextResponse } from "next/server";
import {
  getTournamentNotificationRecipientsByAudience,
  type TournamentNotificationAudience,
} from "@/features/tournaments";
import type { TournamentKind } from "@/types/domain";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tournamentId = searchParams.get("tournamentId");
    const tournamentKind = searchParams.get("tournamentKind") as TournamentKind | null;
    const audience = searchParams.get(
      "audience"
    ) as TournamentNotificationAudience | null;

    if (!tournamentId || !tournamentKind || !audience) {
      return NextResponse.json(
        { error: "Не хватает параметров для загрузки получателей" },
        { status: 400 }
      );
    }

    const recipients = await getTournamentNotificationRecipientsByAudience({
      tournamentId,
      tournamentKind,
      audience,
    });

    return NextResponse.json({ recipients });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось загрузить получателей",
      },
      { status: 500 }
    );
  }
}
