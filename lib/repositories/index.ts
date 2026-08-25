// Root barrel — one export point for the whole Repository Layer, per
// docs/REPOSITORY_LAYER_ARCHITECTURE.md. Each domain lives in its own
// folder (interface + Supabase implementation + a small local index.ts
// that wires the two together); this file just re-exports all of them so
// call sites keep importing from "@/lib/repositories" regardless of how
// many domains exist underneath.
//
// No DATABASE_PROVIDER branching yet — only Supabase-backed implementations
// exist today. See docs/REPOSITORY_LAYER_ARCHITECTURE.md section 5: each
// domain's local index.ts stays a single, direct instantiation until a
// second (Postgres) implementation actually exists to switch to.
export * from "./app-settings";
export * from "./activity";
export * from "./avatar-storage";
export * from "./email-otp";
export * from "./player";
export * from "./season";
export * from "./achievement";
export * from "./tournament";
export * from "./registration";
export * from "./tournament-live-state";
export * from "./tournament-mystery-bounty";
export * from "./tournament-late-registration";
export * from "./result";
export * from "./academy-progress";
export * from "./club-activity";
export * from "./achievement-visual";
export * from "./achievement-asset-storage";
export * from "./featured-achievement";
