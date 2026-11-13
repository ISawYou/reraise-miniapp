import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const url = process.env.RERAISE_ADMIN_ADMISSION_MIGRATION_TEST_DATABASE_URL;
if (url) {
    const u = new URL(url);
    if (u.hostname !== '127.0.0.1' || !u.pathname.startsWith('/reraise_admin_admission_test_'))
        throw Error('Disposable DB only');
}
let client: ReturnType<typeof postgres>;
let before: string, hashes: string[];
describe.runIf(!!url)('0037→0038 production-shaped migration compatibility', () => {
    beforeAll(async () => { client = postgres(url!, { prepare: false, onnotice: () => { } }); await client.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;'); const folder = mkdtempSync(path.join(tmpdir(), 'reraise-admission-baseline-')); mkdirSync(path.join(folder, 'meta')); const root = 'lib/db/migrations'; const j = JSON.parse(readFileSync(root + '/meta/_journal.json', 'utf8')); expect(j.entries.at(-1).tag).toBe('0038_staff_live_operations_hotfix'); j.entries.pop(); expect(j.entries.at(-1).tag).toBe('0037_admin_late_admission'); expect(j.entries.some((e: {
        tag: string;
    }) => e.tag.startsWith('0035'))).toBe(false); hashes = []; for (const e of j.entries) {
        const f = e.tag + '.sql';
        const bytes = readFileSync(root + '/' + f);
        expect(bytes.equals(execFileSync('git', ['show', 'HEAD:' + root + '/' + f]))).toBe(true);
        hashes.push(createHash('sha256').update(bytes).digest('hex'));
        copyFileSync(root + '/' + f, path.join(folder, f));
    } writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify(j)); await migrate(drizzle(client), { migrationsFolder: folder }); await client.unsafe("insert into players(id,display_name) values('00000000-0000-4000-8000-000000000001','Historical player');insert into tournaments(id,title,kind,status,start_at,max_players,tournament_type,rating_formula_version) values('00000000-0000-4000-8000-000000000002','Historical tournament','free','completed','2025-01-01',46,'classic','v2');insert into results(tournament_id,player_id,place,rating_points) values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',1,57);"); const [r] = await client `select jsonb_build_object('players',(select jsonb_agg(p)from players p),'tournaments',(select jsonb_agg(t)from tournaments t),'results',(select jsonb_agg(r)from results r)) as data`; before = JSON.stringify(r.data); await migrate(drizzle(client), { migrationsFolder: root }); });
    afterAll(async () => client?.end());
    it('existing records remain byte-equivalent and historical tracking hashes unchanged', async () => { const [r] = await client `select jsonb_build_object('players',(select jsonb_agg(p)from players p),'tournaments',(select jsonb_agg(t)from tournaments t),'results',(select jsonb_agg(r)from results r)) as data`; expect(JSON.stringify(r.data)).toBe(before); const tracking = await client `select hash from drizzle.__drizzle_migrations order by id`; expect(tracking.slice(0, -1).map(r => r.hash)).toEqual(hashes); expect(tracking.at(-1)!.hash).toBe(createHash('sha256').update(readFileSync('lib/db/migrations/0038_staff_live_operations_hotfix.sql')).digest('hex')); expect((await client `select count(*)::int as n from staff_tournament_live_edits`)[0].n).toBe(0); });
    it('private permit functions are not PUBLIC executable; new snapshot follows 0037', async () => { const [r] = await client `select count(*)::int as n from pg_proc p cross join lateral aclexplode(p.proacl) a where p.proname in ('issue_staff_live_edit_permit','staff_live_edit_permitted') and a.grantee=0 and a.privilege_type='EXECUTE'`; expect(r.n).toBe(0); const next = JSON.parse(readFileSync('lib/db/migrations/meta/0038_snapshot.json', 'utf8')); const prev = JSON.parse(readFileSync('lib/db/migrations/meta/0037_snapshot.json', 'utf8')); expect(next.prevId).toBe(prev.id); expect(next.tables['public.staff_tournament_live_edits']).toBeTruthy(); });
});
