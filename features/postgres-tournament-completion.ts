import "server-only";
import {getAdminTournamentParticipants,getTournamentById,getTournamentAttendance,getTournamentEliminations,getTournamentRebuyState,getDerivedEliminationPlaces,saveTournamentResults} from "@/features/tournaments";
import {getTournamentLateRegistrationSnapshot} from "@/features/late-registration";
import {getMysteryBountySnapshot} from "@/features/mystery-bounty";
import {tournamentOperationsRepository,OperationsError} from "@/lib/repositories/tournament-operations/PostgresTournamentOperationsRepository";
import {operationFieldsFor,validateMysteryAllocation,assertPhoenixFreeReentries} from "@/lib/tournament-operation-fields";
import {calculateRatingPointsForTournament} from "@/features/rating-v2";
import {isRatingEligibleTournament} from "@/lib/tournament-helpers";
import {postgresCompletionFingerprint} from "./postgres-completion-fingerprint";
import {finishPokerClockTournament} from "@/lib/poker-clock-client";

export type CompletionBlocker={player_id:string;display_name:string;fields:string[]};
export class CompletionReadinessError extends OperationsError{
 constructor(public blockers:CompletionBlocker[]){super(`Невозможно завершить: заполните и проверьте данные всех участников:\n${blockers.map(b=>`${b.display_name}: ${b.fields.join(", ")}`).join("\n")}`,409);}
}

