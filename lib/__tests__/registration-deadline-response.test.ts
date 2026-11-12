import { it, expect } from 'vitest';
import { registrationDeadlineRejection, isRegistrationDeadlineElapsed } from '../registration-deadline-response';
it('maps only confirmed PostgreSQL deadline23514 through Drizzle cause', () => { expect(registrationDeadlineRejection({ message: 'Failed query', cause: { code: '23514', message: 'Поздняя регистрация закрыта по времени' } })).toMatchObject({ ok: false, code: 'LATE_REGISTRATION_CLOSED', error: 'Поздняя регистрация завершена — запись на турнир закрыта' }); });
it('does not disguise unrelated database or authorization errors', () => { for (const e of [{ code: '23514', message: 'Other constraint' }, { code: '42501', message: 'Поздняя регистрация закрыта по времени' }, Error('Unauthorized')])
    expect(registrationDeadlineRejection(e)).toBeNull(); });
it('handles cyclic causes without failure', () => { const e: {
    cause?: unknown;
} = {}; e.cause = e; expect(registrationDeadlineRejection(e)).toBeNull(); });
it('deadline is closed even without snapshot, inclusive boundary', () => { const d = '2026-11-12T19:00:00Z'; expect(isRegistrationDeadlineElapsed(d, Date.parse(d) - 1)).toBe(false); expect(isRegistrationDeadlineElapsed(d, Date.parse(d))).toBe(true); expect(isRegistrationDeadlineElapsed(null)).toBe(false); expect(isRegistrationDeadlineElapsed('invalid')).toBe(false); });
