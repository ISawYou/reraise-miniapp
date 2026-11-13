import {beforeAll,afterAll,it,expect,vi} from "vitest";
import postgres from "postgres";
import {drizzle} from "drizzle-orm/postgres-js";
import {migrate} from "drizzle-orm/postgres-js/migrator";
import {randomUUID,createHash} from "node:crypto";
import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {eq} from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type {db as DB} from "@/lib/db";
const h=vi.hoisted(()=>({db:null as unknown as typeof DB}));
vi.mock("@/lib/db",()=>({db:new Proxy({},{get(_t,k){const v=Reflect.get(h.db,k);return typeof v==="function"?v.bind(h.db):v;}})}));
const url=process.env.MERGE_GUARD_TEST_DATABASE_URL;
if(url){const u=new URL(url);if(u.hostname!=="127.0.0.1"||!u.pathname.startsWith("/reraise_admin_admission_test_merge_guard_"))throw Error("Disposable merge-guard DB only");}
let client:ReturnType<typeof postgres>;let merge:typeof import("@/lib/player-merge");const admin=randomUUID();const fixtures:string[]=[];
beforeAll(async()=>{if(!url)return;client=postgres(url,{prepare:false,onnotice:()=>{}});h.db=drizzle(client,{schema});
 const root="lib/db/migrations",journal=JSON.parse(readFileSync(root+"/meta/_journal.json","utf8"));
 for(const e of journal.entries.filter((e:{idx:number})=>e.idx<=38)){const path=`${root}/${e.tag}.sql`;expect(readFileSync(path).equals(execFileSync("git",["show",`5744fc4:${path}`]))).toBe(true);}
 if(process.env.MERGE_GUARD_UPGRADE==="0038"){
  const folder=mkdtempSync("/private/tmp/reraise-merge-0038-");mkdirSync(folder+"/meta");const prefix={...journal,entries:journal.entries.filter((e:{idx:number})=>e.idx<=38)};
  for(const e of prefix.entries)copyFileSync(`${root}/${e.tag}.sql`,`${folder}/${e.tag}.sql`);writeFileSync(folder+"/meta/_journal.json",JSON.stringify(prefix));await migrate(h.db,{migrationsFolder:folder});
  const pid=randomUUID(),tid=randomUUID();fixtures.push(tid);await client`insert into players(id,display_name) values(${pid},'Upgrade sentinel')`;await client`insert into tournaments(id,title,start_at,max_players,status) values(${tid},'Upgrade sentinel',now(),46,'completed')`;await client`insert into results(tournament_id,player_id,place,rating_points) values(${tid},${pid},1,57)`;await client`insert into tournament_late_registration(tournament_id,arrived_players_count,initial_stacks_count,total_entries_count,rebuys_count,addons_count,tournament_type,rating_formula_version,rating_places) values(${tid},1,1,1,0,0,'classic','v2','[{"place":1,"points":55}]')`;
  const capture=async()=>JSON.stringify((await client`select jsonb_build_object('results',(select jsonb_agg(r)from results r where tournament_id=${tid}),'snapshot',(select to_jsonb(l)from tournament_late_registration l where tournament_id=${tid})) as data`)[0].data);const before=await capture();await migrate(h.db,{migrationsFolder:root});expect(await capture()).toBe(before);
 }else await migrate(h.db,{migrationsFolder:root});
 const hashes=await client`select hash from drizzle.__drizzle_migrations order by created_at,id`;expect(hashes.map(r=>r.hash)).toEqual(journal.entries.map((e:{tag:string})=>createHash("sha256").update(readFileSync(`${root}/${e.tag}.sql`)).digest("hex")));
 await h.db.insert(schema.players).values({id:admin,displayName:"Maintenance admin",role:"admin"});merge=await import("@/lib/player-merge");
});
afterAll(async()=>{if(!client)return;for(const id of fixtures)await h.db.delete(schema.tournaments).where(eq(schema.tournaments.id,id));await client.end();});
async function fixture(overlap=false,completed=true,operations=false){
 const source=randomUUID(),target=randomUUID(),tournament=randomUUID();fixtures.push(tournament);
 await h.db.insert(schema.players).values([{id:source,displayName:"Merge source",email:`source-${source}@merge-guard.test`},{id:target,displayName:"Merge target"}]);
 await h.db.insert(schema.tournaments).values({id:tournament,title:"Guard fixture",kind:"free",startAt:new Date("2026-01-01"),maxPlayers:46,status:"open"});
 for(const [pid,arrived,entries,stamp] of [[source,true,3,"2026-01-01T18:00:00Z"],...(overlap?[[target,false,1,"2026-01-01T17:00:00Z"]]:[])] as [string,boolean,number,string][]){await h.db.insert(schema.registrations).values({tournamentId:tournament,playerId:pid,status:"registered"});await h.db.insert(schema.tournamentAttendance).values({tournamentId:tournament,playerId:pid,arrived,arrivedAt:arrived?new Date(stamp):null,updatedAt:new Date(stamp)});await h.db.insert(schema.tournamentPlayerEliminations).values({tournamentId:tournament,playerId:pid,eliminated:arrived,eliminatedAt:arrived?new Date(stamp):null,updatedAt:new Date(stamp)});await h.db.insert(schema.tournamentRebuyState).values({tournamentId:tournament,playerId:pid,rebuys:entries,addons:arrived?1:0});}
 await h.db.insert(schema.results).values({tournamentId:tournament,playerId:source,place:1,ratingPoints:67,participationPoints:2,itmPoints:50,knockoutPoints:15,bossBountyPoints:0,mysteryBountyPoints:0,arrived:true,reentries:3,addons:1});
 await h.db.insert(schema.tournamentLateRegistration).values({tournamentId:tournament,arrivedPlayersCount:1,initialStacksCount:1,totalEntriesCount:3,rebuysCount:2,addonsCount:1,tournamentType:"classic",ratingFormulaVersion:"v2",ratingPlaces:[{place:1,points:50}]});
 if(operations)await h.db.insert(schema.tournamentOperations).values({tournamentId:tournament,playerId:source,updatedBy:admin,comment:"history"});
 if(completed)await h.db.update(schema.tournaments).set({status:"completed"}).where(eq(schema.tournaments.id,tournament));return {source,target,tournament};
}
async function frozen(tid:string){return (await client`select row_to_json(l)::text as value from tournament_late_registration l where tournament_id=${tid}`)[0].value;}
it.runIf(!!url).each([false,true])("real admin merge of completed history (overlap %s) preserves ratings and canonical reconciliation",async overlap=>{
 const f=await fixture(overlap),before=await frozen(f.tournament),[result]=await h.db.select().from(schema.results).where(eq(schema.results.tournamentId,f.tournament));
 expect(await merge.executeAdminMerge({targetPlayerId:f.target,sourcePlayerId:f.source,actorPlayerId:admin,confirmation:merge.ADMIN_MERGE_CONFIRMATION})).toMatchObject({merged:true});
 const [after]=await h.db.select().from(schema.results).where(eq(schema.results.tournamentId,f.tournament));expect(after).toEqual({...result,playerId:f.target});expect(await frozen(f.tournament)).toBe(before);
 const [a]=await h.db.select().from(schema.tournamentAttendance).where(eq(schema.tournamentAttendance.tournamentId,f.tournament));const [e]=await h.db.select().from(schema.tournamentPlayerEliminations).where(eq(schema.tournamentPlayerEliminations.tournamentId,f.tournament));const [b]=await h.db.select().from(schema.tournamentRebuyState).where(eq(schema.tournamentRebuyState.tournamentId,f.tournament));expect(a).toMatchObject({playerId:f.target,arrived:true});expect(e).toMatchObject({playerId:f.target,eliminated:true});expect(b).toMatchObject({playerId:f.target,rebuys:3,addons:1});
 await expect(client`update tournament_attendance set arrived=false where tournament_id=${f.tournament}`).rejects.toThrow();
});
it.runIf(!!url)("self-service merge uses its server-issued intent and cannot transfer permission to a later transaction",async()=>{
 const f=await fixture();await h.db.update(schema.players).set({telegramId:Math.floor(Math.random()*1e12)}).where(eq(schema.players.id,f.target));const intent=randomUUID();await h.db.insert(schema.playerMergeIntents).values({id:intent,targetPlayerId:f.target,sourcePlayerId:f.source,email:`source-${f.source}@merge-guard.test`,expiresAt:new Date(Date.now()+60000)});
 expect(await merge.executeMerge({intentId:intent,sessionPlayerId:f.target})).toMatchObject({merged:true});await expect(client`update tournament_player_eliminations set eliminated=false where tournament_id=${f.tournament}`).rejects.toThrow();
});
it.runIf(!!url)("player cascade cleanup succeeds while direct completed edits/deletes and forged flags are rejected",async()=>{
 const f=await fixture(false,true,true),before=await frozen(f.tournament);
 // Insert operational fixture before completion; guard must reject it now.
 await expect(client`insert into tournament_operations(tournament_id,player_id,updated_by) values(${f.tournament},${f.target},${admin})`).rejects.toThrow();
 await expect(client`update tournament_attendance set arrived=false where tournament_id=${f.tournament}`).rejects.toThrow();await expect(client`delete from tournament_player_eliminations where tournament_id=${f.tournament}`).rejects.toThrow();
 await expect(client`update tournament_operations set comment='forbidden' where tournament_id=${f.tournament}`).rejects.toThrow();await expect(client`delete from tournament_operations where tournament_id=${f.tournament}`).rejects.toThrow();
 await expect(h.db.transaction(async tx=>{await tx.execute((await import("drizzle-orm")).sql`select set_config('reraise.account_merge','true',true)`);await tx.update(schema.tournamentAttendance).set({arrived:false}).where(eq(schema.tournamentAttendance.tournamentId,f.tournament));})).rejects.toThrow();
 await client`delete from players where id=${f.source}`;expect((await client`select count(*)::int as n from tournament_attendance where tournament_id=${f.tournament}`)[0].n).toBe(0);expect((await client`select count(*)::int as n from tournament_player_eliminations where tournament_id=${f.tournament}`)[0].n).toBe(0);expect((await client`select count(*)::int as n from tournament_operations where tournament_id=${f.tournament}`)[0].n).toBe(0);expect(await frozen(f.tournament)).toBe(before);
});
it.runIf(!!url)("active edits work and private permits do not authorize arbitrary completed mutations",async()=>{
 const active=await fixture(false,false);await client`update tournament_attendance set arrived=false where tournament_id=${active.tournament}`;expect((await client`select arrived from tournament_attendance where tournament_id=${active.tournament}`)[0].arrived).toBe(false);
 const f=await fixture();await expect(client`select public.issue_account_merge_maintenance(${f.source}::uuid,${f.target}::uuid,${f.source}::uuid,null,'[]'::jsonb)`).rejects.toThrow("admin authorization");
 await expect(h.db.transaction(async tx=>{const {sql}=await import("drizzle-orm");await tx.execute(sql`select public.issue_account_merge_maintenance(${f.source}::uuid,${f.target}::uuid,${admin}::uuid,null,'[]'::jsonb)`);await tx.update(schema.tournamentAttendance).set({arrived:false}).where(eq(schema.tournamentAttendance.tournamentId,f.tournament));})).rejects.toThrow();
 const grants=await client`select count(*)::int as n from pg_proc p cross join lateral aclexplode(p.proacl) a where p.proname in ('issue_account_merge_maintenance','account_merge_row_permitted') and a.grantee=0 and a.privilege_type='EXECUTE'`;expect(grants[0].n).toBe(0);
});
