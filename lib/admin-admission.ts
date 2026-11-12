export type AdmissionPhase = 'normal' | 'after_time' | 'after_snapshot';
export type StaffAdmissionInput = {
    tournamentId: string;
    requestId: string;
    playerId?: string;
    nickname?: string;
    expectedPhase: AdmissionPhase;
    confirmed: boolean;
    arrivalConfirmed: boolean;
    noShowAdmissionConfirmed?: boolean;
};
export class StaffAdmissionError extends Error {
}
export function admissionConfirmation(phase: AdmissionPhase, player: string, tournament: string) {
    const prefix = `${tournament}\nИгрок: ${player}\n\n`;
    return prefix + (phase === 'after_snapshot' ? 'Поздняя регистрация уже закрыта.\nОчки за призовые места зафиксированы.\n\nДобавить игрока вручную без пересчёта фонда очков за места?' : phase === 'after_time' ? 'Время поздней регистрации истекло.\nДобавить игрока вручную?\n\nЕсли игрок будет отмечен как «Пришёл» до ручного закрытия регистрации, он войдёт в расчёт рейтингового фонда.' : 'Добавить игрока?');
}
export function admissionCompletionRejection(error: unknown): string | null {
    const messages = ['Состав изменился — обновите результаты перед завершением', 'Очки за места не совпадают с зафиксированным снимком', 'Зафиксированный фонд очков увеличен'];
    let current = error;
    for (let i = 0; i < 6 && current && typeof current === 'object'; i++) {
        const e = current as {
            code?: unknown;
            message?: unknown;
            cause?: unknown;
        };
        if (e.code === '23514' && typeof e.message === 'string' && messages.includes(e.message))
            return e.message;
        current = e.cause;
    }
    return null;
}
