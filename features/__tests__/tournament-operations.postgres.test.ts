import {beforeAll,afterAll,it,expect,vi} from "vitest";
import postgres from "postgres";
import {drizzle} from "drizzle-orm/postgres-js";
import {migrate} from "drizzle-orm/postgres-js/migrator";
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type {db as DB} from "@/lib/db";
const h=vi.hoisted(()=>({db:null as unknown as typeof DB}));
const google=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("@/lib/admin-auth",()=>({assertServerActorRole:vi.fn().mockResolvedValue({role:"admin"})}));
vi.mock("@/lib/google-sheets",()=>({readSpreadsheetTabValues:google.read}));
vi.mock("@/features/achievements",()=>({syncPlayersAchievementsIfEnabled:vi.fn()}));
vi.mock("@/features/club-activity",()=>({publishTournamentWinnerEvent:vi.fn()}));
vi.mock("@/lib/poker-clock-client",()=>({finishPokerClockTournament:vi.fn().mockResolvedValue({status:"not_linked"})}));
vi.mock("@/lib/db",()=>({db:new Proxy({},{get(_t,k){const v=Reflect.get(h.db,k);return typeof v==="function"?v.bind(h.db):v;}})}));
const {tournamentOperationsRepository:repo}=await import("@/lib/repositories/tournament-operations/PostgresTournamentOperationsRepository");
const url=process.env.RERAISE_ADMIN_ADMISSION_TEST_DATABASE_URL;
if(url){const u=new URL(url);if(u.hostname!=="127.0.0.1"||!u.pathname.startsWith("/reraise_admin_admission_test_"))throw Error("Disposable local DB only");}
let client:ReturnType<typeof postgres>;const tid=randomUUID(),pid=randomUUID(),aid=randomUUID();
beforeAll(async()=>{if(!url)return;client=postgres(url,{prepare:false,onnotice:()=>{}});h.db=drizzle(client,{schema});await migrate(h.db,{migrationsFolder:"lib/db/migrations"});await h.db.insert(schema.players).values([{id:pid,displayName:"Operations fixture"},{id:aid,displayName:"Staff fixture",role:"operator"}]);await h.db.insert(schema.tournaments).values({id:tid,title:"Operations fixture",kind:"free",status:"open",tournamentType:"bounty",startAt:new Date(),maxPlayers:46});await h.db.insert(schema.registrations).values({tournamentId:tid,playerId:pid,status:"registered"});});
afterAll(async()=>{if(!client)return;await h.db.delete(schema.tournamentOperationAudit).where(eq(schema.tournamentOperationAudit.tournamentId,tid));await h.db.delete(schema.tournaments).where(eq(schema.tournaments.id,tid));for(const id of [pid,aid])await h.db.delete(schema.players).where(eq(schema.players.id,id));await client.end();});
it.runIf(!!url)("persists atomic field patches and audit without touching frozen snapshots; rejects stale, GS and completed writes",async()=>{
 await h.db.insert(schema.tournamentLateRegistration).values({tournamentId:tid,arrivedPlayersCount:1,initialStacksCount:1,totalEntriesCount:1,rebuysCount:0,addonsCount:0,tournamentType:"classic",ratingFormulaVersion:"v2",ratingPlaces:[{place:1,points:50}]});
 const before=await h.db.select().from(schema.tournamentLateRegistration).where(eq(schema.tournamentLateRegistration.tournamentId,tid));
 const base={tournamentId:tid,playerId:pid,actorId:aid,expectedVersion:0};
 expect(await repo.patch({...base,patch:{paid:true,knockouts:2}})).toMatchObject({version:1,paid:true,knockouts:2,place:null});
 await expect(repo.patch({...base,patch:{paid:false}})).rejects.toThrow("изменены");
 expect(await repo.patch({...base,expectedVersion:1,patch:{place:1}})).toMatchObject({version:2,paid:true,knockouts:2,place:1});
 await expect(repo.patch({...base,expectedVersion:2,actorId:pid,patch:{paid:false}})).rejects.toThrow("прав");
 await h.db.update(schema.tournaments).set({googleSheetTabName:"GS",sourceMode:"LEGACY_GOOGLE_SHEETS"}).where(eq(schema.tournaments.id,tid));
 await expect(repo.patch({...base,expectedVersion:2,patch:{paid:false}})).rejects.toThrow("Google Sheets");
 await h.db.update(schema.tournaments).set({status:"completed",googleSheetTabName:null}).where(eq(schema.tournaments.id,tid));
 await expect(repo.patch({...base,expectedVersion:2,patch:{paid:false}})).rejects.toThrow("Завершённый");
 expect(await h.db.select().from(schema.tournamentLateRegistration).where(eq(schema.tournamentLateRegistration.tournamentId,tid))).toEqual(before);
 expect(await repo.read(tid)).toHaveLength(1);expect((await repo.read(tid))[0]).toMatchObject({version:2,paid:true});
 expect(await h.db.select().from(schema.tournamentOperationAudit).where(eq(schema.tournamentOperationAudit.tournamentId,tid))).toHaveLength(2);
});
it.runIf(!!url)("atomically imports reviewed values, preserves snapshot, waits for sheet work and rejects stale retries",async()=>{
 const {previewCutover,applyCutover}=await import("@/features/tournament-source-cutover");
 const {withTournamentSourceFence,withLegacySheetFence}=await import("@/lib/tournament-source");
 const {getFreeSheetColumnLayout}=await import("@/lib/tournament-sheet-parsing");
 const id=randomUUID(),requestId=randomUUID();await h.db.update(schema.players).set({role:"admin"}).where(eq(schema.players.id,aid));
 await h.db.insert(schema.tournaments).values({id,title:"Cutover",kind:"free",status:"open",sourceMode:"LEGACY_GOOGLE_SHEETS",googleSheetTabName:"fixture",tournamentType:"bounty",startAt:new Date(),maxPlayers:46});
 await h.db.insert(schema.registrations).values({tournamentId:id,playerId:pid,status:"registered"});
 await h.db.insert(schema.tournamentOperations).values({tournamentId:id,playerId:pid,updatedBy:aid,paymentMethod:"cash",comment:null});
 await h.db.insert(schema.tournamentLateRegistration).values({tournamentId:id,arrivedPlayersCount:1,initialStacksCount:1,totalEntriesCount:1,rebuysCount:0,addonsCount:0,tournamentType:"bounty",ratingFormulaVersion:"v2",ratingPlaces:[{place:1,points:50}]});
 const frozen=await h.db.select().from(schema.tournamentLateRegistration).where(eq(schema.tournamentLateRegistration.tournamentId,id));
 const sheet:string[][]=Array.from({length:6},()=>[]);sheet.push(getFreeSheetColumnLayout("bounty").headers,[pid,"","P","","registered","TRUE","TRUE","cash","0","1","0","2","1","0","FALSE",""]);google.read.mockImplementation(async()=>sheet);
 try{
  const preview=await previewCutover(id),choices=Object.fromEntries(preview.conflicts.map(c=>[`${c.playerId}:${c.field}`,"sheet" as const]));
  const input={id,actorId:aid,requestId,confirmed:true,fingerprint:preview.fingerprint,sheetHash:preview.sheetHash,choices};
  sheet[7][11]="3";await expect(applyCutover(input)).rejects.toThrow("изменились");sheet[7][11]="2";
  let release!:()=>void,started!:()=>void;const entered=new Promise<void>(r=>{started=r;});
  const running=withTournamentSourceFence(id,async()=>{started();await new Promise<void>(r=>{release=r;});});await entered;
  let switched=false;const switching=applyCutover(input).then(r=>{switched=true;return r;});
  await new Promise(r=>setTimeout(r,30));expect(switched).toBe(false);release();await running;expect(await switching).toEqual({ok:true,noOp:false});
  expect(await applyCutover(input)).toEqual({ok:true,noOp:true});await expect(withLegacySheetFence(id,async()=>{})).rejects.toThrow("архив");
  expect((await repo.read(id))[0]).toMatchObject({paid:true,paymentMethod:"cash",comment:null,knockouts:2,place:1,mysteryEnvelopesWon:null});
  expect((await h.db.select().from(schema.tournaments).where(eq(schema.tournaments.id,id)))[0]).toMatchObject({sourceMode:"POSTGRESQL",googleSheetTabName:"fixture"});
  expect(await h.db.select().from(schema.tournamentLateRegistration).where(eq(schema.tournamentLateRegistration.tournamentId,id))).toEqual(frozen);
 }finally{await h.db.delete(schema.tournamentSourceAudit).where(eq(schema.tournamentSourceAudit.tournamentId,id));await h.db.delete(schema.tournamentOperationAudit).where(eq(schema.tournamentOperationAudit.tournamentId,id));await h.db.delete(schema.tournaments).where(eq(schema.tournaments.id,id));}
});
it.runIf(!!url)("completes from real PostgreSQL without any Google read, preserves the frozen pool and rejects stale/double completion",async()=>{
 const {previewPostgresCompletion,completePostgresTournament}=await import("@/features/postgres-tournament-completion");
 const id=randomUUID();await h.db.insert(schema.tournaments).values({id,title:"PG completion",kind:"free",status:"open",tournamentType:"bounty",startAt:new Date(),maxPlayers:46,sourceMode:"POSTGRESQL",googleSheetTabName:"archive"});
 await h.db.insert(schema.registrations).values({tournamentId:id,playerId:pid,status:"registered"});
 await h.db.insert(schema.tournamentAttendance).values({tournamentId:id,playerId:pid,arrived:true});
 await h.db.insert(schema.tournamentRebuyState).values({tournamentId:id,playerId:pid,rebuys:1,addons:0});
 await h.db.insert(schema.tournamentOperations).values({tournamentId:id,playerId:pid,updatedBy:aid,paid:false,paymentMethod:null,freeReentries:0,knockouts:2,place:1});
 await h.db.insert(schema.tournamentLateRegistration).values({tournamentId:id,arrivedPlayersCount:1,initialStacksCount:1,totalEntriesCount:1,rebuysCount:0,addonsCount:0,tournamentType:"bounty",ratingFormulaVersion:"v2",ratingPlaces:[{place:1,points:50}]});
 const frozen=await h.db.select().from(schema.tournamentLateRegistration).where(eq(schema.tournamentLateRegistration.tournamentId,id));
 google.read.mockRejectedValue(new Error("Google must not be used"));google.read.mockClear();
 try{
  const preview=await previewPostgresCompletion(id);
  await repo.patch({tournamentId:id,playerId:pid,actorId:aid,expectedVersion:1,patch:{knockouts:3}});
  await expect(completePostgresTournament(id,preview.fingerprint)).rejects.toThrow("устарел");
  const fresh=await previewPostgresCompletion(id);
  await repo.patch({tournamentId:id,playerId:pid,actorId:aid,expectedVersion:2,patch:{comment:"Без финансовых изменений"}});
  const audit=await h.db.select().from(schema.tournamentOperationAudit).where(eq(schema.tournamentOperationAudit.tournamentId,id));expect(audit.map(a=>a.after)).toContainEqual(expect.objectContaining({comment:"Без финансовых изменений",version:3}));
  expect((await previewPostgresCompletion(id)).fingerprint).toBe(fresh.fingerprint);
  await expect(repo.patch({tournamentId:id,playerId:pid,actorId:aid,expectedVersion:2,patch:{comment:"Stale"}})).rejects.toThrow("изменены");
  await expect(h.db.update(schema.tournamentOperations).set({comment:"x".repeat(1001)}).where(eq(schema.tournamentOperations.tournamentId,id))).rejects.toThrow();
  expect(await completePostgresTournament(id,fresh.fingerprint)).toMatchObject({ok:true,completedCount:1});
  const [result]=await h.db.select().from(schema.results).where(eq(schema.results.tournamentId,id));expect(result).toMatchObject({place:1,knockouts:3,itmPoints:50,participationPoints:2,knockoutPoints:15,ratingPoints:67});
  await expect(completePostgresTournament(id,fresh.fingerprint)).rejects.toThrow("уже завершён");
  expect(await h.db.select().from(schema.tournamentLateRegistration).where(eq(schema.tournamentLateRegistration.tournamentId,id))).toEqual(frozen);expect(google.read).not.toHaveBeenCalled();
 }finally{await h.db.delete(schema.tournamentOperationAudit).where(eq(schema.tournamentOperationAudit.tournamentId,id));await h.db.delete(schema.tournaments).where(eq(schema.tournaments.id,id));}
});
