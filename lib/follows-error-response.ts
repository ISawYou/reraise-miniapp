import "server-only";

import { NextResponse } from "next/server";
import { FollowForbiddenOriginError, FollowUnauthorizedError } from "@/lib/follows-auth";
import {
  FollowFailedError,
  FollowListFailedError,
  FollowSummaryFailedError,
  FollowTargetMergedError,
  FollowTargetNotFoundError,
  InvalidFollowPlayerIdError,
  SelfFollowError,
  UnfollowFailedError,
} from "@/features/follows";

// One error -> HTTP response mapper for every follow route (same instanceof
// style as lib/teams-error-response.ts). Unlike that mapper there is NO
// branch that forwards an arbitrary error.message: anything that is not one
// of the known domain errors below is logged server-side and answered with
// the route's fixed, safe fallback text, so raw database / runtime text can
// never reach a client.
export function followsErrorResponse(
  error: unknown,
  fallbackMessage = "Не удалось выполнить запрос"
): NextResponse {
  if (error instanceof FollowUnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  if (error instanceof FollowForbiddenOriginError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  if (error instanceof InvalidFollowPlayerIdError || error instanceof SelfFollowError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (error instanceof FollowTargetNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  if (error instanceof FollowTargetMergedError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  if (
    error instanceof FollowFailedError ||
    error instanceof UnfollowFailedError ||
    error instanceof FollowSummaryFailedError ||
    error instanceof FollowListFailedError
  ) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.error("[follows-error-response] unexpected error:", error);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
