import "server-only";

import { timingSafeEqual } from "crypto";

// Auth for /api/internal/finance/tournaments (RERAISE Finance -> RERAISE
// main, machine-to-machine, read-only). Same shape as
// lib/integration-auth.ts's Poker Clock credential (constant-time bearer
// compare, single static secret, fails closed) but deliberately a SEPARATE
// env var/function -- FINANCE_SYNC_TOKEN is not POKER_CLOCK_INTEGRATION_TOKEN,
// and Finance must never be able to authenticate as Poker Clock or vice
// versa. Not covered by middleware.ts, same reasoning as
// lib/integration-auth.ts.
function getExpectedToken(): string | null {
  const token = process.env.FINANCE_SYNC_TOKEN;
  return token && token.length > 0 ? token : null;
}

// Fails closed: an unconfigured token refuses every request rather than
// silently accepting all of them -- if FINANCE_SYNC_TOKEN is never set, this
// endpoint stays permanently disabled. Never logs the provided or expected
// token value (only pass/fail), and never distinguishes "missing header"
// from "wrong token" in what it returns -- the caller (route handler)
// always maps `false` to a bare 401.
export function verifyFinanceSyncRequest(request: Request): boolean {
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
