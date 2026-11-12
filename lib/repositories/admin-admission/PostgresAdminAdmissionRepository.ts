import 'server-only';
import { eq, asc, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { players, tournaments, registrations, tournamentLateRegistration, tournamentPlayerEliminations, tournamentAttendance, tournamentLiveEntries, tournamentRebuyState, adminAdmissions } from '@/lib/db/schema';
import { computeSeatLoad } from '@/features/tournament-waitlist-capacity';
import { StaffAdmissionError, type StaffAdmissionInput, type AdmissionPhase } from '@/lib/admin-admission';
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const fail = (message: string): never => { throw new StaffAdmissionError(message); };
async function frozen(tx: Tx, id: string) { const [r] = await tx.execute(sql `select (select to_jsonb(s) from tournament_late_registration s where tournament_id=${id}::uuid) as value`); return r.value ?? null; }
export class PostgresAdminAdmissionRepository {
    async context(id:string,playerId?:string){
        const[t]=await db.select().from(tournaments).where(eq(tournaments.id,id));if(!t)fail('Турнир не найден');
        const[s]=await db.select().from(tournamentLateRegistration).where(eq(tournamentLateRegistration.tournamentId,id));
        let noShowRestricted=false;
        if(playerId){const[p]=await db.select().from(players).where(eq(players.id,playerId));const[r]=await db.select().from(registrations).where(sql`${registrations.tournamentId}=${id}::uuid and ${registrations.playerId}=${playerId}::uuid`);noShowRestricted=!t.isFinal&&!!(p?.onlineRegistrationRestrictedAt||r?.noShowAt);}
        return{noShowRestricted,phase:(s?'after_snapshot':t.lateRegistrationEndsAt&&Date.now()>=t.lateRegistrationEndsAt.getTime()?'after_time':'normal')as AdmissionPhase,title:t.title,status:t.status,tournamentType:t.tournamentType,ratedPlaces:s?.ratingPlaces.length??null};
    }
    async admit(actorId: string, input: StaffAdmissionInput) {
        if (process.env.DATABASE_PROVIDER !== 'postgres')
            fail('Ручное добавление требует PostgreSQL');
        return db.transaction(async (tx) => {
            // FIRST statement: same serialization point as snapshot close and completion.
            const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, input.tournamentId)).for('update');
            if (!t)
                fail('Турнир не найден');
            if (t.status === 'completed')
                fail('Турнир завершён — добавление запрещено');
            const [actor] = await tx.select().from(players).where(eq(players.id, actorId)).for('share');
            if (!actor || !['admin', 'operator'].includes(actor.role) || actor.isBlocked || actor.mergedIntoPlayerId)
                fail('Недостаточно прав');
            const payload = { playerId: input.playerId ?? null, nickname: input.nickname?.trim() ?? null, arrivalConfirmed: input.arrivalConfirmed };
            const [previous] = await tx.select().from(adminAdmissions).where(eq(adminAdmissions.requestId, input.requestId));
            if (previous) {
                if (previous.actorId !== actorId || previous.tournamentId !== t.id || !Object.entries(payload).every(([key, value]) => (previous.input as Record<string, unknown>)[key] === value) || previous.state !== 'succeeded')
                    fail('Запрос уже использован для другой операции');
                const [r] = await tx.select().from(registrations).where(eq(registrations.id, previous.registrationId ?? '00000000-0000-0000-0000-000000000000'));
                if (!r || !['registered', 'attended', 'waitlist'].includes(r.status))
                    fail('Состояние регистрации изменилось — обновите страницу');
                return { registrationId: r.id, playerId: r.playerId, status: r.status, noOp: true, promoted: [] as string[] };
            }
            const before = await frozen(tx, t.id);
            const phase: AdmissionPhase = before ? 'after_snapshot' : t.lateRegistrationEndsAt && Date.now() >= t.lateRegistrationEndsAt.getTime() ? 'after_time' : 'normal';
            if (phase !== input.expectedPhase || (phase !== 'normal' && !input.confirmed))
                fail('Состояние регистрации изменилось — подтвердите добавление заново');
            if (t.tournamentType === 'qualification_final')
                fail('Финал отбора ведётся через подтверждённый состав');
            let pid = input.playerId;
            if (!pid) {
                const nick = input.nickname?.trim();
                if (!nick || nick.length > 100)
                    fail('Введите ник от 1 до 100 символов');
                await tx.execute(sql `select pg_advisory_xact_lock(hashtextextended(lower(${nick}),0))`);
                const existing = await tx.select({ id: players.id }).from(players).where(sql `lower(trim(${players.displayName}))=lower(${nick})`).limit(1);
                if (existing.length)
                    fail('Игрок с таким ником уже существует — выберите его из списка');
            }
            let entrant: typeof players.$inferSelect | undefined;
            if (pid) {
                [entrant] = await tx.select().from(players).where(eq(players.id, pid)).for('update');
                if (!entrant || entrant.mergedIntoPlayerId || entrant.isBlocked)
                    fail('Выберите действующий незаблокированный аккаунт');
                await tx.update(players).set({ mergedIntoPlayerId: sql `${players.mergedIntoPlayerId}` }).where(eq(players.id, pid));
            }
            const rows = await tx.select().from(registrations).where(eq(registrations.tournamentId, t.id)).orderBy(asc(registrations.createdAt), asc(registrations.id));
            const old = rows.find(r => r.playerId === pid);
            if (old && ['registered', 'attended'].includes(old.status))
                return { registrationId: old.id, playerId: old.playerId, status: old.status, noOp: true, promoted: [] as string[] };
            let restricted = !t.isFinal && !!(old?.noShowAt || entrant?.onlineRegistrationRestrictedAt);
            const noShowBefore={restrictedAt:entrant?.onlineRegistrationRestrictedAt??null,noShowAt:old?.noShowAt??null};
            const confirmNoShow=restricted&&!!input.noShowAdmissionConfirmed;
            if(confirmNoShow){if(!input.arrivalConfirmed)fail('Подтвердите физическое присутствие для допуска после неявки');restricted=false;}

            if (restricted && phase !== 'normal')
                fail('У игрока ограничение после неявки — используйте отдельное подтверждение допуска');
            const elimination = await tx.select().from(tournamentPlayerEliminations).where(eq(tournamentPlayerEliminations.tournamentId, t.id));
            const eliminated = new Set(elimination.filter(x => x.eliminated).map(x => x.playerId));
            if (pid && eliminated.has(pid))
                fail('Игрок выбыл — используйте отдельное подтверждение возврата в игру');
            let free = t.maxPlayers - computeSeatLoad(rows, eliminated);
            const queue = [];
            for (const r of rows.filter(r => r.status === 'waitlist' && !r.noShowAt)) {
                const [p] = await tx.select({ restricted: players.onlineRegistrationRestrictedAt, merged: players.mergedIntoPlayerId, blocked: players.isBlocked }).from(players).where(eq(players.id, r.playerId));
                if (p && (t.isFinal || !p.restricted) && !p.merged && !p.blocked)
                    queue.push(r);
            }
            const promoted: string[] = [];
            if (phase === 'normal')
                for (const r of queue) {
                    if (free <= 0 || r.playerId===pid)
                        break;
                    await tx.update(registrations).set({ status: 'registered', waitlistPromotionNotificationClaimedAt: r.waitlistPromotionNotificationClaimedAt ?? new Date() }).where(eq(registrations.id, r.id));
                    if (!r.waitlistPromotionNotificationClaimedAt)
                        promoted.push(r.id);
                    r.status = 'registered';
                    free--;
                }
            const currentOld = rows.find(r => r.playerId === pid);
            if (currentOld?.status === 'registered')
                return { registrationId: currentOld.id, playerId: currentOld.playerId, status: currentOld.status, noOp: true, promoted };
            if (phase !== 'normal' && free <= 0)
                fail('Свободных мест нет — добавление невозможно');
            if (phase !== 'normal' && queue.some(r => r.status === 'waitlist' && r.playerId !== pid) && queue.find(r => r.status === 'waitlist')?.playerId !== pid)
                fail('Сначала допустите первого игрока из листа ожидания');
            const status = !restricted && free > 0 ? 'registered' : 'waitlist';
            if (input.arrivalConfirmed && status !== 'registered')
                fail('Нельзя отметить «Пришёл»: свободных мест нет');
            if (!pid) {
                const [p] = await tx.insert(players).values({ telegramId: null, username: null, displayName: input.nickname!.trim(), adminDisplayName: input.nickname!.trim(), role: 'player' }).returning();
                pid = p.id;
            }
            // DB rechecks actual staff role, phase, completion and exact target scope.
            await tx.execute(sql `select public.admin_issue_admission_permit(${input.requestId}::uuid,${t.id}::uuid,${pid}::uuid,${actorId}::uuid,${phase},${input.confirmed},${input.arrivalConfirmed},${JSON.stringify({...payload,noShowAdmissionConfirmed:confirmNoShow,noShowBefore})}::jsonb)`);
            if(confirmNoShow){await tx.update(players).set({onlineRegistrationRestrictedAt:null}).where(eq(players.id,pid));if(old?.noShowAt){await tx.update(registrations).set({noShowAt:null}).where(eq(registrations.id,old.id));}}
            const [r] = old ? await tx.update(registrations).set({ status }).where(eq(registrations.id, old.id)).returning() : await tx.insert(registrations).values({ tournamentId: t.id, playerId: pid, status }).returning();
            if (old?.status === 'waitlist' && status === 'registered' && !old.waitlistPromotionNotificationClaimedAt) {
                await tx.update(registrations).set({ waitlistPromotionNotificationClaimedAt: new Date() }).where(eq(registrations.id, r.id));
                promoted.push(r.id);
            }
            if (t.kind !== 'free')
                await tx.insert(tournamentLiveEntries).values({ tournamentId: t.id, playerId: pid, registrationId: r.id, arrived: input.arrivalConfirmed, rebuys: input.arrivalConfirmed ? 1 : 0 }).onConflictDoUpdate({ target: [tournamentLiveEntries.tournamentId,tournamentLiveEntries.playerId],set: {registrationId:r.id,...(input.arrivalConfirmed?{arrived:true,rebuys:sql`greatest(${tournamentLiveEntries.rebuys},1)`}:{})} });
            if (input.arrivalConfirmed) {
                await tx.insert(tournamentAttendance).values({ tournamentId: t.id, playerId: pid, arrived: true, arrivedAt: new Date() }).onConflictDoUpdate({ target: [tournamentAttendance.tournamentId, tournamentAttendance.playerId], set: { arrived: true, arrivedAt: sql `coalesce(${tournamentAttendance.arrivedAt},now())` } });
                await tx.insert(tournamentRebuyState).values({ tournamentId: t.id, playerId: pid, rebuys: 1, addons: 0 }).onConflictDoUpdate({target:[tournamentRebuyState.tournamentId,tournamentRebuyState.playerId],set:{rebuys:sql`greatest(${tournamentRebuyState.rebuys},1)`}});
            }
            if (JSON.stringify(await frozen(tx, t.id)) !== JSON.stringify(before))
                fail('Снимок рейтинга изменился — операция отменена');
            await tx.update(adminAdmissions).set({ state: 'succeeded', registrationId: r.id }).where(eq(adminAdmissions.requestId, input.requestId));
            return { registrationId: r.id, playerId: pid, status, noOp: false, promoted };
        });
    }
}
