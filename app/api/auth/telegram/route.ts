import { NextResponse } from "next/server";
import { normalizeInternalReturnTo } from "@/lib/auth-redirect";

export async function GET(request: Request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    return NextResponse.redirect(new URL("/login?error=bot_not_configured", request.url));
  }

  const botId = botToken.split(":")[0];
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const destination = normalizeInternalReturnTo(url.searchParams.get("returnTo"));
  const returnTo = `${origin}/api/auth/telegram/callback?returnTo=${encodeURIComponent(destination)}`;

  const authUrl =
    `https://oauth.telegram.org/auth` +
    `?bot_id=${botId}` +
    `&origin=${encodeURIComponent(origin)}` +
    `&return_to=${encodeURIComponent(returnTo)}`;

  return NextResponse.redirect(authUrl);
}
