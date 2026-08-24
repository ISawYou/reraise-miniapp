import { type NextRequest, NextResponse } from "next/server";
import { getPublishedClubActivity } from "@/features/club-activity";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

export async function GET(request: NextRequest) {
  try {
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "20");
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
    const player = await getPlayerFromSessionServer(request.cookies.get(COOKIE_NAME)?.value);
    const events = await getPublishedClubActivity(
      Number.isFinite(limit) ? limit : 20,
      Number.isFinite(offset) ? offset : 0,
      player?.id,
    );
    return NextResponse.json({ events });
  } catch (error) {
    console.error("[GET /api/club-activity] error:", error);
    return NextResponse.json({ error: "Не удалось загрузить ленту" }, { status: 500 });
  }
}
