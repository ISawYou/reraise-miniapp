import { type NextRequest, NextResponse } from "next/server";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import {
  ClubActivityNotFoundError,
  toggleClubActivityLike,
} from "@/features/club-activity";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const player = await getPlayerFromSessionServer(request.cookies.get(COOKIE_NAME)?.value);
  if (!player) return NextResponse.json({ error: "Необходимо войти в систему" }, { status: 401 });

  try {
    const { id } = await context.params;
    return NextResponse.json(await toggleClubActivityLike(id, player.id));
  } catch (error) {
    if (error instanceof ClubActivityNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("[POST /api/club-activity/[id]/like] error:", error);
    return NextResponse.json({ error: "Не удалось изменить отметку" }, { status: 500 });
  }
}
