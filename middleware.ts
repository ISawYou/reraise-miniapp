import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

// Mirrors lib/telegram-web-session.ts's COOKIE_NAME -- can't import that
// module directly (it pulls in Node's `crypto`, which breaks the Edge
// Runtime build, same reason this file already carries its own inline
// Supabase client and its own Telegram HMAC check instead of importing
// PlayerRepository).
const SESSION_COOKIE_NAME = "reraise_session";

// Edge-Runtime-compatible re-implementation of lib/telegram-web-session.ts's
// verifySession() -- same algorithm (HMAC-SHA256 over the player id, same
// "playerId.mac" hex format, same SESSION_SECRET), just using Web Crypto
// instead of Node's `crypto`/`Buffer` (unavailable here). Not a second
// session scheme, just this one made reachable from Edge middleware.
async function verifySessionCookie(value: string): Promise<string | null> {
  const dot = value.lastIndexOf(".");
  if (dot === -1) return null;

  const playerId = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const secret = process.env.SESSION_SECRET || "dev-insecure-secret";

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(playerId));
    const expectedMac = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (mac.length !== expectedMac.length) return null;

    // Constant-time compare (timingSafeEqual isn't available here either).
    let diff = 0;
    for (let i = 0; i < mac.length; i += 1) {
      diff |= mac.charCodeAt(i) ^ expectedMac.charCodeAt(i);
    }
    return diff === 0 ? playerId : null;
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

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const playerId = sessionCookie ? await verifySessionCookie(sessionCookie) : null;

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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: player } = await supabase
    .from("players")
    .select("role")
    .eq(lookupKey.column, lookupKey.value)
    .maybeSingle();

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
  matcher: ["/api/admin/:path*"],
};
