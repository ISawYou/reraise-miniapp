import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '@/lib/db/schema';
import type { db as Database } from '@/lib/db';
import { calculateRatingPointsForTournament, calculateRatingPlaceStructureForTournament } from '@/features/rating-v2';
import type { StaffAdmissionInput } from '@/lib/admin-admission';
const h = vi.hoisted(() => ({ db: null as unknown as typeof Database }));
vi.mock('@/lib/db', () => ({ db: new Proxy({}, { get(_t, k) { const v = Reflect.get(h.db, k); return typeof v === 'function' ? v.bind(h.db) : v; } }) }));
vi.mock('@/features/tournament-promotion-notification', () => ({ dispatchWaitlistPromotionNotifications: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/repositories', async () => {
    const { PostgresTournamentRepository } = await import('@/lib/repositories/tournament/PostgresTournamentRepository');
    const { PostgresTournamentLateRegistrationRepository } = await import('@/lib/repositories/tournament-late-registration/PostgresTournamentLateRegistrationRepository');
    const { PostgresTournamentLiveStateRepository } = await import('@/lib/repositories/tournament-live-state/PostgresTournamentLiveStateRepository');
    return { tournamentRepository: new PostgresTournamentRepository(), tournamentLateRegistrationRepository: new PostgresTournamentLateRegistrationRepository(), tournamentLiveStateRepository: new PostgresTournamentLiveStateRepository() };
});
const { PostgresAdminAdmissionRepository } = await import('@/lib/repositories/admin-admission/PostgresAdminAdmissionRepository');
const { admitPlayerToTournament } = await import('@/features/tournament-waitlist-capacity');
const { commitTournamentCompletion } = await import('@/features/tournament-completion-commit');
const url = process.env.RERAISE_ADMIN_ADMISSION_TEST_DATABASE_URL;
if (url) {
    const u = new URL(url);
    if (u.hostname !== '127.0.0.1' || !u.pathname.startsWith('/reraise_admin_admission_test_'))
        throw Error('Disposable DB only');
}
let client: ReturnType<typeof postgres>;
const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tid = pid(500), staff = pid(900), repo = new PostgresAdminAdmissionRepository();
const request = (extra: Partial<StaffAdmissionInput> = {}): StaffAdmissionInput => ({ tournamentId: tid, requestId: randomUUID(), playerId: pid(9), expectedPhase: 'normal', confirmed: false, arrivalConfirmed: false, ...extra });
async function late() { await h.db.update(schema.tournaments).set({ lateRegistrationEndsAt: new Date('2026-01-01T22:00:00Z') }).where(eq(schema.tournaments.id, tid)); }
async function seed(n = 8) { for (let i = 1; i <= n; i++) {
    await h.db.insert(schema.registrations).values({ tournamentId: tid, playerId: pid(i), status: 'registered' });
    await h.db.insert(schema.tournamentAttendance).values({ tournamentId: tid, playerId: pid(i), arrived: true, arrivedAt: new Date() });
    await h.db.insert(schema.tournamentRebuyState).values({ tournamentId: tid, playerId: pid(i), rebuys: 1 });
} }
async function freeze() { const input = Array.from({ length: 8 }, (_, i) => ({ entries: 1, addons: 0, player_id: pid(i + 1), place: i + 1, arrived: true, knockouts: 0 })); await h.db.insert(schema.tournamentLateRegistration).values({ tournamentId: tid, arrivedPlayersCount: 8, initialStacksCount: 8, totalEntriesCount: 8, rebuysCount: 0, addonsCount: 0, tournamentType: 'classic', ratingFormulaVersion: 'v2', ratingPlaces: calculateRatingPlaceStructureForTournament(input, 'classic', 'v2') }); }
async function snapshotBytes() { const [r] = await client `select row_to_json(s)::text as b from tournament_late_registration s where tournament_id=${tid}`; return r?.b; }
describe.runIf(!!url)('Admin admission actual PostgreSQL', () => {
    beforeAll(async () => { vi.stubEnv('DATABASE_PROVIDER', 'postgres'); client = postgres(url!, { max: 10, prepare: false, onnotice: () => { } }); h.db = drizzle(client, { schema }); await client.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;'); await migrate(h.db, { migrationsFolder: 'lib/db/migrations' }); });
    afterAll(async () => { await client?.end(); vi.unstubAllEnvs(); });
    beforeEach(async () => { await client `truncate admin_tournament_admissions,results,tournaments,players cascade`; for (let i = 1; i <= 12; i++)
        await h.db.insert(schema.players).values({ id: pid(i), displayName: 'P' + i }); for (const [n, role, blocked] of [[900, 'admin', false], [901, 'operator', false], [902, 'player', false], [903, 'admin', true]] as const)
        await h.db.insert(schema.players).values({ id: pid(n), displayName: 'Role' + n, role, isBlocked: blocked }); await h.db.insert(schema.tournaments).values({ id: tid, title: 'Fixture CLASSIC', kind: 'free', status: 'open', startAt: new Date('2025-01-01T16:00:00Z'), maxPlayers: 46, tournamentType: 'classic', ratingFormulaVersion: 'v2', lateRegistrationEndsAt: new Date('2099-01-01T22:00:00Z') }); });
    it('ordinary self-registration before cutoff works', async () => { expect(await admitPlayerToTournament(tid, pid(9))).toMatchObject({ status: 'registered' }); });
    it('self-registration after cutoff rejected by DB even without snapshot', async () => { await late(); await expect(admitPlayerToTournament(tid, pid(9))).rejects.toThrow(); expect(await h.db.select().from(schema.registrations)).toHaveLength(0); });
    it('manual snapshot closes self-registration even before deadline', async () => { await freeze(); await expect(admitPlayerToTournament(tid, pid(9))).rejects.toThrow(); await expect(h.db.insert(schema.registrations).values({ tournamentId: tid, playerId: pid(9), status: 'registered' })).rejects.toThrow(); });
    it('admin after time before snapshot admitted, actor/mode audited', async () => { await late(); const r = await repo.admit(staff, request({ expectedPhase: 'after_time', confirmed: true })); expect(r.status).toBe('registered'); const [a] = await h.db.select().from(schema.adminAdmissions); expect(a).toMatchObject({ actorId: staff, playerId: pid(9), phase: 'after_time', state: 'succeeded', arrivalConfirmed: false }); expect(await h.db.select().from(schema.tournamentLateRegistration)).toHaveLength(0); });
    it('operator after snapshot admitted without changing frozen bytes or rules', async () => { await seed(); await late(); await freeze(); const b = await snapshotBytes(); const [t] = await h.db.select().from(schema.tournaments); await repo.admit(pid(901), request({ expectedPhase: 'after_snapshot', confirmed: true })); expect(await snapshotBytes()).toBe(b); expect((await h.db.select().from(schema.tournaments))[0]).toEqual(t); });
    it.each([902, 903])('DB role/blocked authorization rejects actor%d', async (n) => { await late(); await expect(repo.admit(pid(n), request({ expectedPhase: 'after_time', confirmed: true }))).rejects.toThrow('прав'); expect(await h.db.select().from(schema.adminAdmissions)).toHaveLength(0); });
    it('direct permit issuance by nonstaff is rejected at database level', async () => { await late(); await expect(client `select public.admin_issue_admission_permit(${randomUUID()}::uuid,${tid}::uuid,${pid(9)}::uuid,${pid(902)}::uuid,'after_time',true,false,'{}'::jsonb)`).rejects.toThrow('прав'); });
    it('forged client-like GUC alone cannot bypass deadline', async () => { await late(); await expect(h.db.transaction(async (tx) => { await tx.execute(sql `select set_config('reraise.admin_admission',${randomUUID()},true)`); await tx.insert(schema.registrations).values({ tournamentId: tid, playerId: pid(9), status: 'registered' }); })).rejects.toThrow(); });
    it('snapshot/time requires explicit phase-specific confirmation', async () => { await late(); await expect(repo.admit(staff, request({ expectedPhase: 'after_time', confirmed: false }))).rejects.toThrow('подтвердите'); expect(await h.db.select().from(schema.registrations)).toHaveLength(0); });
    it('stale before-snapshot approval is rejected without writes', async () => { await late(); await freeze(); await expect(repo.admit(staff, request({ expectedPhase: 'after_time', confirmed: true }))).rejects.toThrow('подтвердите'); });
    it('full active capacity is protected; no new player orphan', async () => { await h.db.update(schema.tournaments).set({ maxPlayers: 8 }).where(eq(schema.tournaments.id, tid)); await seed(); await late(); await expect(repo.admit(staff, request({ playerId: undefined, nickname: 'New visitor', expectedPhase: 'after_time', confirmed: true }))).rejects.toThrow('мест'); expect(await h.db.select().from(schema.players)).toHaveLength(16); });
    it('eliminated players free seats using canonical capacity model', async () => { await h.db.update(schema.tournaments).set({ maxPlayers: 1 }).where(eq(schema.tournaments.id, tid)); await seed(1); await h.db.insert(schema.tournamentPlayerEliminations).values({ tournamentId: tid, playerId: pid(1), eliminated: true }); await late(); expect((await repo.admit(staff, request({ expectedPhase: 'after_time', confirmed: true }))).status).toBe('registered'); });
    it('late no-show clearance requires separate physical consent and preserves audit and frozen bytes', async () => {
        await h.db.insert(schema.registrations).values({tournamentId:tid,playerId:pid(9),status:'waitlist',noShowAt:new Date()});
        await h.db.update(schema.players).set({onlineRegistrationRestrictedAt:new Date()}).where(eq(schema.players.id,pid(9)));
        await freeze(); await late(); const before=await snapshotBytes();
        expect((await repo.context(tid,pid(9))).noShowRestricted).toBe(true);
        await expect(repo.admit(staff,request({expectedPhase:'after_snapshot',confirmed:true,arrivalConfirmed:true}))).rejects.toThrow('отдельное');
        await expect(repo.admit(staff,request({expectedPhase:'after_snapshot',confirmed:true,noShowAdmissionConfirmed:true}))).rejects.toThrow('физическое');
        const r=await repo.admit(staff,request({expectedPhase:'after_snapshot',confirmed:true,arrivalConfirmed:true,noShowAdmissionConfirmed:true}));
        expect(r.status).toBe('registered'); expect((await repo.context(tid,pid(9))).noShowRestricted).toBe(false);
        const [a]=await h.db.select().from(schema.adminAdmissions);expect(a.input).toMatchObject({noShowAdmissionConfirmed:true});
        expect((a.input as {noShowBefore:{noShowAt:unknown}}).noShowBefore.noShowAt).toBeTruthy();expect(await snapshotBytes()).toBe(before);
    });
    it('failed capacity check cannot clear no-show restriction',async()=>{
        await seed(1);await h.db.update(schema.tournaments).set({maxPlayers:1}).where(eq(schema.tournaments.id,tid));
        await h.db.update(schema.players).set({onlineRegistrationRestrictedAt:new Date()}).where(eq(schema.players.id,pid(9)));await late();
        await expect(repo.admit(staff,request({expectedPhase:'after_time',confirmed:true,arrivalConfirmed:true,noShowAdmissionConfirmed:true}))).rejects.toThrow('мест');
        expect((await repo.context(tid,pid(9))).noShowRestricted).toBe(true);expect(await h.db.select().from(schema.adminAdmissions)).toHaveLength(0);
    });
    it('reactivation synchronizes existing paid live row and zero initial-stack row without duplication',async()=>{
        await h.db.update(schema.tournaments).set({kind:'paid'}).where(eq(schema.tournaments.id,tid));
        const [g]=await h.db.insert(schema.registrations).values({tournamentId:tid,playerId:pid(9),status:'cancelled'}).returning();
        await h.db.insert(schema.tournamentLiveEntries).values({tournamentId:tid,playerId:pid(9),registrationId:g.id,rebuys:0});
        await h.db.insert(schema.tournamentRebuyState).values({tournamentId:tid,playerId:pid(9),rebuys:0});await late();
        const q=request({expectedPhase:'after_time',confirmed:true,arrivalConfirmed:true});await repo.admit(staff,q);await repo.admit(staff,q);
        expect(await h.db.select().from(schema.tournamentLiveEntries)).toMatchObject([{registrationId:g.id,arrived:true,rebuys:1}]);
        expect(await h.db.select().from(schema.tournamentRebuyState)).toMatchObject([{rebuys:1,addons:0}]);
    });
    it('repeat and concurrent approval cannot duplicate registration', async () => { await late(); const q = request({ expectedPhase: 'after_time', confirmed: true }); const r = await Promise.all([repo.admit(staff, q), repo.admit(staff, q)]); expect(r.map(x => x.noOp).sort()).toEqual([false, true]); expect(await h.db.select().from(schema.registrations)).toHaveLength(1); expect(await h.db.select().from(schema.adminAdmissions)).toHaveLength(1); });
    it('genuinely new nickname works idempotently; existing nickname never duplicates account', async () => { await late(); const q = request({ playerId: undefined, nickname: 'New visitor', expectedPhase: 'after_time', confirmed: true }); await repo.admit(staff, q); expect((await repo.admit(staff, q)).noOp).toBe(true); await expect(repo.admit(staff, request({ playerId: undefined, nickname: 'p9', expectedPhase: 'after_time', confirmed: true }))).rejects.toThrow('существует'); expect(await h.db.select().from(schema.players)).toHaveLength(17); });
    it('merged-away account is not redirected/admitted', async () => { await h.db.update(schema.players).set({ mergedIntoPlayerId: pid(10) }).where(eq(schema.players.id, pid(9))); await late(); await expect(repo.admit(staff, request({ expectedPhase: 'after_time', confirmed: true }))).rejects.toThrow('аккаунт'); });
    it('no-show restriction is preserved; normal mode waitlists, late mode fails closed', async () => { await h.db.update(schema.players).set({ onlineRegistrationRestrictedAt: new Date() }).where(eq(schema.players.id, pid(9))); expect((await repo.admit(staff, request())).status).toBe('waitlist'); await late(); await expect(repo.admit(staff, request({ expectedPhase: 'after_time', confirmed: true }))).rejects.toThrow('неявки'); });
    it('late admission does not jump eligible FIFO waitlist', async () => { await h.db.insert(schema.registrations).values({ tournamentId: tid, playerId: pid(8), status: 'waitlist' }); await late(); await expect(repo.admit(staff, request({ expectedPhase: 'after_time', confirmed: true }))).rejects.toThrow('первого'); expect((await repo.admit(staff, request({ playerId: pid(8), expectedPhase: 'after_time', confirmed: true }))).status).toBe('registered'); });
    it('normal mode retains FIFO promotion and claims notification once', async () => { await h.db.insert(schema.registrations).values({ tournamentId: tid, playerId: pid(8), status: 'waitlist' }); const r = await repo.admit(staff, request()); expect(r.promoted).toHaveLength(1); expect((await h.db.select().from(schema.registrations)).filter(x => x.status === 'registered')).toHaveLength(2); });
    it('concurrent last-seat requests serialize without overfill', async () => { await h.db.update(schema.tournaments).set({ maxPlayers: 1 }).where(eq(schema.tournaments.id, tid)); await late(); const r = await Promise.allSettled([repo.admit(staff, request({ expectedPhase: 'after_time', confirmed: true })), repo.admit(staff, request({ playerId: pid(10), expectedPhase: 'after_time', confirmed: true }))]); expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect(await h.db.select().from(schema.registrations)).toHaveLength(1); });
    it('completed tournament rejects every new admission', async () => { await h.db.update(schema.tournaments).set({ status: 'completed' }).where(eq(schema.tournaments.id, tid)); await expect(repo.admit(staff, request())).rejects.toThrow('завершён'); });
    it('privileged scope cannot leak to subsequent self-registration', async () => { await late(); await repo.admit(staff, request({ expectedPhase: 'after_time', confirmed: true })); await expect(client `insert into registrations(tournament_id,player_id,status) values(${tid},${pid(10)},'registered')`).rejects.toThrow('Поздняя'); });
    it('new winner and non-ITM entrant use ORIGINAL frozen places at canonical completion', async () => { await seed(); await late(); await freeze(); const bytes = await snapshotBytes(); const [s] = await h.db.select().from(schema.tournamentLateRegistration); for (const n of [9, 10])
        await repo.admit(staff, request({ playerId: pid(n), expectedPhase: 'after_snapshot', confirmed: true, arrivalConfirmed: true })); const order = [9, 1, 2, 3, 4, 5, 6, 7, 8, 10]; const inputs = order.map((n, i) => ({ player_id: pid(n), place: i + 1, arrived: true, entries: 1, addons: 0, knockouts: 0 })); const calc = calculateRatingPointsForTournament(inputs, 'classic', 'v2', { ratingPlaces: s.ratingPlaces }); await commitTournamentCompletion({ tournamentId: tid, attendedPlayerIds: order.map(pid), results: calc.results.map((r, i) => ({ tournament_id: tid, player_id: r.player_id, season_id: null, place: i + 1, reentries: 1, addons: 0, knockouts: 0, rating_points: r.rating_points, arrived: true, participation_points: r.participation_points, itm_points: r.itm_points, knockout_points: 0, boss_bounty_points: 0, mystery_bounty_points: 0 })) }); const rs = await h.db.select().from(schema.results); expect(rs.find(r => r.playerId === pid(9))!.itmPoints).toBe(s.ratingPlaces[0].points); expect(rs.find(r => r.playerId === pid(10))!.ratingPoints).toBe(2); expect(rs.reduce((n, r) => n + r.itmPoints!, 0)).toBe(s.ratingPlaces.reduce((n, r) => n + r.points, 0)); expect(await snapshotBytes()).toBe(bytes); expect(await h.db.select().from(schema.tournamentLateRegistration)).toHaveLength(1); });
    it('stale completion cannot silently omit a newly admitted player', async () => { await seed(); await late(); await freeze(); await repo.admit(staff, request({ expectedPhase: 'after_snapshot', confirmed: true, arrivalConfirmed: true })); await expect(commitTournamentCompletion({ tournamentId: tid, attendedPlayerIds: [], results: [] })).rejects.toThrow(); expect((await h.db.select().from(schema.tournaments))[0].status).toBe('open'); expect(await h.db.select().from(schema.results)).toHaveLength(0); });
    it('arrived admission before manual closure enters canonical snapshot', async () => {
        await seed();
        await late();
        await repo.admit(staff, request({ expectedPhase: 'after_time', confirmed: true, arrivalConfirmed: true }));
        const { closeTournamentLateRegistration } = await import('@/features/late-registration');
        const closed = await closeTournamentLateRegistration(tid);
        expect(closed).toMatchObject({ arrived_players_count: 9, initial_stacks_count: 9, total_entries_count: 9 });
    });
    it('concurrent manual close/admission serializes or requires fresh confirmation', async () => {
        await seed();
        await late();
        const { closeTournamentLateRegistration } = await import('@/features/late-registration');
        const r = await Promise.allSettled([repo.admit(staff, request({ expectedPhase: 'after_time', confirmed: true, arrivalConfirmed: true })), closeTournamentLateRegistration(tid)]);
        expect(r[1].status).toBe('fulfilled');
        const [s] = await h.db.select().from(schema.tournamentLateRegistration);
        expect(s.arrivedPlayersCount).toBe(r[0].status === 'fulfilled' ? 9 : 8);
        expect(await h.db.select().from(schema.tournamentLateRegistration)).toHaveLength(1);
    });
    it('operational export/attendance see the same committed entrant', async () => {
        await late();
        await repo.admit(staff, request({ expectedPhase: 'after_time', confirmed: true, arrivalConfirmed: true }));
        const { PostgresRegistrationRepository } = await import('@/lib/repositories/registration/PostgresRegistrationRepository');
        const { PostgresTournamentLiveStateRepository } = await import('@/lib/repositories/tournament-live-state/PostgresTournamentLiveStateRepository');
        expect((await new PostgresRegistrationRepository().findExportParticipants(tid)).map(r => r.player_id)).toContain(pid(9));
        expect((await new PostgresTournamentLiveStateRepository().findAttendedPlayersWithDetails(tid)).map(r => r.player_id)).toContain(pid(9));
    });
    it('deferred COMMIT failure rolls back new account,registration,audit and arrival', async () => {
        await late();
        await client.unsafe(`CREATE OR REPLACE FUNCTION admission_test_commit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'deliberate deferred failure'; END $$; CREATE CONSTRAINT TRIGGER admission_test_commit_fail AFTER INSERT ON admin_tournament_admissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION admission_test_commit_fail();`);
        try {
            await expect(repo.admit(staff, request({ playerId: undefined, nickname: 'Rollback visitor', expectedPhase: 'after_time', confirmed: true, arrivalConfirmed: true }))).rejects.toThrow();
            expect(await h.db.select().from(schema.players)).toHaveLength(16);
            expect(await h.db.select().from(schema.registrations)).toHaveLength(0);
            expect(await h.db.select().from(schema.adminAdmissions)).toHaveLength(0);
            expect(await h.db.select().from(schema.tournamentAttendance)).toHaveLength(0);
        }
        finally {
            await client.unsafe('DROP TRIGGER admission_test_commit_fail ON admin_tournament_admissions');
        }
    });
    it('public/admin read models retain frozen prize count despite larger live field', async () => {
        await seed();
        await late();
        await freeze();
        const [s] = await h.db.select().from(schema.tournamentLateRegistration);
        await repo.admit(staff, request({ expectedPhase: 'after_snapshot', confirmed: true }));
        const { PostgresTournamentRepository } = await import('@/lib/repositories/tournament/PostgresTournamentRepository');
        const r = new PostgresTournamentRepository();
        expect((await r.findById(tid)).frozen_rating_places_count).toBe(s.ratingPlaces.length);
        expect((await r.listOpen())[0].frozen_rating_places_count).toBe(s.ratingPlaces.length);
        expect((await r.listByStatuses(['open']))[0].frozen_rating_places_count).toBe(s.ratingPlaces.length);
    });
});
