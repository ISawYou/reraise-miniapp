import "server-only";

import { extractPostgresError } from "@/lib/db/postgres-error";
import { ResultPlaceValidationError } from "@/lib/tournament-results-validation";

// Shared by the two tournament-completion API routes
// (app/api/admin/tournaments/[id]/complete-free/route.ts and
// .../complete-live/route.ts) so the "how do we classify/log a completion
// failure" decision lives in exactly one place instead of being
// copy-pasted per route.

export const RESULTS_PLACE_UNIQUE_CONSTRAINT = "results_tournament_id_place_key";

const DUPLICATE_PLACE_MESSAGE =
  "Двум игрокам назначено одинаковое место в турнире. Исправьте места и повторите завершение турнира.";

export type CompletionErrorResolution = {
  status: number;
  message: string;
  expected: boolean;
};

// Maps a thrown error from a completion flow to an HTTP status + a message
// that is safe to show an admin -- never the raw Drizzle "Failed query:
// ... params: ..." text. Two "expected" cases short-circuit the generic
// 500: our own pre-insert validation (ResultPlaceValidationError), and the
// DB's own unique-constraint rejection as a defensive fallback for the same
// problem (a race, or a request that bypassed the app's validation).
export function resolveCompletionError(error: unknown): CompletionErrorResolution {
  if (error instanceof ResultPlaceValidationError) {
    return { status: 400, message: error.message, expected: true };
  }

  const pg = extractPostgresError(error);
  if (pg?.code === "23505" && pg.constraint === RESULTS_PLACE_UNIQUE_CONSTRAINT) {
    return { status: 409, message: DUPLICATE_PLACE_MESSAGE, expected: true };
  }

  return {
    status: 500,
    message: error instanceof Error ? error.message : "Не удалось завершить турнир",
    expected: false,
  };
}

// Logs enough to diagnose an unexpected failure in production (tournament
// id, route/operation, error name/message, DB code/constraint/detail when
// available via `cause`) without ever logging the full player payload or
// other PII, and without a full stack trace for an already-understood
// validation rejection.
export function logCompletionError(params: {
  operation: string;
  tournamentId: string;
  error: unknown;
}): void {
  const { operation, tournamentId, error } = params;
  const { expected } = resolveCompletionError(error);
  const pg = extractPostgresError(error);

  const context: Record<string, unknown> = {
    tournamentId,
    operation,
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  };

  if (pg) {
    context.pgCode = pg.code;
    context.pgConstraint = pg.constraint;
    context.pgDetail = pg.detail;
  }

  if (expected) {
    console.warn(`[${operation}] завершение турнира отклонено`, context);
    return;
  }

  if (error instanceof Error && error.stack) {
    context.stack = error.stack;
  }

  console.error(`[${operation}] неожиданная ошибка завершения турнира`, context);
}
