import { it, expect, vi } from 'vitest';
const register = vi.hoisted(() => vi.fn());
vi.mock('@/features/tournaments', () => ({ registerPlayerForTournament: register }));
const { registerPlayerForTournamentAction } = await import('../registration-action');
it('delegates to canonical registration with same identity', async () => { register.mockResolvedValue({ id: 'r', status: 'registered' }); expect(await registerPlayerForTournamentAction('p', 't')).toMatchObject({ ok: true, registration: { id: 'r' } }); expect(register).toHaveBeenCalledWith('p', 't'); });
it('serializes confirmed deadline rejection without SQL payload', async () => { register.mockRejectedValue({ message: 'Failed query', cause: { code: '23514', message: 'Поздняя регистрация закрыта по времени' } }); expect(await registerPlayerForTournamentAction('p', 't')).toEqual({ ok: false, code: 'LATE_REGISTRATION_CLOSED', error: 'Поздняя регистрация завершена — запись на турнир закрыта' }); });
it('does not mask auth or unexpected DB failures', async () => { const e = Error('Unauthorized'); register.mockRejectedValue(e); await expect(registerPlayerForTournamentAction('p', 't')).rejects.toBe(e); });
