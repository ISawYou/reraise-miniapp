import "server-only";
import {sql,eq} from "drizzle-orm";
import {db} from "@/lib/db";
import {tournaments} from "@/lib/db/schema";
export async function getTournamentSource(id:string){
 if(process.env.DATABASE_PROVIDER!=="postgres")return "LEGACY_GOOGLE_SHEETS";
 const [t]=await db.select({mode:tournaments.sourceMode}).from(tournaments).where(eq(tournaments.id,id));
 if(!t)throw Error("Турнир не найден");return t.mode;
}
// Shared lease spans external IO AND subsequent DB writes. Cutover takes the
// exclusive version of the same lock. Nested calls reuse this transaction's
// lease through async context rather than opening more DB connections.
import {AsyncLocalStorage} from "node:async_hooks";
const leases=new AsyncLocalStorage<Set<string>>();
export async function withTournamentSourceFence<T>(id:string,work:()=>Promise<T>):Promise<T>{
 if(process.env.DATABASE_PROVIDER!=="postgres"||leases.getStore()?.has(id))return work();
 return db.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${`tournament-source:${id}`},0))`);
  return leases.run(new Set([...(leases.getStore()??[]),id]),work);
 });
}
export async function withLegacySheetFence<T>(id:string,work:()=>Promise<T>):Promise<T>{
 return withTournamentSourceFence(id,async()=>{
  if(await getTournamentSource(id)!=="LEGACY_GOOGLE_SHEETS")throw Error("Турнир управляется в PostgreSQL; Google Sheets доступен только как архив");
  return work();
 });
}
