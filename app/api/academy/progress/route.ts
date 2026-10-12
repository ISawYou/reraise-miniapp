import { type NextRequest, NextResponse } from "next/server";
import {
  getAcademyCourseProgress,
  getAcademySpotProgress,
  getAllAcademyCoursesProgress,
  type AcademyProgressResponse,
} from "@/features/academy";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

export async function GET(request: NextRequest) {
  const player = await getPlayerFromSessionServer(request.cookies.get(COOKIE_NAME)?.value);
  if (!player) return NextResponse.json({ error: "Необходимо войти в систему" }, { status: 401 });

  try {
    // Top-level fields keep the original single-course (База MTT) shape;
    // `courses` is additive: one payload per catalog course; `spots` is
    // additive too: per-spot practice progress (config/academy/spot-progress.ts).
    const [primary, all, spots] = await Promise.all([
      getAcademyCourseProgress(player.id),
      getAllAcademyCoursesProgress(player.id),
      getAcademySpotProgress(player.id),
    ]);
    const payload: AcademyProgressResponse = { ...primary, courses: all.courses, spots };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[academy-progress] Failed to load progress:", error);
    return NextResponse.json(
      { error: "Не удалось загрузить прогресс Academy" },
      { status: 500 },
    );
  }
}
