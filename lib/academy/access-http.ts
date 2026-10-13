import "server-only";

import { NextResponse } from "next/server";
import { ACADEMY_ACCESS_COPY, ACADEMY_ACCESS_DENIED_CODE } from "@/config/academy/access-copy";
import { AcademyAccessDeniedError } from "@/features/academy-access";

/**
 * The one HTTP shape of a denied Academy API call: 403 (authenticated, not
 * entitled — never 401) with a stable Russian message and machine code, and
 * NOTHING else (no question, range or reveal data).
 */
export function academyAccessDeniedResponse(): NextResponse {
  return NextResponse.json(
    { error: ACADEMY_ACCESS_COPY.apiDenied, code: ACADEMY_ACCESS_DENIED_CODE },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

/** The 403 response when `error` is an access denial, otherwise null (the route keeps its own handling). */
export function academyAccessErrorResponse(error: unknown): NextResponse | null {
  return error instanceof AcademyAccessDeniedError ? academyAccessDeniedResponse() : null;
}
