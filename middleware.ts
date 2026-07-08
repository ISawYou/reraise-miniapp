import { NextResponse, type NextRequest } from "next/server";
import { playerRepository } from "@/lib/repositories";
import { COOKIE_NAME, verifySession } from "@/lib/telegram-web-session";

async function verifyTelegramInitData(
  initData: string,
  botToken: string
): Promise<number | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) {
    return null;
  }

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const encoder = new TextEncoder();

  const webAppKeyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const secretKey = await crypto.subtle.sign(
    "HMAC",
    webAppKeyMaterial,
    encoder.encode(botToken)
  );

  const secretKeyImported = await crypto.subtle.importKey(
    "raw",
    secretKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    secretKeyImported,
    encoder.encode(dataCheckString)
  );

  const computedHash = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (computedHash !== hash) {
    return null;
  }

  const authDate = params.get("auth_date");

  if (authDate !== null) {
    const authDateSeconds = parseInt(authDate, 10);
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (isNaN(authDateSeconds) || nowSeconds - authDateSeconds > 3600) {
      return null;
    }
  }

  const userRaw = params.get("user");

  if (!userRaw) {
    return null;
  }

  try {
    const user = JSON.parse(userRaw) as { id: number };
    return user.id ?? null;
  } catch {
    return null;
  }
}

type PlayerLookupKey =
  | { column: "telegram_id"; value: number }
  | { column: "id"; value: string };

// The two independent entry points into the app (Telegram Mini App on
// Vercel, re-raise.ru's email-OTP web session) each prove identity a
// different way -- this is the one place that reconciles them into "which
// row in `players` is asking". The role check itself stays a single shared
// block in `middleware()` below, regardless of which path resolved the
// caller.
async function resolveCallerLookupKey(request: NextRequest): Promise<PlayerLookupKey | null> {
  const initData = request.headers.get("x-telegram-init-data");

  if (initData) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.log("[admin-auth] 401: TELEGRAM_BOT_TOKEN not configured");
      return null;
    }

    const telegramId = await verifyTelegramInitData(initData, botToken);
    if (!telegramId) {
      console.log("[admin-auth] 401: initData verification failed (hash mismatch or expired)", {
        initDataLength: initData.length,
        hasHash: new URLSearchParams(initData).has("hash"),
        hasUser: new URLSearchParams(initData).has("user"),
      });
      return null;
    }

    return { column: "telegram_id", value: telegramId };
  }

  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const playerId = sessionCookie ? verifySession(sessionCookie) : null;

  if (!playerId) {
    console.log("[admin-auth] 401: no x-telegram-init-data header and no valid reraise_session cookie");
    return null;
  }

  return { column: "id", value: playerId };
}

export async function middleware(request: NextRequest) {
  const lookupKey = await resolveCallerLookupKey(request);

  if (!lookupKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const player =
    lookupKey.column === "telegram_id"
      ? await playerRepository.findByTelegramId(lookupKey.value)
      : await playerRepository.findById(lookupKey.value);

  if (!player) {
    console.log("[admin-auth] 401: player not found", lookupKey);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (player.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  runtime: "nodejs",
  matcher: ["/api/admin/:path*"],
};
