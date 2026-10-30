import { describe, expect, it, vi } from "vitest";
import type { results } from "@/lib/db/schema";
import { calculateRatingPoints } from "@/features/rating";
import { calculateRatingPointsForTournament } from "@/features/rating-v2";
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/admin-auth", () => ({ assertServerActorRole: vi.fn() }));
vi.mock("@/features/achievements", () => ({ syncPlayerAchievements: vi.fn() }));
vi.mock("@/lib/google-sheets", () => ({ readSpreadsheetTabValues: vi.fn(), batchUpdateSpreadsheetValues: vi.fn() }));
const { planKnockoutCorrection: plan, LEGACY_KO_MESSAGE } = await import("@/features/completed-tournament-knockout-correction");
const t = { id: "t", status: "completed", kind: "free", tournamentType: "bounty", googleSheetTabName: null, isFinal: false, ratingFormulaVersion: "v2" };
function row(overrides: Partial<typeof results.$inferSelect> = {}): typeof results.$inferSelect {
  return { id:"r", playerId:"p", tournamentId:"t", seasonId:null, place:1, reentries:3, knockouts:2, bossKnockouts:0, addons:2, freeReentries:1, clubDiscountPercent:20, mysteryBountyPoints:0, arrived:true, participationPoints:2, knockoutPoints:10, bossBountyPoints:0, itmPoints:100, ratingPoints:112, createdAt:new Date("2026-10-01"), ...overrides };
}
describe("frozen KO-only delta planning", () => {
  it("2→4 adds ten, winner and ITM are unchanged", () => { const r=row(); const before={...r}; expect(plan(t,r,4,0)).toMatchObject({ratingPoints:122,knockoutPoints:20}); expect(r).toEqual(before); });
  it("4→1 removes fifteen", () => { expect(plan(t,row({knockouts:4,knockoutPoints:20,ratingPoints:122}),1,0).ratingPoints).toBe(107); });
  it("Boss KO is independent", () => { expect(plan({...t,tournamentType:"boss_bounty"},row({bossKnockouts:2,bossBountyPoints:20,ratingPoints:132}),2,5)).toMatchObject({knockouts:2,knockoutPoints:10,bossBountyPoints:50,ratingPoints:162}); });
  it.each([-1,1.5,NaN,Infinity,2147483648])("rejects invalid KO %s", value => { expect(()=>plan(t,row(),value,0)).toThrow(); });
  it("rejects integer overflow in resulting rating", () => { expect(()=>plan(t,row(),2147483647,0)).toThrow("диапазон"); });
  it("rejects Boss KO on ordinary Bounty", () => { expect(()=>plan(t,row(),2,1)).toThrow("Boss KO"); });
  it.each(["open","draft","closed"])("rejects %s tournament", status => { expect(()=>plan({...t,status},row(),4,0)).toThrow("завершённом"); });
  it.each(["classic","mystery_bounty","phoenix"])("rejects %s format", tournamentType => { expect(()=>plan({...t,tournamentType},row(),4,0)).toThrow("Bounty"); });
  it("preserves NULL ITM and participation when old KO contributions are known", () => {
    expect(plan(t,row({participationPoints:null,itmPoints:null}),4,0)).toMatchObject({ratingPoints:122,knockoutPoints:20});
  });
  it("uniquely proves a NULL KO component using all known frozen components", () => { expect(plan(t,row({knockoutPoints:null}),4,0)).toMatchObject({ratingPoints:122,knockoutPoints:20}); });
  it("rejects ambiguous NULL reconstruction", () => { expect(()=>plan(t,row({knockoutPoints:null,itmPoints:null}),4,0)).toThrow(LEGACY_KO_MESSAGE); });
  it("rejects a historical residual that contradicts KO arithmetic", () => { expect(()=>plan(t,row({knockoutPoints:null,ratingPoints:111}),4,0)).toThrow(LEGACY_KO_MESSAGE); });
  it("rejects inconsistent existing KO components", () => { expect(()=>plan(t,row({knockoutPoints:20}),4,0)).toThrow(LEGACY_KO_MESSAGE); });
  it("rejects unknown attendance instead of guessing historical eligibility", () => { expect(()=>plan(t,row({arrived:null}),4,0)).toThrow(LEGACY_KO_MESSAGE); });
  it("does not grant rating for a non-arrived player", () => { expect(plan(t,row({arrived:false,participationPoints:0,itmPoints:0,knockoutPoints:0,ratingPoints:0}),4,0)).toMatchObject({ratingPoints:0,knockoutPoints:0,knockouts:4}); });
  it("does not grant rating for Final Month", () => { expect(plan({...t,isFinal:true},row({participationPoints:0,itmPoints:0,knockoutPoints:0,ratingPoints:0}),4,0)).toMatchObject({ratingPoints:0,knockoutPoints:0}); });
  it.each(["bounty","boss_bounty"] as const)("matches legacy and v2 engine KO delta for %s without invoking a full recalculation in correction", type => {
    for (const version of ["legacy","v2"] as const) {
      const before = {player_id:"p",place:1,knockouts:2,boss_knockouts:0,arrived:true,entries:3,addons:2};
      const engine = (ko:number,boss:number) => version === "legacy" ? calculateRatingPoints([{...before,knockouts:ko,boss_knockouts:boss}],type)[0] : calculateRatingPointsForTournament([{...before,knockouts:ko,boss_knockouts:boss}],type,version).results[0];
      const old=engine(2,0), next=engine(4,type==="boss_bounty"?2:0);
      const actual=plan({...t,tournamentType:type,ratingFormulaVersion:version},row({participationPoints:old.participation_points,itmPoints:old.itm_points,ratingPoints:old.rating_points,knockoutPoints:old.knockout_points,bossBountyPoints:old.boss_bounty_points}),4,type==="boss_bounty"?2:0);
      expect(actual.ratingPoints).toBe(next.rating_points);
    }
  });
});
