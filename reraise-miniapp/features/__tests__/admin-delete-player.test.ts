import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: mockFrom },
}));

import { deleteManualPlayer } from "@/features/admin";

function makeChain(result: { data?: any; error?: any }) {
  const chain: any = {};
  for (const method of ["select", "eq", "delete"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue(result);
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

beforeEach(() => mockFrom.mockReset());

describe("deleteManualPlayer", () => {
  it("deletes Telegram players and their related records", async () => {
    mockFrom
      .mockImplementationOnce(() =>
        makeChain({ data: { id: "player-1", telegram_id: 123456789 }, error: null })
      )
      .mockImplementationOnce(() => makeChain({ error: null }))
      .mockImplementationOnce(() => makeChain({ error: null }))
      .mockImplementationOnce(() => makeChain({ error: null }))
      .mockImplementationOnce(() => makeChain({ error: null }))
      .mockImplementationOnce(() => makeChain({ error: null }));

    await expect(deleteManualPlayer("player-1")).resolves.toBeUndefined();

    expect(mockFrom.mock.calls.map(([table]) => table)).toEqual([
      "players",
      "tournament_live_entries",
      "player_achievements",
      "results",
      "registrations",
      "players",
    ]);
  });
});
