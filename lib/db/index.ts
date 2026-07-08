// Entry point for the future Postgres Database Layer — mirrors the role
// lib/database/index.ts plays for Supabase. Nothing in the app imports this
// yet: no PostgresXxxRepository exists, and DATABASE_PROVIDER isn't read
// anywhere (see docs/POSTGRES_MIGRATION_AUDIT.md section 13 for when that
// changes). Exists now purely as prepared infrastructure.
export { db } from "./client";
export * as schema from "./schema";
