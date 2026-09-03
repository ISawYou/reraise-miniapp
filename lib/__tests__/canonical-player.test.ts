import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Player } from "@/types/domain";

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: { findById: mocks.findById },
}));

const { resolveCanonicalPlayer } = await import("@/lib/canonical-player");

function makePlayer(overrides: Partial<Player>): Player {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    telegram_id: null,
    email: null,
    username: null,
    display_name: "Player",
    role: "player",
    created_at: "2026-01-01T00:00:00.000Z",
    merged_into_player_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.findById.mockReset();
});

describe("resolveCanonicalPlayer", () => {
  it("returns null for a null input", async () => {
    expect(await resolveCanonicalPlayer(null)).toBeNull();
  });

  it("returns the player unchanged when never merged", async () => {
    const player = makePlayer({ id: "p1" });
    expect(await resolveCanonicalPlayer(player)).toEqual(player);
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it("follows a single merge hop to the canonical target", async () => {
    const target = makePlayer({ id: "target" });
    const source = makePlayer({ id: "source", merged_into_player_id: "target" });
    mocks.findById.mockResolvedValueOnce(target);

    const resolved = await resolveCanonicalPlayer(source);
    expect(resolved).toEqual(target);
    expect(mocks.findById).toHaveBeenCalledWith("target");
  });

  it("follows a multi-hop chain A -> B -> C", async () => {
    const a = makePlayer({ id: "a", merged_into_player_id: "b" });
    const b = makePlayer({ id: "b", merged_into_player_id: "c" });
    const c = makePlayer({ id: "c" });
    mocks.findById.mockResolvedValueOnce(b).mockResolvedValueOnce(c);

    const resolved = await resolveCanonicalPlayer(a);
    expect(resolved).toEqual(c);
  });

  it("fails closed on a cycle (A -> B -> A)", async () => {
    const a = makePlayer({ id: "a", merged_into_player_id: "b" });
    const b = makePlayer({ id: "b", merged_into_player_id: "a" });
    mocks.findById.mockResolvedValueOnce(b).mockResolvedValueOnce(a);

    expect(await resolveCanonicalPlayer(a)).toBeNull();
  });

  it("fails closed on a self-reference", async () => {
    const a = makePlayer({ id: "a", merged_into_player_id: "a" });
    mocks.findById.mockResolvedValueOnce(a);

    expect(await resolveCanonicalPlayer(a)).toBeNull();
  });

  it("fails closed on a dangling merge pointer", async () => {
    const a = makePlayer({ id: "a", merged_into_player_id: "ghost" });
    mocks.findById.mockResolvedValueOnce(null);

    expect(await resolveCanonicalPlayer(a)).toBeNull();
  });

  it("fails closed past MAX_MERGE_HOPS instead of trusting an unbounded chain", async () => {
    // 12 hops -- one more than the module's own bound (10) -- built from
    // corrupted-but-acyclic data (each id distinct, so the visited-set
    // cycle guard alone would never catch this).
    const chain = Array.from({ length: 12 }, (_, i) =>
      makePlayer({ id: `n${i}`, merged_into_player_id: `n${i + 1}` })
    );
    chain.push(makePlayer({ id: "n12" }));

    for (let i = 1; i < chain.length; i++) {
      mocks.findById.mockResolvedValueOnce(chain[i]);
    }

    expect(await resolveCanonicalPlayer(chain[0])).toBeNull();
  });
});
