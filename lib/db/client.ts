import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let _db: DrizzleDb | null = null;

function getDb(): DrizzleDb {
  if (_db) return _db;

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("Missing DATABASE_URL environment variable");
  }

  const queryClient = postgres(connectionString);
  _db = drizzle(queryClient, { schema });
  return _db;
}

// Lazy proxy — defers DATABASE_URL validation to first query, not module
// load time. Nothing imports this yet (DATABASE_PROVIDER isn't read
// anywhere), but when a PostgresXxxRepository eventually does, this must not
// throw at startup in any environment that still lacks DATABASE_URL (every
// environment today) — same reasoning lib/database/supabase/server.ts
// applies to getSupabaseServer().
export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop) {
    const client = getDb();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});
