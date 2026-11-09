import { describe, it, expect } from "vitest";
import { calculateRatingPointsForTournament, calculateRatingPlaceStructureForTournament, type PlayerRatingInputV2 } from "../rating-v2";
import { isRatingEligibleTournament } from "@/lib/tournament-helpers";
import { rankQualification } from "@/lib/qualification-ranking";
const players: PlayerRatingInputV2[] = Array.from({length:18},(_,i)=>({player_id:`test-${i}`,place:i+1,arrived:true,entries: i%2+1,addons:0,knockouts:0}));
const sum = (r: ReturnType<typeof calculateRatingPointsForTournament>)=>r.results.reduce((s,p)=>s+p.rating_points,0);
describe("R2 Phoenix floor (synthetic test amounts, not a production guarantee)",()=>{
 const natural=sum(calculateRatingPointsForTournament(players,"phoenix","v2",{ratingGuarantee:null}));
 it.each([natural+73,natural,natural-1])("MAX floor %s preserves frozen distribution and never double credits",guarantee=>{
  const direct=calculateRatingPointsForTournament(players,"phoenix","v2",{ratingGuarantee:guarantee});
  const ratingPlaces=calculateRatingPlaceStructureForTournament(players.map(p=>({entries:p.entries,addons:p.addons})),"phoenix","v2",{ratingGuarantee:guarantee});
  const frozen=calculateRatingPointsForTournament(players,"phoenix","v2",{ratingGuarantee:guarantee,ratingPlaces});
  expect(sum(direct)).toBe(Math.max(natural,guarantee));expect(frozen.results).toEqual(direct.results);
  expect(direct.meta).toMatchObject({naturalPool:natural,guarantee,topUp:Math.max(0,guarantee-natural),finalPool:Math.max(natural,guarantee)});
  const facts=direct.results.map(r=>({...r,display_name:r.player_id,custom_avatar_url:null,telegram_avatar_url:null,tournament_id:"phoenix-test",title:"PHOENIX",date:"2026-11-11",points:r.rating_points}));
  expect(rankQualification(facts,3).standings.reduce((s,p)=>s+p.qualification_total,0)).toBe(Math.max(natural,guarantee));
 });
 it("null floor and other formats never acquire an invented guarantee",()=>{expect(calculateRatingPointsForTournament(players,"phoenix","v2").meta).toMatchObject({guarantee:null,topUp:0});expect(calculateRatingPointsForTournament(players,"classic","v2",{ratingGuarantee:natural+999}).results).toEqual(calculateRatingPointsForTournament(players,"classic","v2").results)});
 it("qualification final is non-rating even when a caller omits eligibility or supplies frozen points",()=>{expect(isRatingEligibleTournament({is_final:false,tournament_type:"qualification_final"})).toBe(false);const r=calculateRatingPointsForTournament(players,"qualification_final","v2",{ratingGuarantee:99999,ratingPlaces:[{place:1,points:99999}]});expect(sum(r)).toBe(0);expect(r.results.every(p=>p.participation_points===0&&p.itm_points===0)).toBe(true);expect(isRatingEligibleTournament({is_final:false,tournament_type:"deep_stack"})).toBe(true)});
});
