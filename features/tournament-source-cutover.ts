import "server-only";
import {createHash} from "node:crypto";
import {and,eq,sql} from "drizzle-orm";
import {db} from "@/lib/db";
import {tournaments,players,tournamentSourceAudit,tournamentOperations,tournamentOperationAudit,tournamentAttendance,tournamentRebuyState,tournamentPlayerEliminations} from "@/lib/db/schema";
import {getAdminTournamentParticipants,getTournamentAttendance,getTournamentRebuyState,getTournamentEliminations} from "@/features/tournaments";
import {readSpreadsheetTabValues} from "@/lib/google-sheets";
import {getFreeSheetColumnLayout,parseBooleanCell} from "@/lib/tournament-sheet-parsing";
import {operationFieldsFor,parseOperationPatch,validateFormatPatch,type OperationFields} from "@/lib/tournament-operation-fields";
import type {TournamentType} from "@/types/domain";
import {tournamentOperationsRepository} from "@/lib/repositories/tournament-operations/PostgresTournamentOperationsRepository";
import {postgresCompletionFingerprint} from "./postgres-completion-fingerprint";
type Value=string|number|boolean|null;
export type Comparison={playerId:string;name:string;field:string;sheet:Value;postgres:Value};
export async function previewCutover(id:string){
 const [t]=await db.select().from(tournaments).where(eq(tournaments.id,id));
 if(!t||t.status==="completed"||t.sourceMode!=="LEGACY_GOOGLE_SHEETS"||!t.googleSheetTabName)throw Error("Переключение недоступно: нужен активный турнир с legacy Google Sheet");
 if(t.kind!=="free"||t.tournamentType==="qualification_final")throw Error("Этот специальный формат требует отдельной проверки переключения");
 const fingerprint=await postgresCompletionFingerprint(id);
 const [sheet,roster,a,b,e,ops]=await Promise.all([readSpreadsheetTabValues(t.googleSheetTabName,{timeout:10000,retry:false}),getAdminTournamentParticipants(id),getTournamentAttendance(id),getTournamentRebuyState(id),getTournamentEliminations(id),tournamentOperationsRepository.read(id)]);
 const layout=getFreeSheetColumnLayout(t.tournamentType as TournamentType);
 if(!layout.headers.every((h,i)=>sheet[6]?.[i]?.trim()===h))throw Error("Структура Google Sheet изменилась; переключение остановлено");
 const data=sheet.slice(7).filter(r=>r[0]?.trim());
 if(new Set(data.map(r=>r[0])).size!==data.length)throw Error("Google Sheet содержит повторные Player ID");
 const active=roster.filter(p=>["registered","attended"].includes(p.status));
 if(data.some(r=>!active.some(p=>p.player_id===r[0])))throw Error("В Google Sheet есть строки вне текущего состава; сначала сверите состав");
 const comparisons:Comparison[]=[];
 for(const p of active){const raw=data.find(r=>r[0]===p.player_id);if(!raw)throw Error(`${p.admin_nick}: строка отсутствует в Google Sheet`);
  const op=ops.find(o=>o.playerId===p.player_id);
  const indexes:Record<string,number>={paid:6,paymentMethod:7,freeReentries:8,rebuys:9,addons:10,knockouts:layout.knockoutsIndex,bossKnockouts:layout.bossKnockoutsIndex??-1,mysteryPoints:layout.mysteryBountyPointsIndex??-1,place:layout.placeIndex,arrived:5,eliminated:layout.eliminatedIndex};
  const pg:Record<string,Value>={...op,arrived:a.get(p.player_id)?.arrived??null,eliminated:e.get(p.player_id)?.eliminated??null,rebuys:b.get(p.player_id)?.rebuys??null,addons:b.get(p.player_id)?.addons??null} as unknown as Record<string,Value>;
  for(const field of ["arrived","eliminated","rebuys",...(t.tournamentType!=="phoenix"?["addons"]:[]),...operationFieldsFor(t.tournamentType as TournamentType)]){
   const cell=raw[indexes[field]]?.trim();let value:Value=null;
   if(cell){if(["paid","arrived","eliminated"].includes(field)){
    if(!["true","false","1","0","yes","no","да","нет","y","n"].includes(cell.toLowerCase()))throw Error(`${p.admin_nick}: некорректное логическое значение ${field}`);value=parseBooleanCell(cell);
   }else if(field==="paymentMethod")value=({"нал":"cash","наличные":"cash","cash":"cash","карта":"card","card":"card","нал/карта":"mixed","mixed":"mixed"} as Record<string,string>)[cell.toLowerCase()]??cell;
   else{value=Number(cell);if(!Number.isSafeInteger(value)||Number(value)<0)throw Error(`${p.admin_nick}: некорректное число ${field}`);}}
   comparisons.push({playerId:p.player_id,name:p.admin_nick,field,sheet:value,postgres:pg[field]??null});
  }
 }
 if(await postgresCompletionFingerprint(id)!==fingerprint)throw Error("PostgreSQL изменился во время сравнения; обновите предпросмотр");
 const sheetHash=createHash("sha256").update(JSON.stringify(sheet)).digest("hex");
 return {fingerprint,sheetHash,comparisons,conflicts:comparisons.filter(c=>c.sheet!==c.postgres),type:t.tournamentType};
}
export async function applyCutover(input:{id:string;actorId:string;requestId:string;confirmed:boolean;fingerprint:string;sheetHash:string;choices:Record<string,"sheet"|"postgres">}){
 if(input.confirmed!==true)throw Error("Требуется явное подтверждение переключения");
 return db.transaction(async tx=>{
  await tx.execute(sql`set local lock_timeout='10s'`);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tournament-source:${input.id}`},0))`);
  const [done]=await tx.select().from(tournamentSourceAudit).where(eq(tournamentSourceAudit.requestId,input.requestId));
  if(done){if(done.tournamentId!==input.id||done.actorId!==input.actorId)throw Error("Request ID уже использован");return {ok:true,noOp:true};}
  const [t]=await tx.select().from(tournaments).where(eq(tournaments.id,input.id)).for("update");
  const [actor]=await tx.select().from(players).where(eq(players.id,input.actorId)).for("share");
  if(!actor||actor.role!=="admin"||actor.isBlocked||actor.mergedIntoPlayerId)throw Error("Переключать источник может только администратор");
  if(!t||t.status==="completed"||t.sourceMode!=="LEGACY_GOOGLE_SHEETS")throw Error("Турнир уже переключён или завершён");
  const preview=await previewCutover(input.id);
  if(preview.fingerprint!==input.fingerprint||preview.sheetHash!==input.sheetHash)throw Error("Источники изменились после сравнения; повторите проверку");
  const selected=new Map<string,Record<string,Value>>();
  for(const c of preview.comparisons){const choice=input.choices[`${c.playerId}:${c.field}`];
   if(c.sheet!==c.postgres&&!["sheet","postgres"].includes(choice))throw Error(`${c.name}: выберите источник для ${c.field}`);
   const values=selected.get(c.playerId)??{};values[c.field]=c.sheet===c.postgres?c.postgres:choice==="sheet"?c.sheet:c.postgres;selected.set(c.playerId,values);
  }
  for(const [playerId,values] of selected){
   const operational=Object.fromEntries(Object.entries(values).filter(([k])=>operationFieldsFor(t.tournamentType as TournamentType).includes(k as keyof OperationFields)));
   const patch=parseOperationPatch(operational);validateFormatPatch(t.tournamentType as TournamentType,patch);
   const key=and(eq(tournamentOperations.tournamentId,input.id),eq(tournamentOperations.playerId,playerId));
   const [before]=await tx.select().from(tournamentOperations).where(key);
   const [after]=await tx.insert(tournamentOperations).values({...patch,tournamentId:input.id,playerId,version:(before?.version??0)+1,updatedBy:input.actorId}).onConflictDoUpdate({target:[tournamentOperations.tournamentId,tournamentOperations.playerId],set:{...patch,version:(before?.version??0)+1,updatedBy:input.actorId,updatedAt:new Date()}}).returning();
   await tx.insert(tournamentOperationAudit).values({tournamentId:input.id,playerId,actorId:input.actorId,before:before??null,after});
   if(values.arrived!==null){if(typeof values.arrived!=="boolean")throw Error("Некорректное поле Пришёл");await tx.insert(tournamentAttendance).values({tournamentId:input.id,playerId,arrived:values.arrived,arrivedAt:values.arrived?new Date():null}).onConflictDoUpdate({target:[tournamentAttendance.tournamentId,tournamentAttendance.playerId],set:{arrived:values.arrived,arrivedAt:sql`case when ${values.arrived} then coalesce(${tournamentAttendance.arrivedAt},now()) else ${tournamentAttendance.arrivedAt} end`,updatedAt:new Date()}});}
   if(values.rebuys!==null||values.addons!=null){const rebuys=values.rebuys,addons=t.tournamentType==="phoenix"?0:values.addons;if(typeof rebuys!=="number"||typeof addons!=="number")throw Error("Для импорта входов и Add-on нужны оба известных значения");if(t.tournamentType==="phoenix"&&rebuys>2)throw Error("PHOENIX: максимум два входа");
    await tx.execute(sql`select public.issue_staff_live_edit_permit(gen_random_uuid(),${input.id}::uuid,${playerId}::uuid,${input.actorId}::uuid,'staff',${rebuys},${addons})`);
    await tx.insert(tournamentRebuyState).values({tournamentId:input.id,playerId,rebuys,addons}).onConflictDoUpdate({target:[tournamentRebuyState.tournamentId,tournamentRebuyState.playerId],set:{rebuys,addons,updatedAt:new Date()}});
    await tx.execute(sql`update staff_tournament_live_edits set state='succeeded' where request_id::text=current_setting('reraise.staff_live_edit',true)`);
   }
   if(values.eliminated!==null){if(typeof values.eliminated!=="boolean")throw Error("Некорректное поле Выбыл");const [previousElimination]=await tx.select().from(tournamentPlayerEliminations).where(and(eq(tournamentPlayerEliminations.tournamentId,input.id),eq(tournamentPlayerEliminations.playerId,playerId)));if(values.eliminated&&!previousElimination?.eliminatedAt)throw Error("Нельзя выдумать время выбытия: сначала подтвердите и исправьте порядок выбытия через существующий интерфейс");await tx.insert(tournamentPlayerEliminations).values({tournamentId:input.id,playerId,eliminated:values.eliminated,eliminatedAt:values.eliminated?previousElimination!.eliminatedAt:null}).onConflictDoUpdate({target:[tournamentPlayerEliminations.tournamentId,tournamentPlayerEliminations.playerId],set:{eliminated:values.eliminated,eliminatedAt:values.eliminated?previousElimination!.eliminatedAt:null,updatedAt:new Date()}});}
  }
  await tx.update(tournaments).set({sourceMode:"POSTGRESQL"}).where(eq(tournaments.id,input.id));
  await tx.insert(tournamentSourceAudit).values({requestId:input.requestId,tournamentId:input.id,actorId:input.actorId,comparison:preview,imported:Array.from(selected.entries())});
  return {ok:true,noOp:false};
 });
}
