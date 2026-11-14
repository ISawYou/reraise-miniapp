import "server-only";
import {manualFinalActions,mutateManualFinalRoster,readManualFinalRoster} from "./manual-final-roster";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { players, results, tournaments, registrations, qualificationEvents as events, qualificationSlots as slots, qualificationInvitations as invites, qualificationSquad as squad, qualificationAudit as audit, tournamentAttendance, tournamentPlayerEliminations } from "@/lib/db/schema";
import { QualificationError, validateQualificationConfig, qualificationUuid, type QualificationConfig } from "@/lib/qualification-config";
import { rankQualification, type QualificationFact } from "@/lib/qualification-ranking";
import { qualificationFinalInstant, validateQualificationDate, KALININGRAD_SLOT_TYPES } from "@/lib/qualification-admin";
import { prepareTournamentCreation } from "@/lib/tournament-creation";
import { tournamentColumnValues } from "@/lib/repositories/tournament/PostgresTournamentRepository";
import { resolveSeasonForCalendarDate, toMoscowCalendarDate } from "@/lib/season-resolver";
import { CLUB_ADDRESS } from "@/config/club";
import { TOURNAMENT_PRESET_TEMPLATES } from "@/config/tournament-presets";
import { seasons } from "@/lib/db/schema";
import type { QualificationCommand } from "./QualificationRepository";

type Executor=Pick<typeof db,"select"|"insert"|"update"|"delete"|"execute">;
type Event=typeof events.$inferSelect;
function fail(message:string,status=409):never{throw new QualificationError(message,status);}
const publicPlayer={player_id:players.id,display_name:players.displayName,custom_avatar_url:players.customAvatarUrl,telegram_avatar_url:players.telegramAvatarUrl};
const active=(status:string)=>status==="pending"||status==="accepted";
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function dateInZone(value:Date,zone:string){return new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).format(value);}
function configOf(e:Event,dates:string[]):QualificationConfig{return {slug:e.slug,title:e.title,rules:e.rules,timezone:e.timezone,bestResultsCount:e.bestResultsCount,finalDate:e.finalDate,dates};}

async function canonical(tx:Executor,ids:string[]){
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!qualificationUuid(id)))fail("Нужны разные действующие игроки",400);
  const rows=await tx.select({id:players.id,merged:players.mergedIntoPlayerId,blocked:players.isBlocked}).from(players).where(inArray(players.id,ids)).orderBy(asc(players.id)).for("update");
  if(rows.length!==ids.length||rows.some(p=>p.merged||p.blocked))fail("Игрок недоступен или его аккаунт объединён — выберите действующий профиль");
}
async function state(tx:Executor,e:Event){
  const schedule=await tx.select({id:slots.id,scheduledDate:slots.scheduledDate,tournamentId:slots.tournamentId,displayOrder:slots.displayOrder,tournament:{id:tournaments.id,title:tournaments.title,startAt:tournaments.startAt,status:tournaments.status,kind:tournaments.kind,isFinal:tournaments.isFinal,maxPlayers:tournaments.maxPlayers,tournamentType:tournaments.tournamentType}}).from(slots).leftJoin(tournaments,eq(slots.tournamentId,tournaments.id)).where(eq(slots.eventId,e.id)).orderBy(asc(slots.displayOrder));
  validateQualificationConfig(configOf(e,schedule.map(s=>s.scheduledDate)));
  if(schedule.some((s,i)=>s.displayOrder!==i || (s.tournamentId && (!s.tournament||s.tournamentId===e.finalTournamentId))))fail("Нарушена конфигурация слотов отбора");
  const [linkedFinal]=e.finalTournamentId?await tx.select({id:tournaments.id,title:tournaments.title,startAt:tournaments.startAt,status:tournaments.status,maxPlayers:tournaments.maxPlayers,tournamentType:tournaments.tournamentType,startingStack:tournaments.startingStack}).from(tournaments).where(eq(tournaments.id,e.finalTournamentId)):[];
  const finalTournament=linkedFinal?{...linkedFinal,startAt:linkedFinal.startAt.toISOString()}:null;
  // The ONLY scoring input: persisted rating_points, completed selected tournaments.
  const facts:QualificationFact[]=(await tx.select({...publicPlayer,tournament_id:tournaments.id,title:tournaments.title,date:tournaments.startAt,points:results.ratingPoints}).from(slots).innerJoin(tournaments,eq(slots.tournamentId,tournaments.id)).innerJoin(results,eq(results.tournamentId,tournaments.id)).innerJoin(players,eq(players.id,results.playerId)).where(and(eq(slots.eventId,e.id),eq(tournaments.status,"completed"),ne(tournaments.tournamentType,"qualification_final"),isNull(players.mergedIntoPlayerId)))).map(r=>({...r,date:r.date.toISOString()}));
  const factsFingerprint=hash({best:e.bestResultsCount,selected:schedule.map(s=>s.tournamentId),facts:facts.map(f=>[f.player_id,f.tournament_id,f.points]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))});
  const resolution=e.tieResolution?.fingerprint===factsFingerprint?e.tieResolution.playerOrder:[];
  const ranking=rankQualification(facts,e.bestResultsCount,resolution);
  const fingerprint=hash({factsFingerprint,resolution});
  const invitationRows=await tx.select({id:invites.id,eventId:invites.eventId,playerId:invites.playerId,qualifyingRank:invites.qualifyingRank,manualAdmission:invites.manualAdmission,seat:invites.seat,status:invites.status,invitedAt:invites.invitedAt,respondedAt:invites.respondedAt,replacesId:invites.replacesId,...publicPlayer}).from(invites).innerJoin(players,eq(invites.playerId,players.id)).where(eq(invites.eventId,e.id)).orderBy(asc(invites.seat),desc(invites.invitedAt),asc(invites.id));
  const finalSurvivors=e.finalOutcome ? await tx.select(publicPlayer).from(players).where(inArray(players.id,e.finalOutcome.survivorIds)).orderBy(asc(players.displayName),asc(players.id)) : [];
  const finalEliminations=e.finalOutcome?.eliminations.length ? (await tx.select(publicPlayer).from(players).where(inArray(players.id,e.finalOutcome.eliminations.map(p=>p.playerId)))).map(p=>({...p,place:e.finalOutcome!.eliminations.find(r=>r.playerId===p.player_id)!.place})).sort((a,b)=>a.place-b.place) : [];
  const members=await tx.select({source:squad.source,slot:squad.slot,finalPlace:squad.finalPlace,confirmedAt:squad.confirmedAt,...publicPlayer}).from(squad).innerJoin(players,eq(squad.playerId,players.id)).where(eq(squad.eventId,e.id)).orderBy(asc(squad.source),asc(squad.slot));
  return {event:e,schedule,finalTournament,finalSurvivors,finalEliminations,ranking:{...ranking,fingerprint,factsFingerprint},invitations:invitationRows,members,needsReconciliation:e.rankingFingerprint!==null&&e.rankingFingerprint!==fingerprint};
}

