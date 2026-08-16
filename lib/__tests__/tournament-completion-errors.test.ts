import { afterEach, describe, expect, it, vi } from "vitest";
import {
  logCompletionError,
  resolveCompletionError,
  RESULTS_PLACE_UNIQUE_CONSTRAINT,
} from "@/lib/tournament-completion-errors";
import { ResultPlaceValidationError } from "@/lib/tournament-results-validation";

class FakePostgresError extends Error {
  code: string;
  constraint_name?: string;
  detail?: string;

  constructor(fields: { message: string; code: string; constraint_name?: string; detail?: string }) {
    super(fields.message);
    this.name = "PostgresError";
    this.code = fields.code;
    this.constraint_name = fields.constraint_name;
    this.detail = fields.detail;
  }
}

class FakeDrizzleQueryError extends Error {
  cause: unknown;

  constructor(query: string, params: unknown[], cause: unknown) {
    super(`Failed query: ${query}\nparams: ${params}`);
    this.name = "DrizzleQueryError";
    this.cause = cause;
  }
}

function duplicatePlaceDbError() {
  const pgError = new FakePostgresError({
    message: 'duplicate key value violates unique constraint "results_tournament_id_place_key"',
    code: "23505",
    constraint_name: RESULTS_PLACE_UNIQUE_CONSTRAINT,
    detail: "Key (tournament_id, place)=(a740e452-..., 12) already exists.",
  });
  return new FakeDrizzleQueryError(
    'insert into "results" (...) values (...)',
    [1, 2, 3],
    pgError
  );
}

describe("resolveCompletionError", () => {
  it("maps ResultPlaceValidationError to a 400 with the exact validation message", () => {
    const error = new ResultPlaceValidationError(
      "Место 12 указано у нескольких игроков: A, B. Исправьте места перед завершением турнира."
    );

    expect(resolveCompletionError(error)).toEqual({
      status: 400,
      message: error.message,
      expected: true,
    });
  });

  it("maps a 23505 on results_tournament_id_place_key to a friendly 409 (defensive DB fallback)", () => {
    const resolution = resolveCompletionError(duplicatePlaceDbError());

    expect(resolution.status).toBe(409);
    expect(resolution.expected).toBe(true);
    // The known scenario must never leak the raw "Failed query: ... params:
    // ..." text to the client.
    expect(resolution.message).not.toMatch(/Failed query/i);
    expect(resolution.message).not.toMatch(/insert into/i);
    expect(resolution.message.toLowerCase()).toContain("место");
  });

  it("does not treat an unrelated unique-violation (different constraint) as the known scenario", () => {
    const pgError = new FakePostgresError({
      message: 'duplicate key value violates unique constraint "results_tournament_id_player_id_key"',
      code: "23505",
      constraint_name: "results_tournament_id_player_id_key",
    });
    const error = new FakeDrizzleQueryError("insert into ...", [], pgError);

    const resolution = resolveCompletionError(error);

    expect(resolution.status).toBe(500);
    expect(resolution.expected).toBe(false);
  });

  it("falls back to a generic 500 for a genuinely unexpected error", () => {
    const resolution = resolveCompletionError(new Error("Для турнира нет live-данных"));

    expect(resolution).toEqual({
      status: 500,
      message: "Для турнира нет live-данных",
      expected: false,
    });
  });

  it("falls back to a generic message for a non-Error throw", () => {
    const resolution = resolveCompletionError("boom");

    expect(resolution.status).toBe(500);
    expect(resolution.expected).toBe(false);
    expect(resolution.message).toBe("Не удалось завершить турнир");
  });
});

describe("logCompletionError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs an expected validation error via console.warn with tournament id/operation, no stack", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logCompletionError({
      operation: "complete-free",
      tournamentId: "t-1",
      error: new ResultPlaceValidationError("Место 12 указано у нескольких игроков: A, B."),
    });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const [, context] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(context.tournamentId).toBe("t-1");
    expect(context.operation).toBe("complete-free");
    expect(context.name).toBe("ResultPlaceValidationError");
    expect(context).not.toHaveProperty("stack");
  });

  it("logs the defensive 23505 fallback via console.warn with pgCode/pgConstraint/pgDetail", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logCompletionError({
      operation: "complete-live",
      tournamentId: "t-2",
      error: duplicatePlaceDbError(),
    });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const [, context] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(context.tournamentId).toBe("t-2");
    expect(context.operation).toBe("complete-live");
    expect(context.pgCode).toBe("23505");
    expect(context.pgConstraint).toBe(RESULTS_PLACE_UNIQUE_CONSTRAINT);
    expect(context.pgDetail).toContain("already exists");
  });

  it("logs an unexpected error via console.error with a stack, and no PII/payload fields", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logCompletionError({
      operation: "complete-free",
      tournamentId: "t-3",
      error: new Error("Unexpected DB outage"),
    });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);

    const [, context] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(context.tournamentId).toBe("t-3");
    expect(context.operation).toBe("complete-free");
    expect(context.message).toBe("Unexpected DB outage");
    expect(context).toHaveProperty("stack");
    // No player roster / payload fields should ever be logged.
    expect(context).not.toHaveProperty("rows");
    expect(context).not.toHaveProperty("players");
  });
});
