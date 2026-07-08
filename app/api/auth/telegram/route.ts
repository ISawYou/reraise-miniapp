import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    return NextResponse.redirect(new URL("/login?error=bot_not_configured", request.url));
  }

  const botId = botToken.split(":")[0];
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const returnTo = `${origin}/api/auth/telegram/callback`;

  const authUrl =
    `https://oauth.telegram.org/auth` +
    `?bot_id=${botId}` +
    `&origin=${encodeURIComponent(origin)}` +
    `&return_to=${encodeURIComponent(returnTo)}`;

  return NextResponse.redirect(authUrl);
}
