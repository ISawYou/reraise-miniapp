import { beforeAll, describe, expect, it } from "vitest";

// See sibling create/__tests__/tournament-type-options.test.ts for why these
// are stubbed: the page module transitively imports the legacy Supabase
// browser client, which throws at import time without them. Test-local only
// -- no Supabase client is ever actually invoked by this test.
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
});

describe("Edit tournament type selector", () => {
  it('includes Crazy Pineapple mapped to tournament_type "crazy_pineapple"', async () => {
    const { TOURNAMENT_TYPE_OPTIONS } = await import(
      "@/app/admin/tournaments/[id]/edit/page"
    );

    expect(TOURNAMENT_TYPE_OPTIONS).toContainEqual({
      value: "crazy_pineapple",
      label: "Crazy Pineapple",
    });
  });
});
