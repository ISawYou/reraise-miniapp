import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom },
}));

vi.mock('@/features/achievements', () => ({
  syncPlayersAchievements: vi.fn().mockResolvedValue(undefined),
}));

import { removeAdminTournamentParticipant } from '@/features/tournaments';

// ---------------------------------------------------------------------------
// Helpers — same pattern as waitlist.test.ts
// ---------------------------------------------------------------------------

function makeChain(result: { data?: any; error?: any }) {
  const chain: any = {};
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'insert']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.update = vi.fn().mockReturnValue(chain);
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(result);
  chain.then = (res: any, rej: any) =>
    Promise.resolve(result).then(res, rej);
  return chain;
}

beforeEach(() => mockFrom.mockReset());

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('removeAdminTournamentParticipant', () => {
  it('promotes first waitlist player when a registered participant is removed', async () => {
    const promoteChain = makeChain({ error: null });

    mockFrom
      // 1. fetch registration: status=registered, tournament_id=t-1
      .mockImplementationOnce(() =>
        makeChain({
          data: { status: 'registered', tournament_id: 'tournament-1' },
          error: null,
        })
      )
      // 2. delete the registration
      .mockImplementationOnce(() => makeChain({ error: null }))
      // 3. find first waitlist player (created_at ASC)
      .mockImplementationOnce(() =>
        makeChain({
          data: [{ id: 'waitlist-1', tournament_id: 'tournament-1', status: 'waitlist', created_at: '2024-01-01T01:00:00Z' }],
          error: null,
        })
      )
      // 4. promote waitlist-1 → registered
      .mockImplementationOnce(() => promoteChain);

    await removeAdminTournamentParticipant('reg-1');

    expect(mockFrom).toHaveBeenCalledTimes(4);
    expect(promoteChain.update).toHaveBeenCalledWith({ status: 'registered' });
  });

  it('does NOT promote anyone when a waitlist participant is removed', async () => {
    mockFrom
      // 1. fetch registration: status=waitlist
      .mockImplementationOnce(() =>
        makeChain({
          data: { status: 'waitlist', tournament_id: 'tournament-1' },
          error: null,
        })
      )
      // 2. delete the registration
      .mockImplementationOnce(() => makeChain({ error: null }));

    await removeAdminTournamentParticipant('reg-waitlist-1');

    // Only 2 DB calls — no promotion step
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it('does NOT throw when registered participant is removed but waitlist is empty', async () => {
    mockFrom
      // 1. fetch registration: status=registered
      .mockImplementationOnce(() =>
        makeChain({
          data: { status: 'registered', tournament_id: 'tournament-1' },
          error: null,
        })
      )
      // 2. delete the registration
      .mockImplementationOnce(() => makeChain({ error: null }))
      // 3. find first waitlist player → empty
      .mockImplementationOnce(() => makeChain({ data: [], error: null }));

    await expect(removeAdminTournamentParticipant('reg-1')).resolves.toBeUndefined();

    // 3 DB calls, no 4th (promote)
    expect(mockFrom).toHaveBeenCalledTimes(3);
  });
});
