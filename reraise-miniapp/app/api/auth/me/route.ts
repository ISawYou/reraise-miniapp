import { type NextRequest, NextResponse } from "next/server";
import { getPlayerById } from "@/features/auth";
import { verifySession, COOKIE_NAME } from "@/lib/telegram-web-session";

export async function GET(request: NextRequest) {
  const cookieValue = request.cookies.get(COOKIE_NAME)?.value;

  if (!cookieValue) {
    return NextResponse.json({ error: "No session" }, { status: 401 });
  }

  const playerId = verifySession(cookieValue);

  if (!playerId) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  try {
    const player = await getPlayerById(playerId);

    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    return NextResponse.json({ player });
  } catch {
    return NextResponse.json({ error: "Failed to load player" }, { status: 500 });
  }
}
