import "server-only";

import { playerRepository } from "@/lib/repositories";
import { COOKIE_NAME, verifySession } from "@/lib/telegram-web-session";
import type { Player } from "@/types/domain";

// The one caller-identity resolution mechanism for everything under
// /admin -- middleware.ts (Node runtime) and the handful of Server Actions
// that are invoked directly from admin client components (bypassing
// middleware's own /api/admin/:path* matcher entirely, since Server
// Actions hit their own Next.js RPC endpoint, not that URL space -- see
// deleteTournament/updateTournament/etc. in features/tournaments.ts) both
// resolve "who is calling" through this exact code, so there is only ever
// one place that verifies a Telegram initData hash or a session cookie.
//
// Two independent entry points into the app (Telegram Mini App, re-raise.ru
// email-OTP web session) each prove identity a different way -- this
// reconciles them into "which row in `players` is asking", same reasoning
// middleware.ts's own resolveCallerLookupKey doc comment already stated
// before this was extracted out of it.
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

// Minimal duck-typed shapes -- satisfied by both NextRequest's
// `.headers`/`.cookies` (middleware.ts) and next/headers' `headers()`/
// `cookies()` (Server Actions / Route Handlers), so this one function works
// from either caller without adapting a concrete Next.js type.
export type CallerHeaders = { get(name: string): string | null };
export type CallerCookies = { get(name: string): { value: string } | undefined };

// Returns the authenticated Player, or null if no valid identity could be
// resolved (missing/invalid initData, missing/invalid session cookie, or
// the resolved player no longer exists). Never throws for "not
// authenticated" -- callers decide what to do with null (401 in
// middleware, a thrown Error in a Server Action guard).
export async function resolveAuthenticatedCaller(
  headers: CallerHeaders,
  cookies: CallerCookies
): Promise<Player | null> {
  const initData = headers.get("x-telegram-init-data");

  if (initData) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return null;
    }

    const telegramId = await verifyTelegramInitData(initData, botToken);
    if (!telegramId) {
      return null;
    }

    return playerRepository.findByTelegramId(telegramId);
  }

  const sessionCookie = cookies.get(COOKIE_NAME)?.value;
  const playerId = sessionCookie ? verifySession(sessionCookie) : null;

  if (!playerId) {
    return null;
  }

  return playerRepository.findById(playerId);
}

// Convenience wrapper for Server Actions / Route Handlers, which read the
// current request's headers/cookies via next/headers instead of an
// explicit NextRequest. NOT used by middleware.ts itself (next/headers'
// headers()/cookies() are only valid inside an actual request-handling
// scope -- Server Actions and Route Handlers, not middleware -- calling
// them from middleware would throw).
export async function resolveCurrentServerActor(): Promise<Player | null> {
  const { headers, cookies } = await import("next/headers");
  const [headerList, cookieList] = await Promise.all([headers(), cookies()]);
  return resolveAuthenticatedCaller(headerList, cookieList);
}

export class UnauthorizedActionError extends Error {
  constructor(message = "Не авторизовано") {
    super(message);
    this.name = "UnauthorizedActionError";
  }
}

export class ForbiddenActionError extends Error {
  constructor(message = "Недостаточно прав") {
    super(message);
    this.name = "ForbiddenActionError";
  }
}

// Guard for the handful of admin Server Actions invoked directly from
// client components (features/tournaments.ts's deleteTournament,
// updateTournament, addAdminTournamentParticipant,
// addExistingPlayerToTournament, removeAdminTournamentParticipant) --
// these bypass middleware.ts's /api/admin/:path* matcher entirely, since a
// Server Action hits its own Next.js RPC endpoint, not that URL. Each such
// action must authorize itself the same way a route handler would.
export async function assertServerActorRole(
  allowedRoles: readonly ("admin" | "operator")[]
): Promise<Player> {
  const actor = await resolveCurrentServerActor();

  if (!actor) {
    throw new UnauthorizedActionError();
  }

  if (!allowedRoles.includes(actor.role as "admin" | "operator")) {
    throw new ForbiddenActionError();
  }

  return actor;
}
