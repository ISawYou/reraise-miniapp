import "server-only";

import { createClient } from "@supabase/supabase-js";

// Server-only, service-role Supabase client. Bypasses RLS entirely —
// never import this into client-bundled code. This is the single place
// that knows how a service-role client is constructed; every Repository
// gets its client from here instead of building one itself.
//
// Originally lived at lib/supabase-server.ts. After the Supabase
// Repository Layer was completed, every call site went through a
// Repository, so the old re-export shim had zero remaining importers and
// was deleted outright rather than kept as dead weight.
export function getSupabaseServer() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  }

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
