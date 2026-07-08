// Database Client Layer — the single place that knows how to construct a
// Supabase client (which env vars, which key, which options). Repositories
// get their client from here instead of constructing one themselves.
//
// Only Supabase exists today. When a second provider (Postgres/Drizzle)
// shows up, its client construction would live in its own sibling folder
// (e.g. lib/database/postgres/), not inside this one — this barrel would
// then re-export from both.
export * from "./supabase";
