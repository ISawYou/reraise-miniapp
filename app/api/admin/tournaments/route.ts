import { NextResponse } from "next/server";
import {
  createTournament,
  getAdminNotificationTournaments,
  getOpenTournaments,
} from "@/features/tournaments";
import { NoSeasonForDateError, AmbiguousSeasonError } from "@/lib/season-resolver";
import { tournamentRepository } from "@/lib/repositories";

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
      // Phoenix Rating Guarantee (spec §15) -- only meaningful for
      // tournament_type "phoenix", but not rejected for other types (same
      // "not DB-constrained to it" approach as the schema check).
      rating_guarantee?: number | null;
    };

    let tournament;
    try {
      // Season is resolved from body.start_at (Europe/Moscow calendar
      // date), NOT the currently active season -- see
      // features/tournaments.ts::createTournament /
      // features/seasons.ts::resolveSeasonForTournamentDate, the one
      // canonical resolution.
      tournament = await createTournament({
        title: body.title,
        description: body.description,
        location: body.location,
        start_at: body.start_at,
        max_players: body.max_players,
        tournament_type: body.tournament_type ?? "classic",
        rating_guarantee: body.rating_guarantee ?? null,
      });
    } catch (err) {
      if (err instanceof NoSeasonForDateError || err instanceof AmbiguousSeasonError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
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
