import "server-only";

import { resolveAuthenticatedCaller, type CallerHeaders } from "@/lib/admin-auth";
import { classifyRequestOrigin } from "@/lib/request-origin";
import type { Player } from "@/types/domain";

// THE one entry point every follow API route uses to find out who is calling
// -- never a client-supplied player id. Same shape as lib/teams-auth.ts
// (resolveCurrentServerActor: HMAC-verified `X-Telegram-Init-Data` header OR
// the signed `reraise_session` cookie, canonical-merge resolution), plus:
//
// 1. A blocked player is never a viewer (follow writes are denied; follow
//    reads simply treat them as anonymous). Blocked TARGETS stay followable --
//    that is a feature-layer rule (features/follows.ts), not an auth one.
//
// 2. STALE-initData COOKIE FALLBACK (scoped to follows ONLY).
//    resolveAuthenticatedCaller returns null as soon as an initData header is
//    PRESENT but invalid/expired (it verifies auth_date <= 1h, while the
//    client keeps and re-sends initData for up to 24h -- lib/telegram.ts), and
//    it never looks at the cookie in that case. So a Mini App left open for
//    over an hour would 401 every follow request even though the viewer holds
//    a perfectly valid signed session cookie. When the header path yields no
//    actor we therefore retry ONCE with the cookie alone.
//
//    This is not an auth downgrade:
//    - the Telegram HMAC check is untouched (it still runs, unmodified, in
//      resolveAuthenticatedCaller) and invalid/expired initData NEVER
//      authenticates anyone by itself;
//    - the cookie is its own independently signed credential
//      (lib/telegram-web-session.ts verifySession, HMAC over the player id);
//    - the retry sees the cookie jar only -- the header is withheld, so there
//      is no way for header content to influence the cookie path;
//    - a header that resolved to ANY actor (even a blocked one) is final: we
//      never fall through to a different identity after a successful header
//      resolution.
//    Teams/admin/middleware keep their current behavior: lib/admin-auth.ts is
//    deliberately not modified.
//
//    Known limitation: resolveAuthenticatedCaller reports a cryptographically
//    VALID header whose Telegram user has no players row the same way as an
//    invalid one (null), so that rare case also reaches the cookie retry. The
//    outcome is still an independently verified identity (the cookie's), never
//    an unverified one.

//
// 3. CSRF GATE FOR MUTATIONS (assertFollowMutationOrigin below). The session
//    cookie is SameSite=None in production, so a cross-site page could make a
//    victim's browser send it to POST/DELETE /api/players/:id/follow. Mutations
//    therefore run the Origin check first: a foreign Origin is refused, and a
//    request with NO same-origin evidence may authenticate ONLY through a
//    verified initData header -- the cookie jar is withheld. This decides
//    whether ambient cookies may be used; it never identifies anybody.

const NO_HEADERS: CallerHeaders = { get: () => null };
const NO_COOKIES = { get: () => undefined };

export class FollowForbiddenOriginError extends Error {
  constructor(message = "Недопустимый источник запроса") {
    super(message);
    this.name = "FollowForbiddenOriginError";
  }
}

// Throws FollowForbiddenOriginError (403) for a cross-origin request;
// otherwise says whether the session cookie may be honoured for this request.
export function assertFollowMutationOrigin(request: Request): { allowCookie: boolean } {
  const verdict = classifyRequestOrigin(request);

  if (verdict === "cross-origin") {
    console.warn("[follows-auth] mutation refused: cross-origin request", {
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
    });
    throw new FollowForbiddenOriginError();
  }

  return { allowCookie: verdict === "same-origin" };
}

export type FollowViewerOptions = {
  // false: ignore the session cookie entirely (initData header only).
  allowCookie?: boolean;
};

export class FollowUnauthorizedError extends Error {
  constructor(message = "Необходимо войти в систему") {
    super(message);
    this.name = "FollowUnauthorizedError";
  }
}

// getViewer(): the authenticated, non-blocked, canonical player, or null.
export async function resolveFollowViewer(options: FollowViewerOptions = {}): Promise<Player | null> {
  const { headers, cookies } = await import("next/headers");
  const [headerList, requestCookies] = await Promise.all([headers(), cookies()]);
  const cookieList = options.allowCookie === false ? NO_COOKIES : requestCookies;

  let actor = await resolveAuthenticatedCaller(headerList, cookieList);

  if (!actor && headerList.get("x-telegram-init-data")) {
    actor = await resolveAuthenticatedCaller(NO_HEADERS, cookieList);
  }

  if (!actor || actor.is_blocked) {
    return null;
  }

  return actor;
}

// requireViewer(): throws FollowUnauthorizedError (401) when there is none.
export async function requireFollowViewer(options: FollowViewerOptions = {}): Promise<Player> {
  const viewer = await resolveFollowViewer(options);
  if (!viewer) {
    throw new FollowUnauthorizedError();
  }
  return viewer;
}
