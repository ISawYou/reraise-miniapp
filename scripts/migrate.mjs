// Applies Drizzle migrations directly via drizzle-orm, bypassing the
// `drizzle-kit migrate` CLI.
//
// Why: drizzle-kit 0.31.10's progress view for the `migrate` command
// (MigrateProgress, in drizzle-kit/bin.cjs) renders the exact same
// "applying migrations..." text for both the "pending" and "rejected"
// states — it never prints the actual error. So on any real failure (wrong
// credentials, unreachable host, missing/corrupt migration files,
// insufficient privileges...) the CLI just stops after "Using 'postgres'
// driver for database querying" with no further output and exit code 1,
// looking exactly like it silently did nothing. This is the same bug
// documented (and reproduced) in poker-clock's MIGRATION_RETROSPECTIVE.md —
// carried the fix forward rather than rediscovering it here.
//
// This script calls the same underlying function drizzle-kit's CLI calls
// internally (drizzle-orm/postgres-js/migrator's `migrate`), so behavior on
// success is identical — only the error path differs: real errors are
// printed in full instead of swallowed.
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const MIGRATIONS_FOLDER = "./lib/db/migrations";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL environment variable");
  }

  const migrationClient = postgres(connectionString, { max: 1 });
  try {
    const db = drizzle(migrationClient);
    console.log(`Applying migrations from ${MIGRATIONS_FOLDER} ...`);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log("Migrations applied successfully.");
  } finally {
    await migrationClient.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:");
  console.error(err);
  process.exit(1);
});
