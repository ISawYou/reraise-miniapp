import { QualificationError } from "./qualification-config";
import type { QualificationAdminModel } from "@/types/qualifications";
export const FINAL_TIME_ZONE = "Europe/Moscow";
export type CreateQualificationFinalInput = {date:string;time:string;timezone:string;title:string;reuseTournamentId?:string};
export function validateQualificationDate(date:unknown): asserts date is string {
  if(typeof date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date+"T12:00:00Z").toISOString().slice(0,10)!==date)throw new QualificationError("Некорректная дата",400);
}
export function qualificationFinalInstant(input:CreateQualificationFinalInput):string {
  if(!input||input.timezone!==FINAL_TIME_ZONE)throw new QualificationError("Часовой пояс финала — Europe/Moscow",400);
  validateQualificationDate(input.date);
  if(typeof input.time!=="string"||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))throw new QualificationError("Укажите время ЧЧ:ММ",400);
  if(typeof input.title!=="string"||!input.title.trim()||input.title.trim().length>200)throw new QualificationError("Название финала: от 1 до 200 символов",400);
  // Explicit modern Moscow offset, verified against ICU; never the device zone.
  const instant=new Date(`${input.date}T${input.time}:00+03:00`);
  const day=new Intl.DateTimeFormat("en-CA",{timeZone:FINAL_TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).format(instant);
  const time=new Intl.DateTimeFormat("en-GB",{timeZone:FINAL_TIME_ZONE,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(instant);
  if(day!==input.date||time!==input.time)throw new QualificationError("Не удалось однозначно определить московское время",400);
  return instant.toISOString();
}
export function qualificationFinalLabel(startAt:string,zone=FINAL_TIME_ZONE) {
  return new Date(startAt).toLocaleString("ru-RU",{timeZone:zone,day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"})+ (zone===FINAL_TIME_ZONE?" МСК":` (${zone})`);
}
export const KALININGRAD_SLOT_TYPES:Record<string,string>={"2026-11-06":"boss_bounty","2026-11-07":"deep_stack","2026-11-08":"win_the_button","2026-11-11":"phoenix","2026-11-12":"classic","2026-11-13":"boss_bounty"};
type Choice=QualificationAdminModel["tournamentChoices"][number];
export function proposeQualificationMatches(model:Pick<QualificationAdminModel,"event"|"schedule"|"tournamentChoices">) {
  const used=new Set(model.schedule.map(s=>s.tournamentId).filter(Boolean));
  return model.schedule.map(slot=>{
    const expectedType=model.event.slug==="put-v-kaliningrad-2026"?KALININGRAD_SLOT_TYPES[slot.scheduledDate]:undefined;
    const candidates=slot.tournamentId||!expectedType?[]:model.tournamentChoices.filter(t=>!used.has(t.id)&&t.id!==model.event.finalTournamentId&&!t.linkedFinalEventId&&!t.isFinal&&t.kind==="free"&&t.tournamentType===expectedType&&new Intl.DateTimeFormat("en-CA",{timeZone:model.event.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(t.startAt))===slot.scheduledDate);
    return {slotId:slot.id,date:slot.scheduledDate,before:slot.tournamentId,expectedType,candidates,proposedId:slot.tournamentId??(candidates.length===1?candidates[0].id:null)};
  });
}
export function compatibleUnlinkedFinal(t:Choice) {
  return t.tournamentType==="qualification_final"&&t.kind==="free"&&!t.isFinal&&t.maxPlayers===18&&t.startingStack===50000&&t.lateRegistrationEndsAt===null&&t.ratingGuarantee===null&&t.status!=="completed"&&!t.linkedFinalEventId&&t.hasRegistrations===false&&t.hasResults===false;
}
