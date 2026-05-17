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

export async function middleware(request: NextRequest) {
  const initData = request.headers.get("x-telegram-init-data");
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!initData) {
    console.log("[admin-auth] 401: no x-telegram-init-data header");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!botToken) {
    console.log("[admin-auth] 401: TELEGRAM_BOT_TOKEN not configured");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const telegramId = await verifyTelegramInitData(initData, botToken);

  if (!telegramId) {
    console.log("[admin-auth] 401: initData verification failed (hash mismatch or expired)", {
      initDataLength: initData.length,
      hasHash: new URLSearchParams(initData).has("hash"),
      hasUser: new URLSearchParams(initData).has("user"),
    });
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
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (!player) {
    console.log("[admin-auth] 401: player not found for telegram_id", telegramId);
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
