import {and,eq,inArray,ne,sql} from "drizzle-orm";
import {randomUUID} from "node:crypto";
import {db} from "@/lib/db";
import {players,tournaments,registrations,qualificationEvents as events,qualificationInvitations as invites,qualificationAudit as audit} from "@/lib/db/schema";
import {QualificationError,qualificationUuid} from "@/lib/qualification-config";
import type {QualificationCommand} from "./QualificationRepository";
type Tx=Pick<typeof db,"select"|"insert"|"update"|"delete"|"execute">;
type Event=typeof events.$inferSelect;
function fail(message:string,status=409):never{throw new QualificationError(message,status);}
export const manualFinalActions=["manual_remove_finalist","manual_add_finalist","manual_replace_finalist"];
export async function readManualFinalRoster(tx:Tx,e:Pick<Event,"id"|"finalTournamentId">){
 const invitations=await tx.select({invitationId:invites.id,playerId:invites.playerId,seat:invites.seat,invitationStatus:invites.status,manualAdmission:invites.manualAdmission,displayName:players.displayName}).from(invites).innerJoin(players,eq(players.id,invites.playerId)).where(and(eq(invites.eventId,e.id),inArray(invites.status,["pending","accepted"])));
 const regs=e.finalTournamentId?await tx.select({registrationId:registrations.id,playerId:registrations.playerId,registrationStatus:registrations.status,displayName:players.displayName}).from(registrations).innerJoin(players,eq(players.id,registrations.playerId)).where(and(eq(registrations.tournamentId,e.finalTournamentId),ne(registrations.status,"cancelled"))):[];
 return [...invitations.map(i=>({...i,registrationId:regs.find(r=>r.playerId===i.playerId)?.registrationId??null,registrationStatus:regs.find(r=>r.playerId===i.playerId)?.registrationStatus??null})),...regs.filter(r=>!invitations.some(i=>i.playerId===r.playerId)).map(r=>({...r,invitationId:null,seat:null,invitationStatus:null,manualAdmission:false}))].sort((a,b)=>(a.seat??99)-(b.seat??99)||a.playerId.localeCompare(b.playerId));
}
export async function mutateManualFinalRoster(tx:Tx,e:Event,command:QualificationCommand,actorId:string){
 if(e.slug!=="put-v-kaliningrad-2026"||!["inviting","final"].includes(e.status)||!e.finalTournamentId||e.finalOutcome)fail("Ручная коррекция этого финала недоступна");
 if(!e.winnerPlayerId)fail("Сначала определите прямого победителя отбора");
 if(command.confirmation!==true||typeof command.reason!=="string"||command.reason.trim().length<3||command.reason.trim().length>500)fail("Подтвердите коррекцию и укажите причину (3–500 символов)",400);
 const [actor]=await tx.select().from(players).where(eq(players.id,actorId)).for("share");if(!actor||actor.role!=="admin"||actor.isBlocked||actor.mergedIntoPlayerId)fail("Только действующий администратор может исправлять состав",403);
 const [final]=await tx.select().from(tournaments).where(eq(tournaments.id,e.finalTournamentId)).for("update");
 if(!final||final.tournamentType!=="qualification_final"||final.kind!=="free"||final.isFinal||final.maxPlayers!==18||final.startingStack!==50000||final.status==="completed")fail("Нужен незавершённый специальный финал на 18 мест");
 // Every canonical live writer takes this same tournament lock. A passed
 // scheduled start alone is not evidence of play; recorded facts are.
 const game=await tx.execute(sql`select public.qualification_final_has_gameplay(${final.id}::uuid) as started`);
 if((game as unknown as {started:boolean}[])[0].started)fail("В финале уже есть приход, стеки или игровые данные; коррекция состава запрещена");
 const before=await readManualFinalRoster(tx,e);
 if(before.some(r=>!r.invitationId)||e.status==="final"&&(!e.finalRosterLockedAt||before.some(r=>r.invitationStatus!=="accepted"||r.registrationStatus!=="registered")))fail("Состав приглашений и регистраций расходится — требуется отдельная сверка");
 const removing=command.action!=="manual_add_finalist",adding=command.action!=="manual_remove_finalist";
 const old=removing?before.find(r=>r.invitationId===command.invitationId):undefined;
 if(removing&&!old)fail("Выберите действующего участника финала",400);
 let added:string|null=null;
 if(adding){if(!qualificationUuid(command.playerId??""))fail("Выберите существующего игрока",400);added=command.playerId!;
  const [player]=await tx.select().from(players).where(eq(players.id,added)).for("update");if(!player||player.isBlocked||player.mergedIntoPlayerId)fail("Игрок недоступен или аккаунт объединён");
  if(added===e.winnerPlayerId)fail("Прямой победитель отбора не участвует в финале");
  if(before.some(r=>r.playerId===added))fail("Этот игрок уже есть в активном составе");
  if(before.length-(old?1:0)>=18)fail("В финале не может быть больше 18 участников");
 }
 const seat=old?.seat??Array.from({length:18},(_,i)=>i+1).find(n=>!before.some(r=>r.seat===n));if(!seat)fail("Нет свободного места финала");
 const now=new Date();
 if(old)await tx.update(invites).set({status:adding?"replaced":"cancelled"}).where(eq(invites.id,old.invitationId!));
 if(added)await tx.insert(invites).values({eventId:e.id,playerId:added,qualifyingRank:null,manualAdmission:true,seat,status:"accepted",respondedAt:null,replacesId:old?.invitationId??null});
 // Audit doubles as a narrowly bound DELETE authorization, never a client
 // permission flag: exact registration, event version, transaction and backend.
 const auditId=randomUUID();const [transaction]=await tx.execute(sql`select txid_current()::text as txid,pg_backend_pid()::text as backend`) as unknown as {txid:string;backend:string}[];
 const detail={removedPlayer:old?.playerId??null,addedPlayer:added,seat,reason:command.reason.trim(),beforeRoster:before,afterRoster:[] as Awaited<ReturnType<typeof readManualFinalRoster>>,registrationId:old?.registrationId??null,eventVersion:e.version,transactionId:transaction.txid,backendPid:transaction.backend,confirmed:true};
 await tx.insert(audit).values({id:auditId,eventId:e.id,actorId,action:command.action,detail});
 if(old?.registrationId)await tx.delete(registrations).where(eq(registrations.id,old.registrationId));
 // Unlocked invitations intentionally await the existing lock_roster action.
 // Its accepted-invitation trigger is not weakened to insert earlier.
 if(added&&e.status==="final")await tx.insert(registrations).values({tournamentId:final.id,playerId:added,status:"registered"});
 const after=await readManualFinalRoster(tx,e);
 if(after.length!==before.length+(adding?1:0)-(removing?1:0)||after.length>18)fail("Не удалось согласованно обновить состав");
 await tx.update(audit).set({detail:{...detail,afterRoster:after}}).where(eq(audit.id,auditId));
 await tx.update(events).set({version:e.version+1,updatedAt:now}).where(eq(events.id,e.id));
 return {ok:true,version:e.version+1};
}
