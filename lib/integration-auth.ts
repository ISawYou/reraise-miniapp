import "server-only";

import { timingSafeEqual } from "crypto";

// Auth for /api/integrations/v1/** (Poker Clock -> Re-Raise, machine-to-
// machine). Deliberately NOT covered by middleware.ts -- its matcher is
// `/api/admin/:path*` only, gated on a human session + role='admin'. This is
// a separate, static bearer credential for exactly one caller, verified with
// the same constant-time-compare primitive already used for the
// reraise_session cookie's HMAC (lib/telegram-web-session.ts) -- not
// JWT/OAuth, this app has no other machine caller to justify that.
//
// A single shared secret (not a DB-backed credentials table): today there is
// exactly one integration partner and one direction of inbound machine
// traffic. If that changes, this is the seam to replace, not extend with
// ad-hoc per-caller branching here.
function getExpectedToken(): string | null {
  const token = process.env.POKER_CLOCK_INTEGRATION_TOKEN;
  return token && token.length > 0 ? token : null;
}

// Fails closed: an unconfigured token refuses every request rather than
// silently accepting all of them. Never logs the provided or expected token
// value (only pass/fail), and never distinguishes "missing header" from
// "wrong token" in what it returns -- the caller (route handler) always maps
// `false` to a bare 401, same principle as middleware.ts's admin check.
export function verifyIntegrationRequest(request: Request): boolean {
  const expected = getExpectedToken();
  if (!expected) {
    return false;
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }

  const provided = authHeader.slice("Bearer ".length);

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);

  // timingSafeEqual throws on mismatched buffer lengths rather than
  // returning false -- length itself must not leak via a different code
  // path than a content mismatch, so this check runs before it, not instead
  // of it.
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }

  return timingSafeEqual(expectedBuf, providedBuf);
}
