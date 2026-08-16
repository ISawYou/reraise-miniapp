// Best-effort extraction of the underlying Postgres/PostgREST error fields
// from a thrown error's `cause` chain, without ever re-parsing SQL text.
//
// - Postgres provider: db.execute(sql...) throws drizzle-orm's
//   DrizzleQueryError (message = "Failed query: ... params: ..."), whose
//   `.cause` is the postgres.js PostgresError -- `code`, `constraint_name`,
//   `detail`, `table_name`, `column_name` (see
//   node_modules/postgres/cjs/src/errors.js and connection.js).
// - Supabase provider: SupabaseResultRepository wraps the PostgrestError as
//   `new Error(message, { cause: postgrestError })` -- `code`, `details`
//   (plural), no table/column fields.
//
// Walking `.cause` generically (rather than hardcoding either shape) keeps
// this working for both DATABASE_PROVIDER values.

export type PostgresErrorInfo = {
  code: string;
  constraint?: string;
  detail?: string;
  table?: string;
  column?: string;
};

const MAX_CAUSE_DEPTH = 5;
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

function isPostgresErrorLike(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const code = (value as Record<string, unknown>).code;
  return typeof code === "string" && SQLSTATE_PATTERN.test(code);
}

export function extractPostgresError(error: unknown): PostgresErrorInfo | null {
  let current: unknown = error;

  for (let depth = 0; current != null && depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (isPostgresErrorLike(current)) {
      const raw = current;
      return {
        code: raw.code as string,
        constraint: (raw.constraint_name ?? raw.constraint) as string | undefined,
        detail: (raw.detail ?? raw.details) as string | undefined,
        table: (raw.table_name ?? raw.table) as string | undefined,
        column: (raw.column_name ?? raw.column) as string | undefined,
      };
    }

    current = current instanceof Error ? current.cause : undefined;
  }

  return null;
}
