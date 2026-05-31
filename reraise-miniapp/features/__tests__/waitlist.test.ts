import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: mockFrom },
}));

vi.mock("@/features/achievements", () => ({
  syncPlayersAchievements: vi.fn().mockResolvedValue(undefined),
}));

import {
  cancelPlayerRegistration,
  registerPlayerForTournament,
} from "@/features/tournaments";

function makeChain(result: { data?: any; error?: any }) {
  const chain: any = {};
  for (const method of ["select", "eq", "neq", "in", "order", "limit", "insert"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.update = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(result);
  chain.then = (resolve: any, reject: any) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function reg(overrides: Record<string, any> = {}) {
  return {
    id: "reg-1",
    player_id: "player-1",
    tournament_id: "tournament-1",
    status: "registered",
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

const FULL_TOURNAMENT = {
  id: "tournament-1",
  title: "Test Tournament",
  description: null,
  location: null,
  google_sheet_tab_name: null,
  start_at: "2024-12-01T18:00:00Z",
  max_players: 2,
  kind: "free",
  season_id: null,
  status: "open",
  created_at: "2024-01-01T00:00:00Z",
};

beforeEach(() => mockFrom.mockReset());

describe("registerPlayerForTournament", () => {
  it('assigns "waitlist" when all spots are taken', async () => {
    mockFrom
      .mockImplementationOnce(() => makeChain({ data: [], error: null }))
      .mockImplementationOnce(() =>
        makeChain({ data: FULL_TOURNAMENT, error: null })
      )
      .mockImplementationOnce(() =>
        makeChain({
          data: [
            { tournament_id: "tournament-1", status: "registered" },
            { tournament_id: "tournament-1", status: "registered" },
          ],
          error: null,
        })
      )
      .mockImplementationOnce(() =>
        makeChain({
          data: reg({ id: "reg-new", status: "waitlist" }),
          error: null,
        })
      );

    const result = await registerPlayerForTournament("player-1", "tournament-1");
    expect(result.status).toBe("waitlist");
  });

  it('assigns "registered" when spots are available', async () => {
    mockFrom
      .mockImplementationOnce(() => makeChain({ data: [], error: null }))
      .mockImplementationOnce(() =>
        makeChain({ data: FULL_TOURNAMENT, error: null })
      )
      .mockImplementationOnce(() =>
        makeChain({
          data: [{ tournament_id: "tournament-1", status: "registered" }],
          error: null,
        })
      )
      .mockImplementationOnce(() =>
        makeChain({
          data: reg({ id: "reg-new", status: "registered" }),
          error: null,
        })
      );

    const result = await registerPlayerForTournament("player-1", "tournament-1");
    expect(result.status).toBe("registered");
  });
});

describe("cancelPlayerRegistration", () => {
  it("promotes first waitlist player when a registered player cancels", async () => {
    const promoteChain = makeChain({ error: null });

    mockFrom
      .mockImplementationOnce(() =>
        makeChain({ data: reg({ status: "registered" }), error: null })
      )
      .mockImplementationOnce(() => makeChain({ error: null }))
      .mockImplementationOnce(() =>
        makeChain({
          data: [
            reg({
              id: "waitlist-1",
              player_id: "player-2",
              status: "waitlist",
              created_at: "2024-01-01T01:00:00Z",
            }),
          ],
          error: null,
        })
      )
      .mockImplementationOnce(() => promoteChain);

    await cancelPlayerRegistration("player-1", "tournament-1");

    expect(mockFrom).toHaveBeenCalledTimes(4);
    expect(promoteChain.update).toHaveBeenCalledWith({ status: "registered" });
  });

  it("does not promote anyone when a waitlist player cancels", async () => {
    mockFrom
      .mockImplementationOnce(() =>
        makeChain({ data: reg({ status: "waitlist" }), error: null })
      )
      .mockImplementationOnce(() => makeChain({ error: null }));

    await cancelPlayerRegistration("player-1", "tournament-1");

    expect(mockFrom).toHaveBeenCalledTimes(2);
  });
});
