import { NextResponse, type NextRequest } from "next/server";
import { resolveAuthenticatedCaller } from "@/lib/admin-auth";
import { isAdminRouteAllowedForOperator } from "@/lib/admin-permissions";

// Three-tier authorization for every /api/admin/** route:
// - 'admin' (Super Admin): unrestricted, exactly today's behavior.
// - 'operator': only the explicit allowlist in lib/admin-permissions.ts --
//   FAILS CLOSED, a route with no entry there is denied by default.
// - 'player' or unauthenticated: no access at all.
//
// Caller identity resolution itself lives in lib/admin-auth.ts (shared
// with the handful of admin Server Actions that bypass this matcher
// entirely -- see that file's doc comment).
export async function middleware(request: NextRequest) {
  const caller = await resolveAuthenticatedCaller(request.headers, request.cookies);

  if (!caller) {
    console.log("[admin-auth] 401: no authenticated caller resolved");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (caller.role === "admin") {
    return NextResponse.next();
  }

  if (caller.role === "operator") {
    const { pathname } = request.nextUrl;

    if (isAdminRouteAllowedForOperator(request.method, pathname)) {
      return NextResponse.next();
    }

    console.log("[admin-auth] 403: operator denied for route not on the allowlist", {
      method: request.method,
      pathname,
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export const config = {
  runtime: "nodejs",
  matcher: ["/api/admin/:path*"],
};