export async function previewPostgresCompletion(id:string){
 const fingerprint=await postgresCompletionFingerprint(id);
 const [t,participants,attendance,entries,eliminations,operations,frozen,mystery]=await Promise.all([getTournamentById(id),getAdminTournamentParticipants(id),getTournamentAttendance(id),getTournamentRebuyState(id),getTournamentEliminations(id),tournamentOperationsRepository.read(id),getTournamentLateRegistrationSnapshot(id),getMysteryBountySnapshot(id)]);
 if(t.google_sheet_tab_name?.trim())throw new OperationsError("Требуется явное переключение турнира с Google Sheets",409);
 if(t.status==="completed")throw new OperationsError("Турнир уже завершён",409);
 if(t.tournament_type==="qualification_final")throw new OperationsError("Завершите финал на трёх оставшихся игроках в редакторе отбора",409);
 const roster=participants.filter(p=>["registered","attended"].includes(p.status));
 if(!roster.length)throw new OperationsError("Нет участников",409);
 const fields=operationFieldsFor(t.tournament_type);
 const derivedPlaces=await getDerivedEliminationPlaces(id);
 const blockers:CompletionBlocker[]=[];
 const labels:Record<string,string>={freeReentries:"Бесплатные re-entry",knockouts:"KO",bossKnockouts:"Boss KO",mysteryEnvelopesWon:"Конверты",mysteryPoints:"Mystery очки"};
 const effectivePlaces=new Map<string,number>();
 for(const p of roster){
  const op=operations.find(o=>o.playerId===p.player_id),a=attendance.get(p.player_id),b=entries.get(p.player_id),e=eliminations.get(p.player_id);
  const place=e?.eliminated?derivedPlaces.get(p.player_id)??op?.place:op?.place;
  const missing:string[]=[];
  if(!a)missing.push("Приход");
  if(!b)missing.push("Входы / Add-on");
  if(!op)missing.push("Операционная строка");
  if(place==null)missing.push("Место / порядок выбытия");else effectivePlaces.set(p.player_id,place);
  if(a?.arrived){
   for(const field of fields.filter(f=>f!=="place"&&f!=="comment"&&f!=="paid"))if(op?.[field]==null)missing.push(labels[field]??field);
   if(b&&b.rebuys<1)missing.push("Минимум один вход для пришедшего игрока");
  }
  try{assertPhoenixFreeReentries(t.tournament_type,op?.freeReentries);}catch(error){missing.push((error as Error).message);}
  if(t.tournament_type==="phoenix"&&b&&(b.rebuys>2||b.addons!==0))missing.push("PHOENIX: максимум два входа и без Add-on");
  if(missing.length)blockers.push({player_id:p.player_id,display_name:p.admin_nick,fields:missing});
 }
 // Keep canonical derived places and the existing 1..N rule; report all
 // conflicting places alongside missing fields without inventing a finish.
 for(const p of roster){const place=effectivePlaces.get(p.player_id);if(place!=null&&(!Number.isInteger(place)||place<1||place>roster.length||[...effectivePlaces.values()].filter(v=>v===place).length>1)){
  const existing=blockers.find(b=>b.player_id===p.player_id);const message="Места должны быть уникальными и последовательными от 1 до числа участников";
  if(existing)existing.fields.push(message);else blockers.push({player_id:p.player_id,display_name:p.admin_nick,fields:[message]});
 }}
 if(blockers.length)throw new CompletionReadinessError(blockers);
 const rows=roster.map(p=>{
  const op=operations.find(o=>o.playerId===p.player_id),a=attendance.get(p.player_id),b=entries.get(p.player_id);
  assertPhoenixFreeReentries(t.tournament_type,op?.freeReentries);
  const eliminated=eliminations.get(p.player_id)?.eliminated??false;
  const place=eliminated?derivedPlaces.get(p.player_id)??op?.place:op?.place;
  if(!op||place==null||!a||!b)throw new OperationsError(`${p.admin_nick}: заполните место, приход и входы`,409);
  if(a.arrived&&fields.filter(f=>f!=="place"&&f!=="comment"&&f!=="paid").some(f=>op[f]==null))throw new OperationsError(`${p.admin_nick}: заполните все применимые операционные поля`,409);
  if(a.arrived&&b.rebuys<1)throw new OperationsError(`${p.admin_nick}: пришедшему игроку нужен минимум один вход`,409);
  if(t.tournament_type==="phoenix"&&(b.rebuys>2||b.addons!==0))throw new OperationsError("PHOENIX: максимум два входа и без Add-on",409);
  return {player_id:p.player_id,display_name:p.admin_nick,place,arrived:a.arrived,entries:b.rebuys,addons:b.addons,knockouts:fields.includes("knockouts")?op.knockouts??0:0,boss_knockouts:fields.includes("bossKnockouts")?op.bossKnockouts??0:0,mystery_bounty_points:fields.includes("mysteryPoints")?op.mysteryPoints??0:0,free_reentries:op.freeReentries??0,eliminated};
 });
 const places=rows.map(r=>r.place).sort((a,b)=>a-b);if(places.some((p,i)=>p!==i+1))throw new OperationsError("Места должны быть уникальными и последовательными от 1 до числа участников",409);
 if(t.tournament_type==="mystery_bounty")validateMysteryAllocation(roster.map(p=>operations.find(o=>o.playerId===p.player_id)??{}),mystery);
 const rating=calculateRatingPointsForTournament(rows,t.tournament_type,t.rating_formula_version,{ratingGuarantee:t.rating_guarantee,placementPointsMultiplier:t.placement_points_multiplier,ratingPlaces:frozen?.rating_places},isRatingEligibleTournament(t));
 if(await postgresCompletionFingerprint(id)!==fingerprint)throw new OperationsError("Данные изменились; повторите предварительный расчёт",409);
 return {fingerprint,rows,rating:rating.results,frozenPool:frozen?.rating_places.reduce((s,p)=>s+p.points,0)??null};
}
export async function completePostgresTournament(id:string,expectedFingerprint:string){
 const preview=await previewPostgresCompletion(id);
 if(preview.fingerprint!==expectedFingerprint)throw new OperationsError("Предварительный расчёт устарел; проверьте свежие данные",409);
 await saveTournamentResults(id,preview.rows.map(row=>{
  const r=preview.rating.find(r=>r.player_id===row.player_id)!;
  return {...row,reentries:row.entries,rating_points:r.rating_points,participation_points:r.participation_points,knockout_points:r.knockout_points,boss_bounty_points:r.boss_bounty_points,itm_points:r.itm_points};
 }),preview.fingerprint);
 const clock=await finishPokerClockTournament(id);
 return {ok:true,completedCount:preview.rows.length,pokerClockSync:{status:clock.status}};
}
