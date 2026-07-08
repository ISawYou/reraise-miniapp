// Re-export shim — the actual client construction now lives in the
// Database Client Layer (lib/database/supabase/browser.ts). Kept so
// existing, not-yet-migrated call sites (features/admin.ts,
// features/achievements.ts, features/tournaments.ts, app/page.tsx,
// app/tournaments/page.tsx) don't need to change their import path.
export { supabase } from "@/lib/database/supabase/browser";
