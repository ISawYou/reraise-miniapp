import { KALININGRAD_EVENT } from "./qualification-config";
import { TOURNAMENT_PRESET_TEMPLATES } from "@/config/tournament-presets";
import type { TournamentType } from "@/types/domain";
type Existing = {id:string; title:string; tournament_type:string; start_at:string; status:string; rating_guarantee:number|null; kind:string; max_players:number; is_final:boolean; description?:string|null};
const plan: {date:string; time:string; end:string|null; type:TournamentType; slot:number|null}[] = [
 {date:"2026-11-10",time:"19:00",end:"22:00",type:"free_roll",slot:null},
 {date:"2026-11-11",time:"19:00",end:"22:00",type:"phoenix",slot:3},
 {date:"2026-11-12",time:"19:00",end:"22:00",type:"classic",slot:4},
 {date:"2026-11-13",time:"19:00",end:"22:00",type:"boss_bounty",slot:5},
 {date:"2026-11-14",time:"12:00",end:null,type:"qualification_final",slot:null},
 {date:"2026-11-14",time:"18:00",end:"21:00",type:"deep_stack",slot:null},
 {date:"2026-11-15",time:"17:00",end:"20:00",type:"mystery_bounty",slot:null},
];
// Pure preview only: no writes, no auto-create, no overwrite by title/date alone.
// Apply is a separately authorized admin operation against a fresh preview.
export function previewNovemberR2(tournaments: Existing[], event: {id:string;version:number;final_date:string;final_tournament_id:string|null}, slots: {scheduled_date:string;tournament_id:string|null;display_order:number}[]) {
 const operations=plan.map(p=>{
  const linkedId=p.slot!==null?slots.find(s=>s.display_order===p.slot)?.tournament_id:p.type==="qualification_final"?event.final_tournament_id:null;
  const candidates=linkedId?tournaments.filter(t=>t.id===linkedId):tournaments.filter(t=>new Date(t.start_at).toLocaleDateString("en-CA",{timeZone:"Europe/Moscow"})===p.date && (t.tournament_type===p.type || (p.type==="qualification_final"&&t.id===event.final_tournament_id)));
  const existing=candidates.length===1?candidates[0]:null;
  return {operation:linkedId&&!candidates.length?"BLOCKED_MISSING_LINKED_ID":candidates.length>1?"BLOCKED_AMBIGUOUS":existing?"UPDATE_EXISTING":"CREATE_REQUIRES_APPROVAL",id:existing?.id??null,before:existing,after:{title:TOURNAMENT_PRESET_TEMPLATES[p.type].title,description:TOURNAMENT_PRESET_TEMPLATES[p.type].description+(p.date==="2026-11-13"?"\n\n13 ноября в 18:00 — стандартное бесплатное обучение.":""),tournament_type:p.type,start_at:`${p.date}T${p.time}:00+03:00`,late_registration_ends_at:p.end?`${p.date}T${p.end}:00+03:00`:null,max_players:p.type==="qualification_final"?18:46,kind:existing?.kind??"free",is_final:false,starting_stack:p.type==="phoenix"||p.type==="qualification_final"||p.type==="deep_stack"?50000:30000,rating_guarantee:existing?.rating_guarantee??null},qualificationSlot:p.slot,requires:existing?.status==="completed"?["BLOCKED_HISTORICAL"]:!existing&&p.type!=="qualification_final"?["APPROVE_NEW_EVENT"]:!existing?["APPROVE_NEW_EVENT"]:[]};
 });
 return {mode:"DRY_RUN_ONLY",phoenixGuarantee:{verified:!!operations.find(o=>o.after.tournament_type==="phoenix")?.before,configuredValue:operations.find(o=>o.after.tournament_type==="phoenix")?.after.rating_guarantee??null,ownerDecision:"Numeric floor not chosen yet; configure later",behaviorUntilConfigured:"natural_pool",doNotInvent:true},timezone:"Europe/Moscow",expectedEventVersion:event.version,eventId:event.id,operations,eventChange:{before:event,after:{final_date:KALININGRAD_EVENT.finalDate,final_start_at:"2026-11-14T12:00:00+03:00",final_tournament_id:"RESOLVE_APPROVED_FINAL_ID",confirmation_deadline:"2026-11-14T10:00:00+03:00"}},preserveHistoricalSlots:slots.filter(s=>s.display_order<3),slotsAfter:slots.map(s=>s.display_order<3?s:{...s,tournament_id:s.tournament_id??`RESOLVE_SLOT_${s.display_order+1}_ID`}),finance:{source:"ReRaise Finance / finance_tournament_pricing",phoenix:{entryPriceRub:1500,reentryPriceRub:1500,addonAllowed:false},final:{entryPriceRub:0,reentryAllowed:false,addonAllowed:false},written:false},fridayAcademy:{at:"2026-11-13T18:00:00+03:00",priceRub:0,operation:"OPERATIONAL_NOTICE_ONLY_NO_NOTIFICATIONS"},idempotency:"Re-read exact IDs and version; match before values; reuse persisted source IDs returned by admin create; repeat previews must resolve existing events, never duplicate. Ambiguous matches or historical rows block apply.",writes:false};
}
