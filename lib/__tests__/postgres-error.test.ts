import { describe, expect, it } from "vitest";
import { extractPostgresError } from "@/lib/db/postgres-error";

// Mirrors the two shapes production actually throws -- see
// lib/db/postgres-error.ts's header comment.

class FakePostgresError extends Error {
  code: string;
  constraint_name?: string;
  detail?: string;
  table_name?: string;
  column_name?: string;

  constructor(fields: {
    message: string;
    code: string;
    constraint_name?: string;
    detail?: string;
    table_name?: string;
    column_name?: string;
  }) {
    super(fields.message);
    this.name = "PostgresError";
    this.code = fields.code;
    this.constraint_name = fields.constraint_name;
    this.detail = fields.detail;
    this.table_name = fields.table_name;
    this.column_name = fields.column_name;
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

describe("extractPostgresError", () => {
  it("extracts code/constraint/detail from a DrizzleQueryError -> postgres.js PostgresError chain", () => {
    const pgError = new FakePostgresError({
      message: 'duplicate key value violates unique constraint "results_tournament_id_place_key"',
      code: "23505",
      constraint_name: "results_tournament_id_place_key",
      detail: "Key (tournament_id, place)=(a740e452-..., 12) already exists.",
      table_name: "results",
      column_name: undefined,
    });
    const drizzleError = new FakeDrizzleQueryError('insert into "results" (...)', [1, 2, 3], pgError);

    const info = extractPostgresError(drizzleError);

    expect(info).toEqual({
      code: "23505",
      constraint: "results_tournament_id_place_key",
      detail: "Key (tournament_id, place)=(a740e452-..., 12) already exists.",
      table: "results",
      column: undefined,
    });
  });

  it("extracts code/details from a plain Error({cause}) wrapping a Supabase-style PostgrestError", () => {
    const postgrestError = {
      message: 'duplicate key value violates unique constraint "results_tournament_id_place_key"',
      code: "23505",
      details: "Key (tournament_id, place)=(a740e452-..., 12) already exists.",
      hint: null,
    };
    const wrapped = new Error(postgrestError.message, { cause: postgrestError });

    const info = extractPostgresError(wrapped);

    expect(info).toEqual({
      code: "23505",
      constraint: undefined,
      detail: "Key (tournament_id, place)=(a740e452-..., 12) already exists.",
      table: undefined,
      column: undefined,
    });
  });

  it("returns null when there is no code anywhere in the cause chain", () => {
    expect(extractPostgresError(new Error("Для турнира нет live-данных"))).toBeNull();
  });

  it("returns null for a non-error value", () => {
    expect(extractPostgresError("just a string")).toBeNull();
    expect(extractPostgresError(null)).toBeNull();
    expect(extractPostgresError(undefined)).toBeNull();
  });

  it("does not treat an arbitrary short string field as a SQLSTATE code", () => {
    const notPg = new Error("boom");
    Object.assign(notPg, { code: "ENOENT" }); // 6 chars -- not a 5-char SQLSTATE
    expect(extractPostgresError(notPg)).toBeNull();
  });

  it("stops walking after MAX_CAUSE_DEPTH to avoid infinite loops on cyclic causes", () => {
    const a: Error & { cause?: unknown } = new Error("a");
    const b: Error & { cause?: unknown } = new Error("b");
    a.cause = b;
    b.cause = a; // cyclic

    expect(() => extractPostgresError(a)).not.toThrow();
    expect(extractPostgresError(a)).toBeNull();
  });
});
