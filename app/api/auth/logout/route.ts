import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

export async function POST() {
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
