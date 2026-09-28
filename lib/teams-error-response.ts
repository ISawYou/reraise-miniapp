import "server-only";

import { NextResponse } from "next/server";
import {
  TeamNotFoundError,
  TeamDisbandedError,
  InvalidTeamNameError,
  TeamNameTakenError,
  InvalidEmblemError,
  AlreadyOnActiveTeamError,
  NotCaptainError,
  CaptainCannotLeaveError,
  CaptainCannotBeRemovedError,
  NotActiveTeamMemberError,
  TeamFullError,
  InviteTargetUnavailableError,
  InvitationNotFoundError,
  InvitationNotPendingError,
  InvitationForbiddenError,
  PlayerNotFoundError,
  JoinRequestNotFoundError,
  JoinRequestNotPendingError,
  JoinRequestForbiddenError,
  AlreadyRequestedError,
  AlreadyInvitedByTeamError,
} from "@/features/teams";

// One shared error -> HTTP response mapper for every app/api/teams/**
// route, so the same domain error always produces the same status code
// regardless of which route surfaced it, instead of each route hand-rolling
// its own switch. instanceof (not error.name string-matching) so a typo or
// a future renamed class fails loudly (TS error) rather than silently
// falling through to 500.
export function teamsErrorResponse(error: unknown): NextResponse {
  if (
    error instanceof TeamNotFoundError ||
    error instanceof InvitationNotFoundError ||
    error instanceof PlayerNotFoundError ||
    error instanceof JoinRequestNotFoundError
  ) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  if (
    error instanceof TeamDisbandedError ||
    error instanceof TeamNameTakenError ||
    error instanceof AlreadyOnActiveTeamError ||
    error instanceof TeamFullError ||
    error instanceof InviteTargetUnavailableError ||
    error instanceof InvitationNotPendingError ||
    error instanceof JoinRequestNotPendingError ||
    error instanceof AlreadyRequestedError ||
    error instanceof AlreadyInvitedByTeamError
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  if (error instanceof InvalidTeamNameError || error instanceof InvalidEmblemError || error instanceof NotActiveTeamMemberError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (
    error instanceof NotCaptainError ||
    error instanceof CaptainCannotLeaveError ||
    error instanceof CaptainCannotBeRemovedError ||
    error instanceof InvitationForbiddenError ||
    error instanceof JoinRequestForbiddenError
  ) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ error: "Не удалось выполнить запрос" }, { status: 500 });
}
