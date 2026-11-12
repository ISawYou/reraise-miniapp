"use server";
import { assertServerActorRole } from '@/lib/admin-auth';
import { PostgresAdminAdmissionRepository } from '@/lib/repositories/admin-admission/PostgresAdminAdmissionRepository';
import { StaffAdmissionError, type StaffAdmissionInput } from '@/lib/admin-admission';
import { dispatchWaitlistPromotionNotifications } from '@/features/tournament-promotion-notification';
import { registrationDeadlineRejection } from '@/lib/registration-deadline-response';
const repo = new PostgresAdminAdmissionRepository();
export async function getStaffAdmissionContext(tournamentId: string,playerId?:string) { await assertServerActorRole(['admin', 'operator']); return repo.context(tournamentId,playerId); }
export async function admitTournamentPlayer(input: StaffAdmissionInput) {
    const actor = await assertServerActorRole(['admin', 'operator']);
    try {
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!input || typeof input !== 'object' || !uuid.test(input.requestId) || !uuid.test(input.tournamentId) || (input.playerId !== undefined && !uuid.test(input.playerId)) || !['normal', 'after_time', 'after_snapshot'].includes(input.expectedPhase) || !!input.playerId === !!input.nickname || typeof input.confirmed !== 'boolean' || typeof input.arrivalConfirmed !== 'boolean' || (input.noShowAdmissionConfirmed!==undefined&&typeof input.noShowAdmissionConfirmed!=='boolean'))
            throw new StaffAdmissionError('Некорректные данные добавления');
        const result = await repo.admit(actor.id, input);
        await dispatchWaitlistPromotionNotifications(input.tournamentId, result.promoted);
        return { ok: true as const, ...result };
    }
    catch (error) {
        console.warn('[staff-admission]', { actorId: actor.id, outcome: 'failed' });
        const deadline = registrationDeadlineRejection(error);
        if (deadline)
            return deadline;
        if (error instanceof StaffAdmissionError)
            return { ok: false as const, error: error.message };
        let e: unknown = error;
        for (let i = 0; i < 5 && e && typeof e === 'object'; i++) {
            const x = e as {
                message?: string;
                cause?: unknown;
            };
            if (x.message?.startsWith('STAFF_ADMISSION: '))
                return { ok: false as const, error: x.message.slice(17) };
            e = x.cause;
        }
        throw error;
    }
}
