import { NextResponse } from "next/server";
import {
  getAdminNotificationTournaments,
  getOpenTournaments,
} from "@/features/tournaments";
import type { TournamentKind } from "@/types/domain";
import { supabase } from "@/lib/supabase";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope");

    const tournaments =
      scope === "all"
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
      kind: TournamentKind;
    };

    const { data: activeSeason, error: activeSeasonError } = await supabase
      .from("seasons")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .single();

    if (activeSeasonError) {
      if (activeSeasonError.code === "PGRST116") {
        return NextResponse.json(
          { error: "Активный сезон не найден" },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          error: `Не удалось получить активный сезон: ${activeSeasonError.message}`,
        },
        { status: 500 }
      );
    }

    const { data: tournament, error: createError } = await supabase
      .from("tournaments")
      .insert({
        title: body.title,
        description: body.description,
        location: body.location,
        start_at: body.start_at,
        max_players: body.max_players,
        kind: body.kind,
        status: "open",
        season_id: activeSeason.id,
      })
      .select("*")
      .single();

    if (createError) {
      return NextResponse.json(
        { error: `Не удалось создать турнир: ${createError.message}` },
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
