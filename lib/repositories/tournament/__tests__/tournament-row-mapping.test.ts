import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TournamentRow } from "@/types/database";

// SupabaseTournamentRepository transitively imports lib/database, which
// throws at module-eval time without these -- dummy values only, this
// suite never actually calls a real Supabase project. Set before the
// dynamic import below so the throw-on-import happens with these already
// in place.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

// This repository is legacy/compatibility code, not a live production path
// -- Postgres is the only current provider (DATABASE_PROVIDER, see
// lib/repositories/tournament/index.ts). These tests verify plain contract
// parity with PostgresTournamentRepository: is_final round-trips on read
// and is preserved (never stripped) on write. Regression coverage for a
// previously-removed "strip is_final before it reaches Supabase" shim that
// was based on a mistaken belief in a live Supabase-backed deployment.
function createSupabaseChainMock(row: unknown) {
  const chain: {
    from: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    then: (resolve: (value: { data: unknown; error: null }) => void) => void;
  } = {
    from: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve({ data: row, error: null })),
    then: (resolve) => resolve({ data: row, error: null }),
  };
  return chain;
}

const mocks = vi.hoisted(() => ({ getSupabaseServer: vi.fn() }));
vi.mock("@/lib/database", () => ({ getSupabaseServer: mocks.getSupabaseServer }));

const { mapTournamentRow, SupabaseTournamentRepository } = await import(
  "@/lib/repositories/tournament/SupabaseTournamentRepository"
);

function baseRow(overrides: Partial<TournamentRow> = {}): TournamentRow {
  return {
    id: "t1",
    title: "T",
    description: null,
    location: null,
    google_sheet_tab_name: null,
    start_at: "2026-01-01T00:00:00.000Z",
    max_players: 20,
    kind: "free",
    tournament_type: "classic",
    season_id: null,
    status: "open",
    created_at: "2026-01-01T00:00:00.000Z",
    rating_formula_version: "v2",
    rating_guarantee: null,
    is_final: false,
    ...overrides,
  };
}

describe("mapTournamentRow -- is_final (read)", () => {
  it("maps is_final:true through", () => {
    expect(mapTournamentRow(baseRow({ is_final: true })).is_final).toBe(true);
  });

  it("maps a normal tournament row to is_final:false", () => {
    expect(mapTournamentRow(baseRow({ is_final: false })).is_final).toBe(false);
  });

  it("defaults to is_final:false when the field is absent from the row (defensive null-safety only, not a schema workaround)", () => {
    const rowWithoutField = baseRow() as Partial<TournamentRow>;
    delete rowWithoutField.is_final;

    expect(mapTournamentRow(rowWithoutField as TournamentRow).is_final).toBe(false);
  });
});

describe("SupabaseTournamentRepository -- is_final is preserved on write, never stripped", () => {
  let repo: InstanceType<typeof SupabaseTournamentRepository>;

  beforeEach(() => {
    repo = new SupabaseTournamentRepository();
  });

  it("create() passes is_final straight through to the insert payload", async () => {
    const chain = createSupabaseChainMock(baseRow({ is_final: true }));
    mocks.getSupabaseServer.mockReturnValue(chain);

    const result = await repo.create({
      title: "Final",
      tournament_type: "classic",
      is_final: true,
    });

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ is_final: true }),
    );
    expect(result.is_final).toBe(true);
  });

  it("update() passes is_final straight through to the update payload when supplied", async () => {
    const chain = createSupabaseChainMock(baseRow({ is_final: true }));
    mocks.getSupabaseServer.mockReturnValue(chain);

    await repo.update("t1", { is_final: true });

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_final: true }),
    );
  });

  it("patch() passes is_final straight through to the update payload when supplied", async () => {
    const chain = createSupabaseChainMock(baseRow({ is_final: true }));
    mocks.getSupabaseServer.mockReturnValue(chain);

    await repo.patch("t1", { is_final: true });

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_final: true }),
    );
  });
});
