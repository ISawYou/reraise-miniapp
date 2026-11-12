import { LATE_REGISTRATION_CLOSED_MESSAGE } from '@/lib/registration-policy-copy';
export type RegistrationDeadlineRejection = {
    ok: false;
    code: 'LATE_REGISTRATION_CLOSED';
    error: string;
};
export function registrationDeadlineRejection(error: unknown): RegistrationDeadlineRejection | null {
    const seen = new Set<unknown>();
    let current = error;
    for (let i = 0; i < 8 && current && typeof current === 'object' && !seen.has(current); i++) {
        seen.add(current);
        const e = current as {
            code?: unknown;
            message?: unknown;
            cause?: unknown;
        };
        if ((e.code === '23514' && e.message === 'Поздняя регистрация закрыта по времени') || (e.message === LATE_REGISTRATION_CLOSED_MESSAGE))
            return { ok: false, code: 'LATE_REGISTRATION_CLOSED', error: LATE_REGISTRATION_CLOSED_MESSAGE };
        current = e.cause;
    }
    return null;
}
export function isRegistrationDeadlineElapsed(deadline: string | null | undefined, now = Date.now()): boolean {
    return deadline != null && Number.isFinite(Date.parse(deadline)) && now >= Date.parse(deadline);
}
