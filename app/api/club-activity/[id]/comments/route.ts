import { type NextRequest, NextResponse } from "next/server";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import {
  ClubActivityNotFoundError,
  ClubActivityValidationError,
  createClubActivityComment,
} from "@/features/club-activity";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const player = await getPlayerFromSessionServer(request.cookies.get(COOKIE_NAME)?.value);
  if (!player) return NextResponse.json({ error: "Необходимо войти в систему" }, { status: 401 });

  try {
    const [{ id }, payload] = await Promise.all([
      context.params,
      request.json() as Promise<{ body?: unknown }>,
    ]);
    const comment = await createClubActivityComment(id, player.id, payload.body);
    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    if (error instanceof ClubActivityNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ClubActivityValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[POST /api/club-activity/[id]/comments] error:", error);
    return NextResponse.json({ error: "Не удалось добавить комментарий" }, { status: 500 });
  }
}
