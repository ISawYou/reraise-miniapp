import { createClient } from "@supabase/supabase-js";

// Anon-key Supabase client — safe anywhere, including the browser, since it
// only reads NEXT_PUBLIC_* env vars. Used both server-side (by
// not-yet-migrated feature code) and client-side (Realtime subscriptions in
// app/page.tsx, app/tournaments/page.tsx). "browser" describes what this
// client is *safe for*, not where it's exclusively called from.
//
// Moved here verbatim from lib/supabase.ts, which now just re-exports this
// client so existing call sites (including client components) keep working
// unchanged.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
}

if (!supabaseAnonKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;

      if (!(error instanceof TypeError) || attempt === 1) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Supabase request failed");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: fetchWithRetry,
  },
});
