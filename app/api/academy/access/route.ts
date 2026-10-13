import { type NextRequest, NextResponse } from "next/server";
import type { AcademyAccessView } from "@/config/academy/access-copy";
import { getAcademyAccess } from "@/features/academy-access";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

/**
 * The authenticated player's Academy tier — ONLY `{ access, season }`
 * (no attendance / result details). Recomputed on every request (no-store),
 * so a player marked "Пришёл" unlocks on the next Academy check.
 */
export async function GET(request: NextRequest) {
  const player = await getPlayerFromSessionServer(request.cookies.get(COOKIE_NAME)?.value);
  if (!player) return NextResponse.json({ error: "Необходимо войти в систему" }, { status: 401 });

  try {
    const view = await getAcademyAccess(player);
    const payload: AcademyAccessView = {
      access: view.access,
      season: view.season ? { id: view.season.id, title: view.season.title } : null,
    };
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[academy-access] Failed to resolve access:", error);
    return NextResponse.json({ error: "Не удалось проверить доступ к Академии" }, { status: 500 });
  }
}
