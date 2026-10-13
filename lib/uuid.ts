// Any canonical 8-4-4-4-12 hex UUID (version/variant-agnostic, same as what
// Postgres' uuid type accepts). Used to reject malformed path ids BEFORE they
// reach a query, so a bad id never surfaces Postgres' "invalid input syntax
// for type uuid" text to a client.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
