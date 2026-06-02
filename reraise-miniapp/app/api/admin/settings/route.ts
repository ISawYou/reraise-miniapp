import { type NextRequest, NextResponse } from "next/server";
import { getAppSetting, setAppSetting } from "@/lib/app-settings";
import { getPlayerByIdServer } from "@/features/auth-server";
import { verifySession, COOKIE_NAME } from "@/lib/telegram-web-session";

// Public read — the flag is not sensitive
export async function GET() {
  try {
    const value = await getAppSetting("show_email_link_prompt");
    return NextResponse.json({ show_email_link_prompt: value === true });
  } catch (error) {
    console.error("[settings] GET error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

// Admin-only write
export async function PATCH(request: NextRequest) {
  try {
    const sessionValue = request.cookies.get(COOKIE_NAME)?.value;
    const playerId = sessionValue ? verifySession(sessionValue) : null;
    if (!playerId) {
      return NextResponse.json({ error: "Необходимо войти в систему" }, { status: 401 });
    }

    const player = await getPlayerByIdServer(playerId);
    if (!player || player.role !== "admin") {
      return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
    }

    const body = (await request.json()) as { show_email_link_prompt?: boolean };
    if (typeof body.show_email_link_prompt !== "boolean") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    await setAppSetting("show_email_link_prompt", body.show_email_link_prompt);
    return NextResponse.json({ ok: true, show_email_link_prompt: body.show_email_link_prompt });
  } catch (error) {
    console.error("[settings] PATCH error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
