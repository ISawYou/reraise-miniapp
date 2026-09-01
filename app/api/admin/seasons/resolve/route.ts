import { NextResponse } from "next/server";
import { resolveSeasonForTournamentDate } from "@/features/seasons";
import { AmbiguousSeasonError, NoSeasonForDateError } from "@/lib/season-resolver";

// Preview-only: lets the create/edit tournament UI show a read-only
// "Сезон: <title>" without any client-side date-resolution logic of its
// own (see this task's "reuse the same canonical server-side resolution"
// requirement). The actual create/edit routes re-resolve independently at
// save time -- this is UX, not the authorization/validation boundary.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startAt = searchParams.get("start_at");

  if (!startAt) {
    return NextResponse.json({ error: "start_at обязателен" }, { status: 400 });
  }

  try {
    const season = await resolveSeasonForTournamentDate(startAt);
    return NextResponse.json({ season: { id: season.id, title: season.title } });
  } catch (error) {
    if (error instanceof NoSeasonForDateError || error instanceof AmbiguousSeasonError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось определить сезон" },
      { status: 500 }
    );
  }
}
