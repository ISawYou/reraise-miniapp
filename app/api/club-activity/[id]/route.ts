import { type NextRequest, NextResponse } from "next/server";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import {
  ClubActivityNotFoundError,
  getPublishedClubActivityDetail,
} from "@/features/club-activity";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const [{ id }, player] = await Promise.all([
      context.params,
      getPlayerFromSessionServer(request.cookies.get(COOKIE_NAME)?.value),
    ]);
    return NextResponse.json(await getPublishedClubActivityDetail(id, player?.id));
  } catch (error) {
    if (error instanceof ClubActivityNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("[GET /api/club-activity/[id]] error:", error);
    return NextResponse.json({ error: "Не удалось загрузить публикацию" }, { status: 500 });
  }
}
