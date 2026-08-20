import { type NextRequest, NextResponse } from "next/server";
import { getAcademyCourseProgress } from "@/features/academy";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

export async function GET(request: NextRequest) {
  const player = await getPlayerFromSessionServer(request.cookies.get(COOKIE_NAME)?.value);
  if (!player) return NextResponse.json({ error: "Необходимо войти в систему" }, { status: 401 });

  try {
    return NextResponse.json(await getAcademyCourseProgress(player.id));
  } catch (error) {
    console.error("[academy-progress] Failed to load progress:", error);
    return NextResponse.json(
      { error: "Не удалось загрузить прогресс Academy" },
      { status: 500 },
    );
  }
}
