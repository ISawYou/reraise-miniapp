import { type NextRequest, NextResponse } from "next/server";
import {
  getFeaturedAchievementKeys,
  saveFeaturedAchievementKeys,
} from "@/features/featured-achievements";
import { COOKIE_NAME, verifySession } from "@/lib/telegram-web-session";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return NextResponse.json({ keys: await getFeaturedAchievementKeys(id) });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sessionPlayerId = verifySession(request.cookies.get(COOKIE_NAME)?.value ?? "");
  if (sessionPlayerId !== id) {
    return NextResponse.json({ error: "Можно менять только свой профиль" }, { status: 403 });
  }
  try {
    const body = (await request.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys) || !body.keys.every((key) => typeof key === "string")) {
      return NextResponse.json({ error: "Некорректный список достижений" }, { status: 400 });
    }
    const keys = await saveFeaturedAchievementKeys(id, body.keys);
    return NextResponse.json({ keys });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось сохранить" },
      { status: 400 },
    );
  }
}
