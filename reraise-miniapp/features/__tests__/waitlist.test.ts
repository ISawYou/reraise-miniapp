import { vi, describe, it, expect, beforeEach } from 'vitest';

// vi.hoisted ensures mockFrom is defined before vi.mock hoisting runs
const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom },
}));

// Prevent achievements side-effects in unrelated tests
vi.mock('@/features/achievements', () => ({
  syncPlayersAchievements: vi.fn().mockResolvedValue(undefined),
}));

import {
  registerPlayerForTournament,
  cancelPlayerRegistration,
} from '@/features/tournaments';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a chainable Supabase mock that resolves `result` whether the caller
 * awaits the chain directly or calls `.single()` at the end.
 */
function makeChain(result: { data?: any; error?: any }) {
  const chain: any = {};
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'insert']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // update is tracked separately so we can spy on it in promote assertions
  chain.update = vi.fn().mockReturnValue(chain);
  // .single() — used by queries that expect one row
  chain.single = vi.fn().mockResolvedValue(result);
  // Direct await — used by queries without .single() (update, count queries)
  chain.then = (res: any, rej: any) =>
    Promise.resolve(result).then(res, rej);
  return chain;
}

/** Minimal registration row factory */
function reg(overrides: Record<string, any> = {}) {
  return {
    id: 'reg-1',
    player_id: 'player-1',
    tournament_id: 'tournament-1',
    status: 'registered',
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

const FULL_TOURNAMENT = {
  id: 'tournament-1',
  title: 'Test Tournament',
  description: null,
  location: null,
  google_sheet_tab_name: null,
  start_at: '2024-12-01T18:00:00Z',
  max_players: 2,  // 2 spots
  kind: 'free',
  season_id: null,
  status: 'open',
  created_at: '2024-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => mockFrom.mockReset());

describe('registerPlayerForTournament', () => {
  it('assigns "waitlist" when all spots are taken', async () => {
    mockFrom
      // 1. check existing registration → none
      .mockImplementationOnce(() => makeChain({ data: [], error: null }))
      // 2. get player permissions (can_access_free → can register for "free" kind)
      .mockImplementationOnce(() =>
        makeChain({
          data: { can_access_free: true, can_access_paid: false, can_access_cash: false },
          error: null,
        })
      )
      // 3. getTournamentById → max_players: 2
      .mockImplementationOnce(() => makeChain({ data: FULL_TOURNAMENT, error: null }))
      // 4. getTournamentRegistrationCounts → 2 registered (= max_players → full)
      .mockImplementationOnce(() =>
        makeChain({
          data: [
            { tournament_id: 'tournament-1', status: 'registered' },
            { tournament_id: 'tournament-1', status: 'registered' },
          ],
          error: null,
        })
      )
      // 5. insert new registration (status will be "waitlist")
      .mockImplementationOnce(() =>
        makeChain({ data: reg({ id: 'reg-new', status: 'waitlist' }), error: null })
      );

    const result = await registerPlayerForTournament('player-1', 'tournament-1');

    expect(result.status).toBe('waitlist');
  });

  it('assigns "registered" when spots are available', async () => {
    mockFrom
      // 1. check existing registration → none
      .mockImplementationOnce(() => makeChain({ data: [], error: null }))
      // 2. get player permissions
      .mockImplementationOnce(() =>
        makeChain({
          data: { can_access_free: true, can_access_paid: false, can_access_cash: false },
          error: null,
        })
      )
      // 3. getTournamentById → max_players: 2
      .mockImplementationOnce(() => makeChain({ data: FULL_TOURNAMENT, error: null }))
      // 4. getTournamentRegistrationCounts → 1 registered (< max_players → spot available)
      .mockImplementationOnce(() =>
        makeChain({
          data: [{ tournament_id: 'tournament-1', status: 'registered' }],
          error: null,
        })
      )
      // 5. insert new registration (status will be "registered")
      .mockImplementationOnce(() =>
        makeChain({ data: reg({ id: 'reg-new', status: 'registered' }), error: null })
      );

    const result = await registerPlayerForTournament('player-1', 'tournament-1');

    expect(result.status).toBe('registered');
  });
});

describe('cancelPlayerRegistration', () => {
  it('promotes first waitlist player (created_at ASC) when a registered player cancels', async () => {
    const promoteChain = makeChain({ error: null });

    mockFrom
      // 1. find current registration → registered
      .mockImplementationOnce(() =>
        makeChain({ data: reg({ status: 'registered' }), error: null })
      )
      // 2. update status → cancelled
      .mockImplementationOnce(() => makeChain({ error: null }))
      // 3. find first waitlist player
      .mockImplementationOnce(() =>
        makeChain({
          data: [
            reg({
              id: 'waitlist-1',
              player_id: 'player-2',
              status: 'waitlist',
              created_at: '2024-01-01T01:00:00Z',
            }),
          ],
          error: null,
        })
      )
      // 4. promote: update waitlist-1 → registered
      .mockImplementationOnce(() => promoteChain);

    await cancelPlayerRegistration('player-1', 'tournament-1');

    // All 4 DB calls executed
    expect(mockFrom).toHaveBeenCalledTimes(4);
    // The promote call used { status: 'registered' }
    expect(promoteChain.update).toHaveBeenCalledWith({ status: 'registered' });
  });

  it('does NOT promote anyone when a waitlist player cancels', async () => {
    mockFrom
      // 1. find current registration → waitlist
      .mockImplementationOnce(() =>
        makeChain({ data: reg({ status: 'waitlist' }), error: null })
      )
      // 2. update status → cancelled
      .mockImplementationOnce(() => makeChain({ error: null }));

    await cancelPlayerRegistration('player-1', 'tournament-1');

    // Only 2 DB calls — no waitlist lookup, no promotion
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });
});
