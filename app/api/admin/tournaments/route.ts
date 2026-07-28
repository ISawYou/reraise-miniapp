import { NextResponse } from "next/server";
import {
  getAdminNotificationTournaments,
  getOpenTournaments,
} from "@/features/tournaments";
import { seasonRepository, tournamentRepository } from "@/lib/repositories";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope");

    const tournaments =
      scope === "manage"
        ? await tournamentRepository.listByStatuses(["open", "completed"])
        : scope === "all"
          ? await getAdminNotificationTournaments()
          : await getOpenTournaments();

    return NextResponse.json({ tournaments });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось загрузить турниры",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      title: string;
      description: string;
      location: string;
      start_at: string;
      max_players: number;
      tournament_type?:
        | "classic"
        | "phoenix"
        | "deep_stack"
        | "bounty"
        | "boss_bounty"
        | "win_the_button";
    };

    let activeSeason;
    try {
      activeSeason = await seasonRepository.findActive();
    } catch (err) {
      return NextResponse.json(
        {
          error: `Не удалось получить активный сезон: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
        { status: 500 }
      );
    }

    if (!activeSeason) {
      return NextResponse.json(
        { error: "Активный сезон не найден" },
        { status: 400 }
      );
    }

    let tournament;
    try {
      tournament = await tournamentRepository.create({
        title: body.title,
        description: body.description,
        location: body.location,
        start_at: body.start_at,
        max_players: body.max_players,
        kind: "free",
        tournament_type: body.tournament_type ?? "classic",
        status: "open",
        season_id: activeSeason.id,
      });
    } catch (err) {
      return NextResponse.json(
        {
          error: `Не удалось создать турнир: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ tournament });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось создать турнир",
      },
      { status: 500 }
    );
  }
}
