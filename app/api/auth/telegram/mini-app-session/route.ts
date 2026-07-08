import { type NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import type { TelegramWebAppUser } from "@/lib/telegram";
import { signSession, COOKIE_NAME } from "@/lib/telegram-web-session";
import { syncTelegramAvatar } from "@/lib/avatar-sync";

function verifyInitData(initData: string, botToken: string): boolean {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return false;

    const fields: string[] = [];
    for (const [key, value] of params.entries()) {
      if (key !== "hash") fields.push(`${key}=${value}`);
    }
    fields.sort();
    const checkString = fields.join("\n");

    // Mini App initData uses HMAC-SHA256("WebAppData", botToken) as the key
    const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
    const computed = createHmac("sha256", secretKey).update(checkString).digest("hex");

    const computedBuf = Buffer.from(computed, "hex");
    const hashBuf = Buffer.from(hash, "hex");
    if (computedBuf.length !== hashBuf.length) return false;
    return timingSafeEqual(computedBuf, hashBuf);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { initData?: string };
    const initData = body.initData ?? "";

    if (!initData) {
      return NextResponse.json({ error: "initData required" }, { status: 400 });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({ error: "bot_not_configured" }, { status: 500 });
    }

    if (!verifyInitData(initData, botToken)) {
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }

    const params = new URLSearchParams(initData);
    const authDate = parseInt(params.get("auth_date") ?? "0", 10);
    if (Math.floor(Date.now() / 1000) - authDate > 86400) {
      return NextResponse.json({ error: "expired" }, { status: 401 });
    }

    const userRaw = params.get("user");
    if (!userRaw) {
      return NextResponse.json({ error: "user_missing" }, { status: 400 });
    }

    const telegramUser = JSON.parse(userRaw) as TelegramWebAppUser;
    const player = await ensurePlayerFromTelegramUser(telegramUser);

    // Sync runs in background — don't block the auth response
    void syncTelegramAvatar(player, telegramUser.photo_url);

    const response = NextResponse.json({ ok: true, player });
    response.cookies.set(COOKIE_NAME, signSession(player.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("[mini-app-session] error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
