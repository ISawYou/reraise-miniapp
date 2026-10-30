import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import type { db as Database } from "@/lib/db";
import { getFreeSheetColumnLayout } from "@/lib/tournament-sheet-parsing";
// Never use DATABASE_URL; run ONLY against an explicitly disposable local DB.
const url=process.env.RERAISE_KO_TEST_DATABASE_URL;
if(url){const p=new URL(url);if(!["127.0.0.1","localhost"].includes(p.hostname)||!p.pathname.startsWith("/reraise_ko_test_"))throw new Error("KO tests require a disposable localhost database");}
const authErrors=vi.hoisted(()=>({ UnauthorizedActionError:class UnauthorizedActionError extends Error {}, ForbiddenActionError:class ForbiddenActionError extends Error {} }));
const h=vi.hoisted(()=>({db:null as unknown as typeof Database,fault:"",auth:vi.fn(),achievements:vi.fn(),readSheet:vi.fn(),writeSheet:vi.fn(),winner:vi.fn()}));
vi.mock("@/lib/db",()=>({db:new Proxy({}, {get(_target,key){if(key==="transaction")return async(fn:(tx:unknown)=>Promise<unknown>)=>h.db.transaction(async tx=>{const value=await fn(tx);if(h.fault==="after-update")throw new Error("simulated DB failure after UPDATE");if(h.fault==="commit")await tx.execute(sql`set local ko_test.fail_commit='on'`);return value;});const v=Reflect.get(h.db,key);return typeof v==="function"?v.bind(h.db):v;}})}));
vi.mock("@/lib/admin-auth",()=>({...authErrors,assertServerActorRole:h.auth}));
vi.mock("@/features/achievements",()=>({syncPlayerAchievements:h.achievements}));
vi.mock("@/features/club-activity",()=>({publishTournamentWinnerEvent:h.winner,publishLegendaryAchievementEvent:vi.fn()}));
vi.mock("@/lib/google-sheets",()=>({readSpreadsheetTabValues:h.readSheet,batchUpdateSpreadsheetValues:h.writeSheet}));
const service=await import("@/features/completed-tournament-knockout-correction");
const route=await import("@/app/api/admin/tournaments/[id]/completed-knockout-correction/route");
const {UnauthorizedActionError,ForbiddenActionError}=await import("@/lib/admin-auth");
const {isAdminRouteAllowedForOperator}=await import("@/lib/admin-permissions");
const tid="11111111-1111-4111-8111-111111111111",pid="22222222-2222-4222-8222-222222222222",other="33333333-3333-4333-8333-333333333333";
let client:ReturnType<typeof postgres>;
const originalProvider=process.env.DATABASE_PROVIDER;
const ctx={params:Promise.resolve({id:tid})};
const request=(body:unknown)=>new Request("http://isolated.test/api/admin/tournaments/"+tid+"/completed-knockout-correction",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
async function readRow(id=pid){return (await client`select * from results where player_id=${id}`)[0];}
async function command(ko=4,boss=0){const s=await service.getCompletedKnockoutSnapshot(tid,pid);return {player_id:pid,knockouts:ko,boss_knockouts:boss,revision:s.revision};}
function sheet(type:"bounty"|"boss_bounty"="bounty",ids=[other,pid]){return [...Array.from({length:6},()=>[] as string[]),getFreeSheetColumnLayout(type).headers,...ids.map(id=>[id,...Array(18).fill("")])];}

describe.runIf(!!url)("real PostgreSQL completed KO correction service and API",()=>{
 beforeAll(async()=>{
  client=postgres(url!,{max:8,onnotice:()=>{}});h.db=drizzle(client);
  await client.unsafe(`CREATE TABLE IF NOT EXISTS tournaments(id uuid primary key,status text not null,kind text not null,tournament_type text not null,google_sheet_tab_name text,is_final boolean not null default false,rating_formula_version text not null default 'v2');
CREATE TABLE IF NOT EXISTS results(id uuid primary key,tournament_id uuid not null references tournaments(id),player_id uuid not null,season_id uuid,place integer not null check(place>0),reentries integer not null,knockouts integer not null,boss_knockouts integer not null,addons integer not null,free_reentries integer not null,mystery_bounty_points integer not null,rating_points integer not null check(rating_points>=0),arrived boolean,participation_points integer check(participation_points>=0),knockout_points integer check(knockout_points>=0),boss_bounty_points integer check(boss_bounty_points>=0),itm_points integer check(itm_points>=0),club_discount_percent integer not null,created_at timestamptz not null default now(),unique(tournament_id,player_id),unique(tournament_id,place),constraint results_rating_points_breakdown_check check(rating_points=participation_points+knockout_points+boss_bounty_points+mystery_bounty_points+itm_points));
CREATE OR REPLACE FUNCTION ko_test_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('ko_test.fail_commit',true)='on' THEN RAISE EXCEPTION 'deliberate deferred COMMIT failure'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS ko_test_commit_guard ON results;
CREATE CONSTRAINT TRIGGER ko_test_commit_guard AFTER UPDATE ON results DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ko_test_commit_guard();`);
 });
 afterAll(async()=>{process.env.DATABASE_PROVIDER=originalProvider;await client?.end();});
 beforeEach(async()=>{
  process.env.DATABASE_PROVIDER="postgres";h.fault="";h.auth.mockReset().mockResolvedValue({role:"admin"});h.achievements.mockReset().mockResolvedValue({});h.readSheet.mockReset().mockResolvedValue(sheet());h.writeSheet.mockReset().mockResolvedValue(undefined);h.winner.mockReset();
  await client`truncate results,tournaments`;
  await client`insert into tournaments(id,status,kind,tournament_type) values (${tid},'completed','free','bounty')`;
  for(const [id,place] of [[pid,1],[other,2]] as const)await client`insert into results(id,tournament_id,player_id,place,reentries,knockouts,boss_knockouts,addons,free_reentries,mystery_bounty_points,rating_points,arrived,participation_points,knockout_points,boss_bounty_points,itm_points,club_discount_percent) values (${id},${tid},${id},${place},3,2,0,2,1,0,112,true,2,10,0,100,20)`;
 });
 it("2→4 changes ONLY KO components/rating; winner, place, ITM, money/entry facts and other player unchanged",async()=>{
  const before=await readRow(),untouched=await readRow(other);const r=await route.POST(request(await command()),ctx);expect(r.status).toBe(200);expect((await r.json()).result).toMatchObject({knockouts:4,rating_points:122,place:1});
  const after=await readRow();expect(after).toEqual({...before,knockouts:4,knockout_points:20,rating_points:122});expect(await readRow(other)).toEqual(untouched);expect(after.rating_points).toBe(after.participation_points+after.knockout_points+after.boss_bounty_points+after.mystery_bounty_points+after.itm_points);
 });
 it("4→1 reduces rating fifteen",async()=>{await service.correctCompletedTournamentKnockouts(tid,await command());expect((await service.correctCompletedTournamentKnockouts(tid,await command(1))).result.rating_points).toBe(107);});
 it("Boss KO updates independently",async()=>{await client`update tournaments set tournament_type='boss_bounty'`;const r=await service.correctCompletedTournamentKnockouts(tid,await command(2,3));expect(r.result).toMatchObject({knockouts:2,boss_knockouts:3,rating_points:142});expect((await readRow()).knockout_points).toBe(10);expect((await readRow()).boss_bounty_points).toBe(30);});
 it("repeat stale submission is 409 and never reapplied",async()=>{const c=await command();expect((await route.POST(request(c),ctx)).status).toBe(200);expect((await route.POST(request(c),ctx)).status).toBe(409);expect((await readRow()).rating_points).toBe(122);expect(h.achievements).toHaveBeenCalledTimes(1);});
 it("revision detects a concurrent place correction even if KO did not change",async()=>{const c=await command();await client`update results set itm_points=101,rating_points=113 where player_id=${pid}`;expect((await route.POST(request(c),ctx)).status).toBe(409);expect((await readRow()).knockouts).toBe(2);});
 it.each([-1,1.5,"4",null,2147483648])("rejects invalid input %s with zero writes",async ko=>{const before=await readRow();expect((await route.POST(request({...await command(),knockouts:ko}),ctx)).status).toBe(400);expect(await readRow()).toEqual(before);});
 it.each(["open","closed","draft"])("rejects %s before update",async status=>{const c=await command();await client`update tournaments set status=${status}`;expect((await route.POST(request(c),ctx)).status).toBe(409);expect((await readRow()).rating_points).toBe(112);});
 it("rejects unsupported format",async()=>{const c=await command();await client`update tournaments set tournament_type='mystery_bounty'`;expect((await route.POST(request(c),ctx)).status).toBe(409);});
 it("requires an existing player result",async()=>{const c=await command();expect((await route.POST(request({...c,player_id:"44444444-4444-4444-8444-444444444444"}),ctx)).status).toBe(409);});
 it.each([401,403])("service and API reject unauthorized/operator (%s) before DB access",async status=>{
  const c=await command();h.auth.mockRejectedValue(status===401?new UnauthorizedActionError():new ForbiddenActionError());expect((await route.POST(request(c),ctx)).status).toBe(status);expect((await route.GET(new Request("http://isolated.test/?player_id="+pid),ctx)).status).toBe(status);expect((await readRow()).knockouts).toBe(2);expect(h.achievements).not.toHaveBeenCalled();
 });
 it("operator allowlist denies both methods",()=>{for(const method of ["GET","POST"])expect(isAdminRouteAllowedForOperator(method,`/api/admin/tournaments/${tid}/completed-knockout-correction`)).toBe(false);});
 it("requires PostgreSQL and returns 503 otherwise",async()=>{const c=await command();process.env.DATABASE_PROVIDER="supabase";expect((await route.POST(request(c),ctx)).status).toBe(503);expect((await readRow()).knockouts).toBe(2);});
 it.each(["after-update","commit"])("real transaction rolls back on %s failure; no post-commit effects",async fault=>{
  const c=await command(),before=await readRow();h.fault=fault;expect((await route.POST(request(c),ctx)).status).toBe(500);expect(await readRow()).toEqual(before);expect(h.achievements).not.toHaveBeenCalled();expect(h.readSheet).not.toHaveBeenCalled();h.fault="";
 });
 it("achievement sync sees committed results from an independent connection; no winner events",async()=>{
  h.achievements.mockImplementationOnce(async(id:string)=>{expect(id).toBe(pid);expect((await readRow()).rating_points).toBe(122);});await service.correctCompletedTournamentKnockouts(tid,await command());expect(h.achievements).toHaveBeenCalledWith(pid);expect(h.winner).not.toHaveBeenCalled();
 });
 it("achievement failure warns after commit",async()=>{h.achievements.mockRejectedValueOnce(new Error("offline"));const r=await service.correctCompletedTournamentKnockouts(tid,await command());expect(r.warnings.join()).toContain("достижения");expect((await readRow()).knockouts).toBe(4);});
 it("Google Sheet touches ONLY KO and rating by Player ID, not player order",async()=>{
  await client`update tournaments set google_sheet_tab_name='Club night'`;await service.correctCompletedTournamentKnockouts(tid,await command());expect(h.writeSheet).toHaveBeenCalledWith([{range:"'Club night'!L9",values:[[4]]},{range:"'Club night'!N9",values:[[122]]}], {timeout:10000,retry:false});
 });
 it("Boss Sheet touches only KO/Boss/rating, safely quotes apostrophes",async()=>{
  await client`update tournaments set tournament_type='boss_bounty',google_sheet_tab_name='Boss''s night'`;h.readSheet.mockResolvedValueOnce(sheet("boss_bounty"));await service.correctCompletedTournamentKnockouts(tid,await command(2,3));expect(h.writeSheet).toHaveBeenCalledWith([{range:"'Boss''s night'!L9",values:[[2]]},{range:"'Boss''s night'!O9",values:[[142]]},{range:"'Boss''s night'!M9",values:[[3]]}], {timeout:10000,retry:false});
 });
 it.each(["read","write","duplicate","missing","header"])("Google %s failure preserves committed result and returns warning",async failure=>{
  await client`update tournaments set google_sheet_tab_name='Club night'`;
  if(failure==="read")h.readSheet.mockRejectedValueOnce(new Error("offline"));if(failure==="write")h.writeSheet.mockRejectedValueOnce(new Error("offline"));if(failure==="duplicate")h.readSheet.mockResolvedValueOnce(sheet("bounty",[pid,pid]));if(failure==="missing")h.readSheet.mockResolvedValueOnce(sheet("bounty",[other]));if(failure==="header")h.readSheet.mockResolvedValueOnce([]);
  const r=await service.correctCompletedTournamentKnockouts(tid,await command());expect(r.warnings.join()).toContain("Google");expect((await readRow()).rating_points).toBe(122);if(["duplicate","missing","header"].includes(failure))expect(h.writeSheet).not.toHaveBeenCalled();
 });
 it("legacy proven delta preserves NULL ITM",async()=>{await client`update results set itm_points=null where player_id=${pid}`;await service.correctCompletedTournamentKnockouts(tid,await command());expect(await readRow()).toMatchObject({itm_points:null,participation_points:2,knockout_points:20,rating_points:122});});
 it("legacy ambiguous missing KO and ITM fails closed",async()=>{await client`update results set itm_points=null,knockout_points=null where player_id=${pid}`;await expect(command()).rejects.toThrow(service.LEGACY_KO_MESSAGE);expect((await readRow()).rating_points).toBe(112);});
 it("a concurrent external tournament lock really blocks correction until released",async()=>{
  const c=await command();const external=postgres(url!,{max:1});let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>{enter=r;}),gate=new Promise<void>(r=>{release=r;});const holding=external.begin(async tx=>{await tx`select id from tournaments where id=${tid} for update`;enter();await gate;});await entered;const pending=service.correctCompletedTournamentKnockouts(tid,c);
  try{let waiting=false;for(let i=0;i<40;i++){const rows=await client`select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event_type='Lock'`;if(rows[0].n){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}expect(waiting).toBe(true);}finally{release();await holding;await external.end();}expect((await pending).result.knockouts).toBe(4);
 });
 it("concurrent same-snapshot requests serialize: exactly one success",async()=>{const c=await command();const responses=await Promise.all([route.POST(request(c),ctx),route.POST(request({...c,knockouts:1}),ctx)]);expect(responses.map(r=>r.status).sort()).toEqual([200,409]);expect(h.achievements).toHaveBeenCalledTimes(1);});
 it("Sheets pushes latest committed values when post-commit work is interleaved",async()=>{
  await client`update tournaments set google_sheet_tab_name='Club night'`;let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>{enter=r;}),gate=new Promise<void>(r=>{release=r;});h.achievements.mockImplementationOnce(async()=>{enter();await gate;});const one=service.correctCompletedTournamentKnockouts(tid,await command(4));await entered;const two=await service.correctCompletedTournamentKnockouts(tid,await command(1));release();await one;expect(two.result.knockouts).toBe(1);expect(h.writeSheet).toHaveBeenCalledTimes(2);for(const [updates] of h.writeSheet.mock.calls)expect(updates).toContainEqual({range:"'Club night'!L9",values:[[1]]});
 });
});
