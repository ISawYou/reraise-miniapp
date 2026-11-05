import { KALININGRAD_EVENT } from "@/lib/qualification-config";
import { rankQualification } from "@/lib/qualification-ranking";
import type { QualificationPublicModel,QualificationAdminModel } from "@/types/qualifications";
export function qualificationFixture(empty=false):QualificationAdminModel {
 const config=KALININGRAD_EVENT;
 const ranking=rankQualification(empty?[]:Array.from({length:22},(_,i)=>Array.from({length:6},(_,n)=>({player_id:`player-${i}`,display_name:i===0?"Очень длинный никнейм участника отбора безкомандыдляпроверкипереноса":"Игрок "+i,custom_avatar_url:i===0?"/missing-avatar.png":null,telegram_avatar_url:null,tournament_id:`t-${n}`,title:n===0?"Bounty Hunters — квалификация с длинным названием турнира":"Квалификация "+n,date:config.dates[n]+"T16:00:00Z",points:1000-i*10-n}))).flat(),3);
 return {event:{id:"event-1",slug:config.slug,title:config.title,rules:config.rules,timezone:config.timezone,finalDate:config.finalDate,bestResultsCount:3,status:"qualifying",version:1,finalTournamentId:null,finalRosterLockedAt:null,winnerPlayerId:null,rankingFingerprint:null},schedule:config.dates.map((scheduledDate,n)=>({id:`slot-${n}`,scheduledDate,tournamentId:empty?null:`t-${n}`,displayOrder:n,tournament:empty?null:{id:`t-${n}`,title:"Квалификация "+n,startAt:scheduledDate+"T16:00:00Z",status:"completed",kind:"free",isFinal:false,maxPlayers:30}})),ranking:{...ranking,fingerprint:"hash",factsFingerprint:"facts"},needsReconciliation:false,members:[],invitations:[],tournamentChoices:[],audit:[]};
}
export const publicFixture=(empty=false):QualificationPublicModel=>qualificationFixture(empty);
