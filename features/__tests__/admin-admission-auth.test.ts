import { beforeEach, it, expect, vi } from 'vitest';
import { StaffAdmissionError } from '@/lib/admin-admission';
const m = vi.hoisted(() => ({ auth: vi.fn(), admit: vi.fn(), context: vi.fn(), notify: vi.fn() }));
vi.mock('@/lib/admin-auth', () => ({ assertServerActorRole: m.auth }));
vi.mock('@/lib/repositories/admin-admission/PostgresAdminAdmissionRepository', () => ({ PostgresAdminAdmissionRepository: class {
        admit = m.admit;
        context = m.context;
    } }));
vi.mock('@/features/tournament-promotion-notification', () => ({ dispatchWaitlistPromotionNotifications: m.notify }));
const { admitTournamentPlayer, getStaffAdmissionContext } = await import('../admin-tournament-admission');
const input = { tournamentId: '00000000-0000-4000-8000-000000000001', requestId: '00000000-0000-4000-8000-000000000002', playerId: '00000000-0000-4000-8000-000000000003', expectedPhase: 'after_snapshot' as const, confirmed: true, arrivalConfirmed: false };
beforeEach(() => { vi.clearAllMocks(); m.auth.mockResolvedValue({ id: 'signed-staff' }); });
it.each(['anonymous', 'player', 'blocked'])('%s cannot request context or override', async () => { m.auth.mockRejectedValue(Error('Forbidden')); await expect(admitTournamentPlayer(input)).rejects.toThrow('Forbidden'); await expect(getStaffAdmissionContext(input.tournamentId)).rejects.toThrow('Forbidden'); expect(m.admit).not.toHaveBeenCalled(); });
it('actual signed actor overrides any client isAdmin/actorId fields', async () => { m.admit.mockResolvedValue({ promoted: [], status: 'registered' }); await admitTournamentPlayer({ ...input, actorId: 'forged', isAdmin: true } as typeof input); expect(m.auth).toHaveBeenCalledWith(['admin', 'operator']); expect(m.admit).toHaveBeenCalledWith('signed-staff', expect.anything()); });
it('expected business rejection serializes Russian message without digest', async () => { m.admit.mockRejectedValue(new StaffAdmissionError('Свободных мест нет — добавление невозможно')); expect(await admitTournamentPlayer(input)).toEqual({ ok: false, error: 'Свободных мест нет — добавление невозможно' }); expect(m.notify).not.toHaveBeenCalled(); });
it('unknown database failure never produces false success', async () => { const e = Error('DB unavailable'); m.admit.mockRejectedValue(e); await expect(admitTournamentPlayer(input)).rejects.toBe(e); expect(m.notify).not.toHaveBeenCalled(); });
