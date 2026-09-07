import { beforeAll, describe, expect, it } from "vitest";

// The page module transitively imports lib/database's legacy Supabase
// browser client (see CLAUDE.md: Supabase is compatibility technical debt,
// not the live provider), which throws at import time without these
// NEXT_PUBLIC_* vars set. Stubbed here, test-local only, purely so this
// module can be imported for its exported option list -- no Supabase client
// is ever actually invoked by this test.
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
});

describe("Create tournament type selector", () => {
  it('includes Crazy Pineapple mapped to tournament_type "crazy_pineapple"', async () => {
    const { TOURNAMENT_TYPE_OPTIONS } = await import(
      "@/app/admin/tournaments/create/page"
    );

    expect(TOURNAMENT_TYPE_OPTIONS).toContainEqual({
      value: "crazy_pineapple",
      label: "Crazy Pineapple",
    });
  });
});
