import { type NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

function isSameOriginLogout(request: NextRequest): boolean {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");

  if (origin) return origin === requestOrigin;

  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === "same-origin" || fetchSite === "none";
}

export async function POST(request: NextRequest) {
  if (!isSameOriginLogout(request)) {
    return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  }

  const response = NextResponse.json({ ok: true });

  // Clearing the HttpOnly cookie must happen on the server. The path and
  // security attributes match the session cookies issued by web login and
  // the Mini App; repeating the request is intentionally harmless.
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 0,
    expires: new Date(0),
    path: "/",
  });

  return response;
}
