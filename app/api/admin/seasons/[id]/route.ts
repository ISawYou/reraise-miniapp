import { NextResponse } from "next/server";
import { SeasonEditRejectedError, updateSeason } from "@/features/seasons";
import { InvalidSeasonRangeError, SeasonRangeOverlapError } from "@/lib/season-resolver";

// Season management -- Super-Admin-only, same gate as GET/POST
// /api/admin/seasons (see that route's doc comment). Title/date-range
// edits only -- is_active is never writable here (see
// features/seasons.ts::updateSeason's doc comment: that's exclusively
// closeSeason/rolloverSeason's job).
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  try {
    const body = (await request.json().catch(() => null)) as
      | { title?: string; start_date?: string; end_date?: string | null }
      | null;

    if (!body) {
      return NextResponse.json({ error: "Пустое тело запроса" }, { status: 400 });
    }

    const { season, resync } = await updateSeason(id, {
      ...(body.title !== undefined ? { title: body.title.trim() } : {}),
      ...(body.start_date !== undefined ? { start_date: body.start_date } : {}),
      ...(body.end_date !== undefined ? { end_date: body.end_date } : {}),
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
      { error: error instanceof Error ? error.message : "Не удалось изменить сезон" },
      { status: 400 }
    );
  }
}
