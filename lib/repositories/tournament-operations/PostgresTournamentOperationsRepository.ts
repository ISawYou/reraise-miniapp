import {and,eq} from "drizzle-orm";
import {db} from "@/lib/db";
import {tournaments,players,registrations,tournamentOperations,tournamentOperationAudit} from "@/lib/db/schema";
import {parseOperationPatch} from "@/lib/tournament-operation-fields";

export class OperationsError extends Error {
 constructor(message:string,public status:number){super(message);}
}
export class PostgresTournamentOperationsRepository {
 async read(tournamentId:string){return db.select().from(tournamentOperations).where(eq(tournamentOperations.tournamentId,tournamentId));}
 async patch(input:{tournamentId:string;playerId:string;actorId:string;expectedVersion:number;patch:unknown}){
  const patch=parseOperationPatch(input.patch);
  return db.transaction(async tx=>{
   const [t]=await tx.select().from(tournaments).where(eq(tournaments.id,input.tournamentId)).for("update");
   if(!t)throw new OperationsError("Турнир не найден",404);
   if(t.status==="completed")throw new OperationsError("Завершённый турнир доступен только для просмотра",409);
   if(t.googleSheetTabName?.trim())throw new OperationsError("Турнир управляется через Google Sheets; требуется проверенное переключение источника",409);
   const [actor]=await tx.select().from(players).where(eq(players.id,input.actorId)).for("share");
   if(!actor||!["admin","operator"].includes(actor.role)||actor.isBlocked||actor.mergedIntoPlayerId)throw new OperationsError("Недостаточно прав",403);
   const [registration]=await tx.select().from(registrations).where(and(eq(registrations.tournamentId,input.tournamentId),eq(registrations.playerId,input.playerId))).for("share");
   if(!registration||!["registered","attended"].includes(registration.status))throw new OperationsError("Игрок не входит в состав турнира",409);
   const key=and(eq(tournamentOperations.tournamentId,input.tournamentId),eq(tournamentOperations.playerId,input.playerId));
   const [before]=await tx.select().from(tournamentOperations).where(key);
   if((before?.version??0)!==input.expectedVersion)throw new OperationsError("Данные изменены другим сотрудником; обновите строку",409);
   if((patch.bossKnockouts??0)>0&&t.tournamentType!=="boss_bounty")throw new OperationsError("Boss KO недоступны для этого формата",400);
   if((patch.mysteryPoints??0)>0&&t.tournamentType!=="mystery_bounty")throw new OperationsError("Mystery points недоступны для этого формата",400);
   const values={...patch,version:input.expectedVersion+1,updatedBy:input.actorId,updatedAt:new Date()};
   const [after]=before?await tx.update(tournamentOperations).set(values).where(key).returning():await tx.insert(tournamentOperations).values({...values,tournamentId:input.tournamentId,playerId:input.playerId}).returning();
   await tx.insert(tournamentOperationAudit).values({tournamentId:input.tournamentId,playerId:input.playerId,actorId:input.actorId,before:before??null,after});
   return after;
  });
 }
}
export const tournamentOperationsRepository=new PostgresTournamentOperationsRepository();
