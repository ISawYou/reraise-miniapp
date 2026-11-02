import "server-only";

import { resolveAuthenticatedCaller, type CallerHeaders } from "@/lib/admin-auth";
import { classifyRequestOrigin } from "@/lib/request-origin";
import type { Player } from "@/types/domain";

const NO_HEADERS: CallerHeaders = { get: () => null };
const NO_COOKIES = { get: () => undefined };

export class AvatarForbiddenOriginError extends Error {
  constructor() {
    super("Недопустимый источник запроса");
    this.name = "AvatarForbiddenOriginError";
  }
}

export async function resolvePlayerAvatarActor(request: Request): Promise<Player | null> {
  const verdict = classifyRequestOrigin(request);
  if (verdict === "cross-origin") throw new AvatarForbiddenOriginError();

  const { cookies } = await import("next/headers");
  const requestCookies = await cookies();
  const cookieList = verdict === "same-origin" ? requestCookies : NO_COOKIES;
  let actor = await resolveAuthenticatedCaller(request.headers, cookieList);

  if (!actor && request.headers.get("x-telegram-init-data") && verdict === "same-origin") {
    actor = await resolveAuthenticatedCaller(NO_HEADERS, requestCookies);
  }

  return actor;
}