export class PostgresQualificationRepository {
  private available(){if(process.env.DATABASE_PROVIDER!=="postgres")fail("Квалификации требуют PostgreSQL и подготовленной миграции",503);}
  async list(admin=false){this.available();return db.select({id:events.id,slug:events.slug,title:events.title,status:events.status,bestResultsCount:events.bestResultsCount}).from(events).where(admin?undefined:ne(events.status,"draft")).orderBy(desc(events.createdAt));}
  async create(config:QualificationConfig,actorId:string){
    this.available();validateQualificationConfig(config);
    return db.transaction(async tx=>{
      const [e]=await tx.insert(events).values({slug:config.slug,title:config.title.trim(),rules:config.rules,timezone:config.timezone,finalDate:config.finalDate,bestResultsCount:config.bestResultsCount}).returning();
      await tx.insert(slots).values([...config.dates].sort().map((scheduledDate,displayOrder)=>({eventId:e.id,scheduledDate,displayOrder})));
      await tx.insert(audit).values({eventId:e.id,actorId,action:"create",detail:{dates:config.dates}});return e;
    });
  }
  async read(idOrSlug:string,admin=false,previewFinalDate?:string){
    if(previewFinalDate!==undefined)validateQualificationDate(previewFinalDate);
    this.available();return db.transaction(async tx=>{
      const [e]=await tx.select().from(events).where(qualificationUuid(idOrSlug)?eq(events.id,idOrSlug):eq(events.slug,idOrSlug));
      if(!e||(!admin&&e.status==="draft"))fail("Отбор не найден",404);
      const s=await state(tx,e);
      if(admin){
        const choices=await tx.select({id:tournaments.id,title:tournaments.title,startAt:tournaments.startAt,status:tournaments.status,kind:tournaments.kind,maxPlayers:tournaments.maxPlayers,isFinal:tournaments.isFinal,tournamentType:tournaments.tournamentType,startingStack:tournaments.startingStack,lateRegistrationEndsAt:tournaments.lateRegistrationEndsAt,ratingGuarantee:tournaments.ratingGuarantee,
          linkedFinalEventId:sql<string|null>`(select qe.id from qualification_events qe where qe.final_tournament_id=${tournaments.id})`,
          hasRegistrations:sql<boolean>`exists(select 1 from ${registrations} where ${registrations.tournamentId}=${tournaments.id})`,
          hasResults:sql<boolean>`exists(select 1 from ${results} where ${results.tournamentId}=${tournaments.id})`
        }).from(tournaments).where(previewFinalDate?sql`(${tournaments.startAt} AT TIME ZONE ${e.timezone})::date=${previewFinalDate}::date`:sql`${tournaments.startAt} >= ${s.schedule[0].scheduledDate}::date - interval '1 day' AND ${tournaments.startAt} < ${e.finalDate}::date + interval '2 days'`).orderBy(asc(tournaments.startAt),asc(tournaments.id)).limit(250);
        const history=await tx.select({actorId:audit.actorId,action:audit.action,detail:audit.detail,createdAt:audit.createdAt}).from(audit).where(eq(audit.eventId,e.id)).orderBy(desc(audit.createdAt)).limit(30);
        return {...s,finalRoster:await readManualFinalRoster(tx,e),tournamentChoices:choices,audit:history};
      }
      return {event:{id:e.id,slug:e.slug,title:e.title,rules:e.rules,timezone:e.timezone,finalDate:e.finalDate,bestResultsCount:e.bestResultsCount,status:e.status,version:e.version,finalTournamentId:e.finalTournamentId,finalRosterLockedAt:e.finalRosterLockedAt},schedule:s.schedule,finalTournament:s.finalTournament,finalSurvivors:s.finalSurvivors,finalEliminations:s.finalEliminations,ranking:{standings:s.ranking.standings,hasUnresolvedTie:s.ranking.hasUnresolvedTie},needsReconciliation:s.needsReconciliation,members:e.squadConfirmedAt?s.members:[]};
    },{isolationLevel:"repeatable read",accessMode:"read only"});
  }
  async ownInvitation(slug:string,playerId:string){
    this.available();const [e]=await db.select({id:events.id,status:events.status,version:events.version}).from(events).where(eq(events.slug,slug));if(!e||e.status==="draft")fail("Отбор не найден",404);
    const rows=await db.select({id:invites.id,status:invites.status,qualifyingRank:invites.qualifyingRank,manualAdmission:invites.manualAdmission,seat:invites.seat,invitedAt:invites.invitedAt}).from(invites).where(and(eq(invites.eventId,e.id),eq(invites.playerId,playerId))).orderBy(desc(invites.invitedAt),desc(invites.id));
    return {eventId:e.id,version:e.version,status:e.status,invitations:rows};
  }
  async searchPlayers(q:string){this.available();if(q.trim().length<2)return [];return db.select(publicPlayer).from(players).where(and(isNull(players.mergedIntoPlayerId),eq(players.isBlocked,false),sql`${players.displayName} ILIKE ${"%"+q.trim().replace(/[\\%_]/g,"\\$&")+"%"}`)).orderBy(asc(players.displayName)).limit(20);}
  async respond(eventId:string,invitationId:string,playerId:string,version:number,accept:boolean){
    this.available();return db.transaction(async tx=>{
      const [e]=await tx.select().from(events).where(eq(events.id,eventId)).for("update");if(!e)fail("Отбор не найден",404);
      if(e.version!==version)fail("Данные устарели — обновите страницу");if(e.status!=="inviting"||e.finalRosterLockedAt)fail("Приём ответов на приглашения закрыт");
      if(e.finalTournamentId){const [t]=await tx.select({startAt:tournaments.startAt}).from(tournaments).where(eq(tournaments.id,e.finalTournamentId));if(t&&new Date()>=t.startAt)fail("Финал уже начался");}
      const current=await state(tx,e);if(current.needsReconciliation)fail("Рейтинг изменился — требуется сверка состава");
      await canonical(tx,[playerId]);
      const [inv]=await tx.select().from(invites).where(and(eq(invites.id,invitationId),eq(invites.eventId,eventId),eq(invites.playerId,playerId)));
      if(!inv)fail("Приглашение не найдено",404);if(inv.status!=="pending")fail("На приглашение уже получен ответ");
      await tx.update(invites).set({status:accept?"accepted":"declined",respondedAt:new Date()}).where(eq(invites.id,inv.id));
      await tx.update(events).set({version:e.version+1,updatedAt:new Date()}).where(eq(events.id,e.id));
      await tx.insert(audit).values({eventId,actorId:playerId,action:accept?"accept":"decline",detail:{invitationId,from:inv.status,to:accept?"accepted":"declined"}});
      return {ok:true};
    });
  }
  async mutate(eventId:string,command:QualificationCommand,actorId:string){
    this.available();return db.transaction(async tx=>{
      const [e]=await tx.select().from(events).where(eq(events.id,eventId)).for("update");if(!e)fail("Отбор не найден",404);
      if(command.action==="create_final")return this.createAndLinkFinal(tx,e,command,actorId);
      if(e.version!==command.version)fail("Данные устарели — обновите страницу");if(e.status==="completed")fail("Сборная уже подтверждена; завершённый отбор неизменяем");
      if(manualFinalActions.includes(command.action))return mutateManualFinalRoster(tx,e,command,actorId);
      if(["close","reconcile","confirm_winner","lock_roster","confirm_squad","select_finalists","complete_final"].includes(command.action)){
        const sourceIds=(await tx.select({id:slots.tournamentId}).from(slots).where(eq(slots.eventId,e.id))).map(s=>s.id).filter((id):id is string=>!!id);
        if(e.finalTournamentId)sourceIds.push(e.finalTournamentId);
        if(sourceIds.length)await tx.select({id:tournaments.id}).from(tournaments).where(inArray(tournaments.id,sourceIds)).orderBy(asc(tournaments.id)).for("update");
      }
      const s=await state(tx,e);const now=new Date();let patch:Partial<typeof events.$inferInsert>={};
      const expectStage=(...stages:string[])=>{if(!stages.includes(e.status))fail("Это действие недоступно на текущем этапе");};
      const acknowledged=()=>{if(command.confirmation!==true||command.rankingFingerprint!==s.ranking.fingerprint)fail("Подтвердите актуальные изменения состава и рейтинга");};
      const ensureRanking=()=>{if(s.ranking.hasUnresolvedTie)fail("Сначала разрешите существенную ничью явным решением администратора");if(s.ranking.standings.length<19)fail("Для приглашения 18 финалистов нужны минимум 19 участников отбора");};
      const currentRanking=()=>{if(s.needsReconciliation)fail("Рейтинг изменился после приглашений — требуется явная сверка состава");};
      const initialInvites=async()=>{
        ensureRanking();await canonical(tx,s.ranking.standings.slice(0,19).map(p=>p.player_id));
        await tx.insert(invites).values(s.ranking.standings.slice(1,19).map((p,i)=>({eventId:e.id,playerId:p.player_id,qualifyingRank:p.qualification_rank,seat:i+1})));
        patch={...patch,winnerPlayerId:s.ranking.standings[0].player_id,rankingFingerprint:s.ranking.fingerprint,qualificationClosedAt:now,status:"inviting"};
      };
      const invitationAction=["admin_accept","admin_decline","undo_decline","cancel_invitation","replace_invitation"].includes(command.action);
      if(invitationAction){
        expectStage("inviting");if(e.finalRosterLockedAt)fail("Состав финала уже зафиксирован");currentRanking();
        if(e.finalTournamentId){const [t]=await tx.select({startAt:tournaments.startAt}).from(tournaments).where(eq(tournaments.id,e.finalTournamentId));if(t&&now>=t.startAt)fail("Финал уже начался — перестановки приглашений запрещены");}
      }
      switch(command.action){
        case "match_tournaments":{
          expectStage("draft","qualifying","inviting");if(e.finalRosterLockedAt)fail("Состав финала уже зафиксирован");if(command.confirmation!==true)fail("Подтвердите подбор турниров",400);
          const assignments=command.slotAssignments;
          if(!Array.isArray(assignments)||assignments.length>6||assignments.some(a=>!a||!qualificationUuid(a.slotId)||!qualificationUuid(a.tournamentId))||new Set(assignments.map(a=>a.slotId)).size!==assignments.length||new Set(assignments.map(a=>a.tournamentId)).size!==assignments.length)fail("Некорректный список привязок",400);
          const ids=assignments.map(a=>a.tournamentId).sort();const rows=ids.length?await tx.select().from(tournaments).where(inArray(tournaments.id,ids)).orderBy(asc(tournaments.id)).for("update"):[];
          for(const a of assignments){
            const slot=s.schedule.find(s=>s.id===a.slotId);if(!slot)fail("Слот другого отбора",400);
            if(slot.tournamentId&&slot.tournamentId!==a.tournamentId)fail("Уже назначенные турниры не перезаписываются");
            const t=rows.find(t=>t.id===a.tournamentId),expected=e.slug==="put-v-kaliningrad-2026"?KALININGRAD_SLOT_TYPES[slot.scheduledDate]:null;
            if(!t||!expected||t.tournamentType!==expected||t.isFinal||t.kind!=="free"||dateInZone(t.startAt,e.timezone)!==slot.scheduledDate||t.id===e.finalTournamentId)fail("Турнир не соответствует точной дате и типу слота",400);
            if(s.schedule.some(other=>other.id!==slot.id&&other.tournamentId===t.id))fail("Турнир уже назначен другому слоту");
            if((await tx.select({id:events.id}).from(events).where(eq(events.finalTournamentId,t.id))).length)fail("Финал другого отбора нельзя назначить квалификацией");
          }
          const changed=assignments.filter(a=>s.schedule.find(s=>s.id===a.slotId)!.tournamentId===null);
          if(!changed.length)return {ok:true,version:e.version};
          for(const a of changed)await tx.update(slots).set({tournamentId:a.tournamentId}).where(eq(slots.id,a.slotId));
          await tx.insert(audit).values({eventId:e.id,actorId,action:"match_slots",detail:{assignments:changed.map(a=>({...a,from:null,to:a.tournamentId}))}});break;
        }
        case "configure":{
          expectStage("draft","qualifying","inviting");if(e.finalRosterLockedAt)fail("Состав финала уже зафиксирован");
          const c=command.config;if(!c)fail("Нужна конфигурация",400);validateQualificationConfig(c);if(c.finalDate!==e.finalDate&&command.confirmation!==true)fail("Подтвердите изменение даты финала",400);
          const ids=command.tournamentIds;if(!Array.isArray(ids)||ids.length!==6||ids.some(id=>id!==null&&!qualificationUuid(id))||new Set(ids.filter(Boolean)).size!==ids.filter(Boolean).length)fail("Нужны шесть слотов без повторяющихся турниров",400);
          const finalId=command.finalTournamentId??null;if(finalId!==null&&!qualificationUuid(finalId))fail("Некорректный финальный турнир",400);if(finalId&&ids.includes(finalId))fail("Финал нельзя включать в источники квалификации");
          const selected=[...ids.filter((id):id is string=>!!id),...(finalId?[finalId]:[])].sort();
          const ts=selected.length?await tx.select().from(tournaments).where(inArray(tournaments.id,selected)).orderBy(asc(tournaments.id)).for("update"):[];
          if(ts.length!==selected.length)fail("Один из турниров не найден");
          for(let i=0;i<6;i++){const t=ts.find(t=>t.id===ids[i]);if(t&&(dateInZone(t.startAt,c.timezone)!==c.dates[i]||t.isFinal||t.tournamentType==="qualification_final"))fail("Дата выбранного турнира должна совпадать со слотом; Финал месяца не подходит");}
          if(finalId){const t=ts.find(t=>t.id===finalId)!;if(t.kind!=="free"||t.isFinal||t.tournamentType!=="qualification_final"||t.startingStack!==50000||t.maxPlayers!==18||t.status==="completed"||dateInZone(t.startAt,c.timezone)!==c.finalDate)fail("Нужен тип qualification_final: бесплатный, ровно 18 мест, дата финала, без is_final и завершения");
            const otherSlot=await tx.select({id:slots.id}).from(slots).where(eq(slots.tournamentId,finalId));if(otherSlot.length)fail("Финал уже включён в квалификационные слоты");
            const existing=await tx.select({id:registrations.id}).from(registrations).where(and(eq(registrations.tournamentId,finalId),ne(registrations.status,"cancelled")));if(existing.length)fail("Перед привязкой финала его обычная регистрация должна быть пустой");}
          for(const id of ids.filter((id):id is string=>!!id)){const f=await tx.select({id:events.id}).from(events).where(eq(events.finalTournamentId,id));if(f.length)fail("Связанный финал не может быть источником отбора");}
          for(const slot of s.schedule) await tx.update(slots).set({scheduledDate:c.dates[slot.displayOrder],tournamentId:ids[slot.displayOrder]}).where(eq(slots.id,slot.id));
          patch={title:c.title.trim(),slug:c.slug,rules:c.rules,timezone:c.timezone,bestResultsCount:c.bestResultsCount,finalDate:c.finalDate,finalTournamentId:finalId};
          break;
        }
        case "start":expectStage("draft");patch={status:"qualifying"};break;
        case "resolve_ties":{
          expectStage("qualifying","inviting");if(!command.reason?.trim())fail("Укажите основание решения по ничьей",400);
          acknowledged();const required=s.ranking.tieGroups.flat();const order=command.playerOrder;
          if(!order||new Set(order).size!==order.length||order.length!==required.length||order.some(id=>!required.includes(id)))fail("Нужно явно упорядочить всех участников существенной ничьей",400);
          patch={tieResolution:{fingerprint:s.ranking.factsFingerprint,playerOrder:order}};break;
        }
        case "close":{
          expectStage("qualifying");acknowledged();if(s.schedule.some(s=>!s.tournamentId||s.tournament?.status!=="completed"))fail("Сначала назначьте и завершите все шесть квалификаций");
          if(s.invitations.some(i=>active(i.status)))fail("Приглашения уже выдавались — используйте явное перевыпускание");await initialInvites();break;
        }
        case "reconcile":{
          expectStage("inviting");acknowledged();if(!command.reason?.trim())fail("Укажите причину перевыпуска",400);if(s.schedule.some(s=>!s.tournamentId||s.tournament?.status!=="completed"))fail("Все шесть квалификаций должны быть завершены");
          await tx.update(invites).set({status:"cancelled",respondedAt:now}).where(and(eq(invites.eventId,e.id),inArray(invites.status,["pending","accepted"])));
          await tx.delete(squad).where(eq(squad.eventId,e.id));await initialInvites();break;
        }
        case "reopen":{
          expectStage("inviting");acknowledged();if(!command.reason?.trim())fail("Укажите причину возобновления",400);
          await tx.update(invites).set({status:"cancelled",respondedAt:now}).where(and(eq(invites.eventId,e.id),inArray(invites.status,["pending","accepted"])));
          await tx.delete(squad).where(eq(squad.eventId,e.id));patch={status:"qualifying",winnerPlayerId:null,rankingFingerprint:null,qualificationClosedAt:null};break;
        }
        case "admin_accept":case "admin_decline":case "undo_decline":{
          const inv=s.invitations.find(i=>i.id===command.invitationId);if(!inv)fail("Приглашение не найдено",404);
          const target=command.action==="admin_accept"?"accepted":command.action==="admin_decline"?"declined":"pending";
          if(inv.status===target) return {ok:true,version:e.version};
          if(command.action==="undo_decline"?!["declined","replaced"].includes(inv.status):!active(inv.status))fail("Это приглашение уже не активно");
          if(target!=="declined"){
            if(s.invitations.some(i=>i.id!==inv.id&&active(i.status)&&(i.seat===inv.seat||i.playerId===inv.playerId)))fail("Место уже занято заменой. Отмена отказа не вытесняет приглашённого или подтверждённого игрока");
            if(s.invitations.filter(i=>i.status==="accepted"&&i.id!==inv.id).length>=18)fail("Все 18 мест подтверждены");
            await canonical(tx,[inv.playerId]);
          }
          await tx.update(invites).set({status:target,respondedAt:now}).where(eq(invites.id,inv.id));
          await tx.insert(audit).values({eventId:e.id,actorId,action:"invitation_state",detail:{invitationId:inv.id,playerId:inv.playerId,from:inv.status,to:target}});break;
        }
        case "cancel_invitation":{
          expectStage("inviting");const inv=s.invitations.find(i=>i.id===command.invitationId);if(!inv||!active(inv.status))fail("Приглашение уже не активно");
          await tx.update(invites).set({status:"cancelled",respondedAt:now}).where(eq(invites.id,inv.id));break;
        }
        case "replace_invitation":{
          expectStage("inviting");currentRanking();const inv=s.invitations.find(i=>i.id===command.invitationId);if(!inv||inv.status==="replaced")fail("Нельзя повторно заменить это приглашение");
          if(s.invitations.some(i=>i.id!==inv.id&&i.seat===inv.seat&&active(i.status)))fail("Место уже занято другим приглашением");
          const next=s.ranking.standings.find(p=>p.qualification_rank>=20&&!s.invitations.some(i=>i.playerId===p.player_id));
          if(!next||next.player_id!==command.playerId||next.unresolved_tie)fail("Замена возможна только следующим ещё не приглашённым игроком рейтинга");const tied=s.ranking.tieGroups.find(group=>group.includes(next.player_id));
          if(tied&&(!e.tieResolution||e.tieResolution.fingerprint!==s.ranking.factsFingerprint||!tied.every(id=>e.tieResolution!.playerOrder.includes(id))))fail("Сначала разрешите ничью на позиции замены");
          await canonical(tx,[next.player_id]);
          await tx.update(invites).set({status:"replaced",respondedAt:now}).where(eq(invites.id,inv.id));await tx.insert(invites).values({eventId:e.id,playerId:next.player_id,qualifyingRank:next.qualification_rank,seat:inv.seat,replacesId:inv.id});break;
        }
        case "confirm_winner":{
          expectStage("inviting");currentRanking();if(!e.winnerPlayerId)fail("Победитель не определён");await canonical(tx,[e.winnerPlayerId]);
          await tx.insert(squad).values({eventId:e.id,playerId:e.winnerPlayerId,source:"qualification_winner",slot:0}).onConflictDoNothing();break;
        }
        case "lock_roster":{
          expectStage("inviting");currentRanking();acknowledged();if(!e.finalTournamentId)fail("Назначьте финальный турнир");
          const accepted=s.invitations.filter(i=>i.status==="accepted");if(accepted.length!==18||new Set(accepted.map(i=>i.playerId)).size!==18)fail("Нужны ровно 18 принятых приглашений");
          if(!s.members.some(m=>m.source==="qualification_winner"&&m.player_id===e.winnerPlayerId))fail("Подтвердите прямого победителя отбора");
          await tx.select({id:tournaments.id}).from(tournaments).where(eq(tournaments.id,e.finalTournamentId)).for("update");
          const [final]=await tx.select().from(tournaments).where(eq(tournaments.id,e.finalTournamentId));if(!final||final.kind!=="free"||final.isFinal||final.tournamentType!=="qualification_final"||final.startingStack!==50000||final.maxPlayers!==18||final.status==="completed"||dateInZone(final.startAt,e.timezone)!==e.finalDate)fail("Некорректный финальный турнир");
          await canonical(tx,accepted.map(i=>i.playerId));
          patch={status:"final",finalRosterLockedAt:now};
          // Set lock flag in the same transaction before guarded registrations.
          await tx.update(events).set(patch).where(eq(events.id,e.id));
          await tx.insert(registrations).values(accepted.map(i=>({playerId:i.playerId,tournamentId:e.finalTournamentId!,status:"registered"}))).onConflictDoUpdate({target:[registrations.playerId,registrations.tournamentId],set:{status:"registered"}});break;
        }
        case "complete_final":{
          expectStage("final");acknowledged();if(!e.finalTournamentId||!e.finalRosterLockedAt||e.finalOutcome)fail("Финал не зафиксирован или уже завершён");
          const [t]=await tx.select().from(tournaments).where(eq(tournaments.id,e.finalTournamentId)).for("update");
          if(!t||t.tournamentType!=="qualification_final"||t.status==="completed"||t.maxPlayers!==18||t.isFinal)fail("Нужен незавершённый закрытый финал отбора");
          if(now<t.startAt)fail("Финал ещё не начался");
          const accepted=s.invitations.filter(i=>i.status==="accepted").map(i=>i.playerId);
          if(accepted.length<3||accepted.length>t.maxPlayers||new Set(accepted).size!==accepted.length||accepted.includes(e.winnerPlayerId!))fail("Нужны от 3 до 18 разных подтверждённых финалистов без прямого победителя");
          await canonical(tx,accepted);
          const regs=await tx.select().from(registrations).where(eq(registrations.tournamentId,t.id));
          if(regs.length!==accepted.length||new Set(regs.map(r=>r.playerId)).size!==accepted.length||regs.some(r=>!accepted.includes(r.playerId)||!["registered","attended"].includes(r.status)))fail("Состав регистраций не совпадает с зафиксированным финалом");
          const attendance=await tx.select().from(tournamentAttendance).where(and(eq(tournamentAttendance.tournamentId,t.id),eq(tournamentAttendance.arrived,true)));
          if(attendance.some(a=>!accepted.includes(a.playerId)))fail("В финале присутствует недопущенный игрок");
          const eliminated=await tx.select().from(tournamentPlayerEliminations).where(and(eq(tournamentPlayerEliminations.tournamentId,t.id),eq(tournamentPlayerEliminations.eliminated,true)));
          const arrivedIds=attendance.map(a=>a.playerId),finished=eliminated.filter(a=>arrivedIds.includes(a.playerId));
          if(eliminated.some(a=>!accepted.includes(a.playerId)))fail("Есть выбытие недопущенного игрока");
          const survivorIds=accepted.filter(id=>!eliminated.some(a=>a.playerId===id)).sort();
          if(survivorIds.length!==3||survivorIds.some(id=>!arrivedIds.includes(id)))fail("Для завершения должны оставаться ровно три пришедших допущенных игрока");
          if(eliminated.some(a=>!a.eliminatedAt||!Number.isFinite(a.eliminatedAt.getTime())||a.eliminatedAt<t.startAt||a.eliminatedAt>now)||new Set(eliminated.map(a=>a.eliminatedAt!.toISOString())).size!==eliminated.length)fail("Уточните уникальное время выбывания перед фиксацией мест");
          if((await tx.select({id:results.id}).from(results).where(eq(results.tournamentId,t.id))).length)fail("Существующие результаты нельзя перезаписывать специальным завершением");
          await canonical(tx,arrivedIds);
          finished.sort((a,b)=>b.eliminatedAt!.getTime()-a.eliminatedAt!.getTime());
          patch={finalOutcome:{survivorIds,arrivedIds:arrivedIds.sort(),eliminations:finished.map((a,i)=>({playerId:a.playerId,place:i+4})),completedAt:now.toISOString()}};
          await tx.update(events).set(patch).where(eq(events.id,e.id));
          await tx.update(tournaments).set({status:"completed"}).where(eq(tournaments.id,t.id));
          await tx.update(registrations).set({status:"attended"}).where(and(eq(registrations.tournamentId,t.id),inArray(registrations.playerId,arrivedIds)));
          await tx.insert(squad).values(survivorIds.map((playerId,i)=>({eventId:e.id,playerId,source:"final_top3",slot:i+1,finalPlace:null})));
          break;
        }
        case "select_finalists":{
          expectStage("final");const top=await this.finalTop(tx,e,s.invitations);await tx.delete(squad).where(and(eq(squad.eventId,e.id),eq(squad.source,"final_top3")));
          await tx.insert(squad).values(top.map((r,i)=>({eventId:e.id,playerId:r.playerId,source:"final_top3",slot:i+1,finalPlace:r.place})));break;
        }
        case "set_captain":{
          expectStage("final");if(!command.playerId)fail("Выберите капитана",400);await canonical(tx,[command.playerId]);if(s.members.some(m=>m.player_id===command.playerId&&m.source!=="captain"))fail("Капитан должен быть пятым отдельным человеком");
          await tx.insert(squad).values({eventId:e.id,playerId:command.playerId,source:"captain",slot:0}).onConflictDoUpdate({target:[squad.eventId,squad.source,squad.slot],set:{playerId:command.playerId,confirmedAt:null}});break;
        }
        case "confirm_squad":{
          expectStage("final");currentRanking();acknowledged();const top=await this.finalTop(tx,e,s.invitations);const members=s.members;
          if(members.length!==5||new Set(members.map(m=>m.player_id)).size!==5||members.filter(m=>m.source==="captain").length!==1||!members.some(m=>m.source==="qualification_winner"&&m.player_id===e.winnerPlayerId)||top.some((r,i)=>!members.some(m=>m.source==="final_top3"&&m.slot===i+1&&m.player_id===r.playerId&&m.finalPlace===r.place)))fail("Нужны победитель отбора, три актуальных призёра финала и отдельный капитан");
          await canonical(tx,members.map(m=>m.player_id));await tx.update(squad).set({confirmedAt:now}).where(eq(squad.eventId,e.id));patch={status:"completed",squadConfirmedAt:now};break;
        }
        default:fail("Неизвестное действие",400);
      }
      await tx.update(events).set({...patch,version:e.version+1,updatedAt:now}).where(eq(events.id,e.id));
      const invitationAfter=command.invitationId?(await tx.select({status:invites.status}).from(invites).where(and(eq(invites.id,command.invitationId),eq(invites.eventId,e.id))))[0]:null;
      await tx.insert(audit).values({eventId:e.id,actorId,action:command.action,detail:{previousPhase:e.status,phase:patch.status??e.status,invitationFrom:s.invitations.find(i=>i.id===command.invitationId)?.status??null,invitationTo:invitationAfter?.status??null,reason:command.reason??null,invitationId:command.invitationId??null,playerId:command.playerId??null,playerOrder:command.playerOrder??null,previousWinner:e.winnerPlayerId,previousInvitationIds:s.invitations.filter(i=>active(i.status)).map(i=>i.id),selectedTournamentIds:command.tournamentIds??null}});
      return {ok:true,version:e.version+1};
    });
  }
  private async createAndLinkFinal(tx:Executor,e:Event,command:QualificationCommand,actorId:string){
    if(!["draft","qualifying","inviting"].includes(e.status)||e.finalRosterLockedAt)fail("Состав финала зафиксирован или отбор недоступен для изменений");
    const input=command.finalInput;if(!input)fail("Нужны параметры финала",400);
    const startAt=qualificationFinalInstant(input);
    if(input.timezone!==e.timezone)fail("Часовой пояс должен совпадать с отбором",400);
    if(input.reuseTournamentId&&!qualificationUuid(input.reuseTournamentId))fail("Некорректный ID финала",400);
    const publicFinal=(t:typeof tournaments.$inferSelect)=>({id:t.id,title:t.title,startAt:t.startAt.toISOString(),status:t.status,maxPlayers:t.maxPlayers,tournamentType:t.tournamentType,startingStack:t.startingStack});
    if(e.finalTournamentId){
      const [existing]=await tx.select().from(tournaments).where(eq(tournaments.id,e.finalTournamentId)).for("update");
      // Durable idempotency: same already-committed intent, including a lost response.
      if(existing&&existing.tournamentType==="qualification_final"&&existing.startAt.toISOString()===startAt&&e.finalDate===input.date&&(input.reuseTournamentId?input.reuseTournamentId===existing.id:input.title.trim()===existing.title))return {ok:true,version:e.version,finalTournament:publicFinal(existing),alreadyLinked:true};
      fail("К отбору уже привязан финал. Используйте его существующую ссылку");
    }
    if(e.version!==command.version)fail("Данные устарели — обновите страницу");
    if(command.confirmation!==true)fail("Подтвердите создание/привязку и изменение даты финала",400);
    const dates=(await tx.select({date:slots.scheduledDate}).from(slots).where(eq(slots.eventId,e.id)).orderBy(asc(slots.displayOrder))).map(s=>s.date);
    validateQualificationConfig({...configOf(e,dates),finalDate:input.date});
    if(new Date(startAt)<=new Date())fail("Финал должен начинаться в будущем",400);
    // Serializes same-time new/reuse intents across events without a new schema.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"qualification-final/"+startAt},0))`);
    const candidates=await tx.select().from(tournaments).where(and(eq(tournaments.tournamentType,"qualification_final"),eq(tournaments.startAt,new Date(startAt)))).orderBy(asc(tournaments.id)).for("update");
    let final:typeof tournaments.$inferSelect;
    if(input.reuseTournamentId){
      const found=candidates.find(t=>t.id===input.reuseTournamentId);if(!found)fail("Выбранный финал не соответствует указанному времени",400);
      if(found.kind!=="free"||found.isFinal||found.maxPlayers!==18||found.startingStack!==50000||found.lateRegistrationEndsAt!==null||found.ratingGuarantee!==null||found.status==="completed")fail("Настройки существующего финала несовместимы");
      if((await tx.select({id:events.id}).from(events).where(eq(events.finalTournamentId,found.id))).length)fail("Финал уже привязан к другому отбору");
      if((await tx.select({id:slots.id}).from(slots).where(eq(slots.tournamentId,found.id))).length)fail("Финал уже используется в квалификационных слотах");
      if((await tx.select({id:registrations.id}).from(registrations).where(eq(registrations.tournamentId,found.id)).limit(1)).length||(await tx.select({id:results.id}).from(results).where(eq(results.tournamentId,found.id)).limit(1)).length)fail("У финала уже есть регистрации или результаты");
      final=found;
    }else{
      if(candidates.length)fail("На это время уже есть финал. Обновите preview и явно выберите существующий");
      const seasonRows=await tx.select().from(seasons).for("share");
      let seasonId:string;
      try{seasonId=resolveSeasonForCalendarDate(toMoscowCalendarDate(startAt),seasonRows.map(s=>({id:s.id,title:s.title,start_date:s.startDate,end_date:s.endDate,is_active:s.isActive,created_at:s.createdAt.toISOString()}))).id;}catch(error){fail(error instanceof Error?error.message:"Не найден сезон",409);}
      const values=prepareTournamentCreation({title:input.title.trim(),description:TOURNAMENT_PRESET_TEMPLATES.qualification_final.description,location:CLUB_ADDRESS,start_at:startAt,max_players:18,tournament_type:"qualification_final",starting_stack:50000,rating_guarantee:null,late_registration_ends_at:null,is_final:false},seasonId);
      [final]=await tx.insert(tournaments).values(tournamentColumnValues(values) as typeof tournaments.$inferInsert).returning();
    }
    const now=new Date();await tx.update(events).set({finalDate:input.date,finalTournamentId:final.id,version:e.version+1,updatedAt:now}).where(eq(events.id,e.id));
    await tx.insert(audit).values({eventId:e.id,actorId,action:input.reuseTournamentId?"reuse_final":"create_final",detail:{tournamentId:final.id,startAt,timezone:input.timezone,previousFinalDate:e.finalDate,finalDate:input.date,registrationsCreated:0,invitationsCreated:0}});
    return {ok:true,version:e.version+1,finalTournament:publicFinal(final),alreadyLinked:false};
  }
  private async finalTop(tx:Executor,e:Event,invitations:{playerId:string;status:string}[]){
    if(!e.finalTournamentId)fail("Финал не назначен");
    const [t]=await tx.select().from(tournaments).where(eq(tournaments.id,e.finalTournamentId)).for("update");if(!t||t.status!=="completed")fail("Финальный турнир ещё не завершён");
    if(t.tournamentType==="qualification_final"){
      const ids=e.finalOutcome?.survivorIds;if(!ids||ids.length!==3||new Set(ids).size!==3||ids.some(id=>id===e.winnerPlayerId||!invitations.some(i=>i.playerId===id&&i.status==="accepted")))fail("Нужны три зафиксированных оставшихся участника финала");
      await canonical(tx,ids);return [...ids].sort().map(playerId=>({playerId,place:null as number|null}));
    }
    const eligible=invitations.filter(i=>i.status==="accepted").map(i=>i.playerId);if(eligible.length!==18)fail("Повреждён зафиксированный состав финала");
    const rows=await tx.select({playerId:results.playerId,place:results.place}).from(results).innerJoin(players,eq(results.playerId,players.id)).where(and(eq(results.tournamentId,t.id),inArray(results.playerId,eligible),eq(results.arrived,true),isNull(players.mergedIntoPlayerId))).orderBy(asc(results.place)).limit(3);
    if(rows.length!==3||rows.some(r=>r.playerId===e.winnerPlayerId))fail("Недостаточно подтверждённых результатов допустимых финалистов");await canonical(tx,rows.map(r=>r.playerId));return rows;
  }
}
