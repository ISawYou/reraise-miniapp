import { NextResponse } from "next/server";
import { createSeason, listSeasonsAdmin, SeasonEditRejectedError } from "@/features/seasons";
import { InvalidSeasonRangeError, SeasonRangeOverlapError } from "@/lib/season-resolver";

// Season management -- Super-Admin-only (not on the operator allowlist in
// lib/admin-permissions.ts, so middleware.ts's fail-closed gate denies
// operator by default). Full rows including internal start_date/end_date;
// never sent to a player-facing surface (see features/seasons.ts's
// PublicSeason for that shape).
export async function GET() {
  try {
    const seasons = await listSeasonsAdmin();
    return NextResponse.json({ seasons });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить сезоны" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { title?: string; start_date?: string; end_date?: string | null }
      | null;

    if (!body?.title?.trim() || !body?.start_date) {
      return NextResponse.json({ error: "Название и дата начала обязательны" }, { status: 400 });
    }

    const { season, resync } = await createSeason({
      title: body.title.trim(),
      start_date: body.start_date,
      end_date: body.end_date ?? null,
    });

    return NextResponse.json({ season, resync });
  } catch (error) {
    if (
      error instanceof InvalidSeasonRangeError ||
      error instanceof SeasonRangeOverlapError ||
      error instanceof SeasonEditRejectedError
    ) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось создать сезон" },
      { status: 400 }
    );
  }
}
