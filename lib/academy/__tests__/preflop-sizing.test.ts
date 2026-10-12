import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACADEMY_MTT_REFERENCE_IMPORTS } from "@/config/academy/mtt-reference-datasets";
import { getAcademyPreflopRange } from "@/config/academy/preflop-ranges";
import {
  ACADEMY_HRC_RFI_100BB_SIZING_PROFILE,
  ACADEMY_MTT_REFERENCE_SIZING_PROFILES,
  getAcademyPreflopSizingProfile,
} from "@/config/academy/preflop-sizing-profiles";
import { getAcademySolverDataset } from "@/config/academy/solver-datasets";
import {
  buildPreflopTableMoney,
  buildPreflopTablePot,
  formatSizingBb,
  isInPositionPostflop,
  resolveAnteSemantics,
  resolvePreflopHandState,
  resolveRaiseToBb,
  sizePreflopAction,
  withHeroAllIn,
  type AcademyPreflopSizingProfile,
} from "@/lib/academy/preflop-sizing";
import {
  getPreflopTrainerPublicActions,
  listAcademyPreflopTrainerSpots,
  requireAcademyPreflopTrainerSpotByStack,
  toPublicPreflopTrainerSpot,
} from "@/lib/academy/preflop-trainer";
import type { AcademyPreflopTrainerSituation, AcademyStrategyAssumptions } from "@/types/academy";

const MTT = ACADEMY_MTT_REFERENCE_SIZING_PROFILES;

function state(profile: AcademyPreflopSizingProfile, situation: AcademyPreflopTrainerSituation, heroSeat: string, villainSeat?: string) {
  const resolved = resolvePreflopHandState({ profile, stackBb: profile.stackBb, situation, heroSeat, ...(villainSeat ? { villainSeat } : {}) });
  if (!resolved) throw new Error("expected a resolved state");
  return resolved;
}

const raise = { code: "RAISE", kind: "RAISE" } as const;
const call = { code: "CALL", kind: "CALL" } as const;
const allIn = { code: "ALL_IN", kind: "ALL_IN" } as const;

function publicSpot(stackBb: number, nodeKey: string) {
  return requireAcademyPreflopTrainerSpotByStack(stackBb, nodeKey);
}

// ---------------------------------------------------------------------------
// (1) profiles == documented source assumptions
// ---------------------------------------------------------------------------

describe("(1) typed sizing profiles match the documented source assumptions exactly", () => {
  it("MTT 5 / 10 / 20 / 40 / 100 BB", () => {
    const allInRule = { kind: "ALL_IN" };
    expect(MTT[5]).toEqual({ stackBb: 5, levels: { OPEN: allInRule, THREE_BET: allInRule, FOUR_BET: allInRule, FIVE_BET: allInRule } });
    expect(MTT[10]).toEqual({ stackBb: 10, levels: { OPEN: allInRule, THREE_BET: allInRule, FOUR_BET: allInRule, FIVE_BET: allInRule } });
    expect(MTT[20]).toEqual({
      stackBb: 20,
      levels: { OPEN: { kind: "FIXED_OPEN", openBb: 2, sbOpenBb: 3 }, THREE_BET: allInRule, FOUR_BET: allInRule, FIVE_BET: allInRule },
    });
    expect(MTT[40]).toEqual({
      stackBb: 40,
      levels: {
        OPEN: { kind: "FIXED_OPEN", openBb: 2.3, sbOpenBb: 3.5 },
        THREE_BET: { kind: "MULTIPLIER", ipMultiplier: 3, oopMultiplier: 4, maxIpBb: 9, maxOopBb: 10 },
        FOUR_BET: allInRule,
        FIVE_BET: allInRule,
      },
    });
    expect(MTT[100]).toEqual({
      stackBb: 100,
      levels: {
        OPEN: { kind: "FIXED_OPEN", openBb: 2.3, sbOpenBb: 4 },
        THREE_BET: { kind: "MULTIPLIER", ipMultiplier: 3.5, oopMultiplier: 4.5 },
        FOUR_BET: { kind: "MULTIPLIER", ipMultiplier: 2.2, oopMultiplier: 2.5 },
        FIVE_BET: allInRule,
      },
    });
  });

  it("the existing descriptive provenance strings are untouched and agree with the typed profiles", () => {
    const assumptions = (stack: 5 | 10 | 20 | 40 | 100) => ACADEMY_MTT_REFERENCE_IMPORTS[stack].dataset.assumptions;
    expect(assumptions(5)).toMatchObject({ openSizing: "5 BB (shove)", threeBetSizing: "all-in", fourBetSizing: "all-in", fiveBetSizing: "all-in", anteBb: 1 });
    expect(assumptions(10)).toMatchObject({ openSizing: "10 BB (shove)", threeBetSizing: "all-in", fourBetSizing: "all-in", fiveBetSizing: "all-in" });
    expect(assumptions(20)).toMatchObject({ openSizing: "2 BB (SB 3 BB)", threeBetSizing: "all-in", fourBetSizing: "all-in", fiveBetSizing: "all-in" });
    expect(assumptions(40)).toMatchObject({
      openSizing: "2.3 BB (SB 3.5 BB)",
      threeBetSizing: "3x IP / 4x OOP of the open, max 9 BB IP / 10 BB OOP",
      fourBetSizing: "all-in",
      fiveBetSizing: "all-in",
    });
    expect(assumptions(100)).toMatchObject({
      openSizing: "2.3 BB (SB 4 BB)",
      threeBetSizing: "3.5x IP / 4.5x OOP of the open",
      fourBetSizing: "2.2x IP / 2.5x OOP of the 3-bet",
      fiveBetSizing: "all-in",
    });
    for (const stack of [5, 10, 20, 40, 100] as const) {
      expect(MTT[stack].stackBb).toBe(ACADEMY_MTT_REFERENCE_IMPORTS[stack].dataset.metadata.effectiveStackBb);
    }
  });

  it("(10) HRC 100 BB RFI open = 2.25 BB, REUSED from the stored range assumptions (no duplicated constant)", () => {
    const open = ACADEMY_HRC_RFI_100BB_SIZING_PROFILE.levels.OPEN;
    expect(open).toEqual({ kind: "FIXED_OPEN", openBb: 2.25 });
    expect(open && open.kind === "FIXED_OPEN" ? open.openBb : null).toBe(getAcademyPreflopRange("UTG").assumptions.openSizeBb);
    expect(getAcademySolverDataset().assumptions.openSizeBb).toBe(2.25);
    expect(ACADEMY_HRC_RFI_100BB_SIZING_PROFILE.levels.THREE_BET).toBeUndefined();
    // By construction: the profile file reads the value, it never spells it out.
    const source = readFileSync(path.resolve(__dirname, "../../../config/academy/preflop-sizing-profiles.ts"), "utf8");
    expect(source).not.toMatch(/2\.25/);
    expect(source).toContain('getAcademyPreflopRange("UTG").assumptions.openSizeBb');
    const hrcState = state(ACADEMY_HRC_RFI_100BB_SIZING_PROFILE, "RFI", "CO");
    expect(sizePreflopAction(raise, "Рейз", hrcState)?.button).toBe("Рейз до 2.25 BB");
  });

  it("profile lookup is by dataset id; unknown datasets have no profile", () => {
    expect(getAcademyPreflopSizingProfile(ACADEMY_MTT_REFERENCE_IMPORTS[40].dataset.id)).toBe(MTT[40]);
    expect(getAcademyPreflopSizingProfile("holdemmath_pushfold_9max_10bb_ante10_v1")).toBeUndefined();
    expect(getAcademyPreflopSizingProfile("__proto__")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (2)-(9) resolver
// ---------------------------------------------------------------------------

describe("(2)(3) 20 BB opens", () => {
  it("non-SB opens to 2 BB, SB opens to 3 BB (total size)", () => {
    for (const seat of ["UTG", "HJ", "CO", "BTN"]) {
      expect(state(MTT[20], "RFI", seat).heroRaise).toEqual({ totalBb: 2, allIn: false });
    }
    expect(state(MTT[20], "RFI", "SB").heroRaise).toEqual({ totalBb: 3, allIn: false });
    expect(sizePreflopAction(raise, "Рейз", state(MTT[20], "RFI", "HJ"))?.button).toBe("Рейз до 2 BB");
    expect(sizePreflopAction(raise, "Рейз", state(MTT[20], "RFI", "SB"))?.button).toBe("Рейз до 3 BB");
  });
});

describe("(4) 20 BB 3-bet is a flat all-in", () => {
  it("villain SB 3-bets HJ's 2 BB open all-in for 20 BB; no multiplier", () => {
    const s = state(MTT[20], "FACING_3BET", "HJ", "SB");
    expect(s.steps).toEqual([
      { actor: "HERO", seat: "HJ", level: "OPEN", totalBb: 2, allIn: false },
      { actor: "VILLAIN", seat: "SB", level: "THREE_BET", totalBb: 20, allIn: true },
    ]);
    const facingOpen = state(MTT[20], "FACING_OPEN", "BB", "BTN");
    expect(facingOpen.heroRaise).toEqual({ totalBb: 20, allIn: true });
    expect(sizePreflopAction(allIn, "Олл-ин 20 BB", facingOpen)?.button).toBe("Олл-ин 20 BB");
  });
});

describe("(5)(6)(7) 40 BB 3-bets: IP 3×, OOP 4×, capped at 9 IP / 10 OOP", () => {
  it("IP/OOP comes from postflop seat order (blinds act first)", () => {
    expect(isInPositionPostflop("BTN", "HJ")).toBe(true);
    expect(isInPositionPostflop("BB", "BTN")).toBe(false);
    expect(isInPositionPostflop("SB", "CO")).toBe(false);
    expect(isInPositionPostflop("BB", "SB")).toBe(true);
  });

  it("HJ opens 2.3 → BTN (IP) 3-bets 3× = 6.9 BB", () => {
    const s = state(MTT[40], "FACING_OPEN", "BTN", "HJ");
    expect(s.heroRaise).toEqual({ totalBb: 6.9, allIn: false });
    expect(sizePreflopAction(raise, "3-бет", s)?.button).toBe("3-бет до 6.9 BB");
  });

  it("BTN opens 2.3 → BB (OOP) 3-bets 4× = 9.2 BB", () => {
    const s = state(MTT[40], "FACING_OPEN", "BB", "BTN");
    expect(s.heroRaise).toEqual({ totalBb: 9.2, allIn: false });
    expect(sizePreflopAction(raise, "3-бет", s)?.button).toBe("3-бет до 9.2 BB");
  });

  it("IP cap: SB opens 3.5 → BB (IP vs SB) 3× = 10.5 would exceed 9 → 3-bet to 9 BB", () => {
    expect(state(MTT[40], "FACING_OPEN", "BB", "SB").heroRaise).toEqual({ totalBb: 9, allIn: false });
    const rule = MTT[40].levels.THREE_BET!;
    expect(resolveRaiseToBb({ rule, seat: "BB", opponent: "SB", previousTotalBb: 3.5, stackBb: 40 })).toBe(9);
  });

  it("OOP cap: a 3 BB open × 4 = 12 would exceed 10 → 10 BB (without the cap it would be 12)", () => {
    const rule = MTT[40].levels.THREE_BET!;
    expect(resolveRaiseToBb({ rule, seat: "SB", opponent: "BTN", previousTotalBb: 3, stackBb: 40 })).toBe(10);
    const uncapped = { kind: "MULTIPLIER", ipMultiplier: 3, oopMultiplier: 4 } as const;
    expect(resolveRaiseToBb({ rule: uncapped, seat: "SB", opponent: "BTN", previousTotalBb: 3, stackBb: 40 })).toBe(12);
  });

  it("40 BB 4-bet is all-in", () => {
    expect(state(MTT[40], "FACING_3BET", "CO", "BTN").heroRaise).toEqual({ totalBb: 40, allIn: true });
  });
});

describe("(8)(9) 100 BB multipliers", () => {
  it("open 2.3 → OOP 3-bet 4.5× = 10.35 (shown 10.4); IP 3-bet 3.5× = 8.05", () => {
    const oop = state(MTT[100], "FACING_OPEN", "BB", "BTN");
    expect(oop.heroRaise).toEqual({ totalBb: 10.35, allIn: false });
    expect(sizePreflopAction(raise, "3-бет", oop)?.button).toBe("3-бет до 10.4 BB");
    const ip = state(MTT[100], "FACING_OPEN", "BTN", "CO");
    expect(ip.heroRaise).toEqual({ totalBb: 8.05, allIn: false });
    expect(sizePreflopAction(raise, "3-бет", ip)?.button).toBe("3-бет до 8.05 BB");
  });

  it("4-bet: 2.5× the 3-bet OOP, 2.2× IP (exact, no float drift)", () => {
    // CO opens 2.3, BTN (IP) 3-bets 8.05, CO (OOP) 4-bets 2.5 × 8.05 = 20.125.
    const oop = state(MTT[100], "FACING_3BET", "CO", "BTN");
    expect(oop.heroRaise).toEqual({ totalBb: 20.125, allIn: false });
    expect(sizePreflopAction(raise, "4-бет", oop)?.button).toBe("4-бет до 20.1 BB");
    // BTN opens 2.3, BB (OOP) 3-bets 10.35, BTN (IP) 4-bets 2.2 × 10.35 = 22.77.
    const ip = state(MTT[100], "FACING_3BET", "BTN", "BB");
    expect(ip.heroRaise).toEqual({ totalBb: 22.77, allIn: false });
    expect(sizePreflopAction(raise, "4-бет", ip)?.button).toBe("4-бет до 22.8 BB");
  });

  it("100 BB 5-bet is all-in", () => {
    expect(state(MTT[100], "FACING_4BET", "BTN", "CO").heroRaise).toEqual({ totalBb: 100, allIn: true });
  });
});

describe("display rounding (only at format time)", () => {
  it("< 10 BB up to 2 decimals, ≥ 10 BB up to 1 decimal, trailing zeros trimmed, half-up", () => {
    expect([2, 2.25, 2.3, 6.9, 8.05, 9.2, 10.35, 20.125, 22.77, 20, 0.5].map(formatSizingBb))
      .toEqual(["2", "2.25", "2.3", "6.9", "8.05", "9.2", "10.4", "20.1", "22.8", "20", "0.5"]);
  });
});

// ---------------------------------------------------------------------------
// (11)-(15) stacks / call / blinds
// ---------------------------------------------------------------------------

describe("(11)(12)(13)(14) starting / committed / remaining stacks and the call amount", () => {
  it("(11) all-in: villain committed = full starting stack, remaining 0; hero all-in after the reveal", () => {
    const s = state(MTT[20], "FACING_3BET", "HJ", "SB");
    expect(s.villainCommittedBb).toBe(20);
    expect(s.villainRemainingBb).toBe(0);
    const money = buildPreflopTableMoney(s, { kind: "NONE" });
    expect(money.seats.find((seat) => seat.seat === "SB")).toEqual({ seat: "SB", committedBb: 20, blind: "SB", allIn: true, remainingBb: 0 });
    const heroAllIn = withHeroAllIn(money, "HJ");
    expect(heroAllIn.seats.find((seat) => seat.seat === "HJ")).toEqual({ seat: "HJ", committedBb: 20, allIn: true, remainingBb: 0 });
    expect(heroAllIn.pot).toEqual({ kind: "EXACT", totalBb: 41, anteTotalBb: 0 });
    expect(heroAllIn.toCallBb).toBeUndefined();
  });

  it("worked example: 20 BB, hero opens to 2 → committed 2 / remaining 18; villain jams 20 → committed 20 / remaining 0", () => {
    const s = state(MTT[20], "FACING_3BET", "HJ", "SB");
    expect([s.stackBb, s.heroCommittedBb, s.heroRemainingBb, s.villainCommittedBb, s.villainRemainingBb]).toEqual([20, 2, 18, 20, 0]);
    expect(s.toCallBb).toBe(18);
    expect(sizePreflopAction(call, "Колл", s)).toEqual({ kind: "CALL", totalBb: 20, toCallBb: 18, button: "Колл 18 BB" });
  });

  it("(12) hero: 40 BB CO opens 2.3, faces BTN's 6.9 3-bet → committed 2.3, remaining 37.7, call 4.6", () => {
    const s = state(MTT[40], "FACING_3BET", "CO", "BTN");
    expect([s.heroCommittedBb, s.heroRemainingBb]).toEqual([2.3, 37.7]);
    expect([s.villainCommittedBb, s.villainRemainingBb]).toEqual([6.9, 33.1]);
    expect(s.toCallBb).toBe(4.6);
    expect(sizePreflopAction(call, "Колл", s)?.button).toBe("Колл 4.6 BB");
  });

  it("(13) villain: 100 BB CO opens 2.3, hero BTN 3-bets 8.05, CO 4-bets 20.125 → villain committed 20.125, remaining 79.875", () => {
    const s = state(MTT[100], "FACING_4BET", "BTN", "CO");
    expect(s.steps.map((step) => [step.seat, step.totalBb])).toEqual([["CO", 2.3], ["BTN", 8.05], ["CO", 20.125]]);
    expect([s.villainCommittedBb, s.villainRemainingBb]).toEqual([20.125, 79.875]);
    expect([s.heroCommittedBb, s.heroRemainingBb]).toEqual([8.05, 91.95]);
    expect(s.toCallBb).toBe(12.075);
  });

  it("(14) call = villain's total bet − hero's committed (BB vs BTN 2.3 open at 40 BB → 1.3)", () => {
    const s = state(MTT[40], "FACING_OPEN", "BB", "BTN");
    expect(s.toCallBb).toBe(1.3);
    expect(sizePreflopAction(call, "Колл", s)?.button).toBe("Колл 1.3 BB");
    // A limp is never sized; neither is a call when nothing has been raised.
    expect(sizePreflopAction({ code: "LIMP", kind: "CALL" }, "Лимп", state(MTT[100], "RFI", "SB"))).toBeUndefined();
  });

  it("(15) forced blinds: SB 0.5 / BB 1 committed even when they are not in the hand", () => {
    const money = buildPreflopTableMoney(state(MTT[40], "RFI", "UTG"), { kind: "NONE" });
    expect(money.seats).toEqual([
      { seat: "UTG", committedBb: 0, allIn: false, remainingBb: 40 },
      { seat: "SB", committedBb: 0.5, blind: "SB", allIn: false },
      { seat: "BB", committedBb: 1, blind: "BB", allIn: false },
    ]);
    // Hero in the BB facing an open: blind counts towards the call.
    const bb = buildPreflopTableMoney(state(MTT[40], "FACING_OPEN", "BB", "BTN"), { kind: "NONE" });
    expect(bb.seats.find((seat) => seat.seat === "BB")).toEqual({ seat: "BB", committedBb: 1, blind: "BB", allIn: false, remainingBb: 39 });
    expect(bb.toCallBb).toBe(1.3);
  });

  it("stacks shown never differ from the dataset's effective stack: a mismatched profile yields nothing", () => {
    expect(resolvePreflopHandState({ profile: MTT[40], stackBb: 20, situation: "RFI", heroSeat: "CO" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (16)(17) pot + ante policy
// ---------------------------------------------------------------------------

describe("(16)(17) pot uses trusted inputs only; an ambiguous ante is never folded into a total", () => {
  it("(16) explicit per-player ante (HRC: 0.1 × 9 = 0.9) → exact pot = blinds + bets + antes", () => {
    const ante = resolveAnteSemantics(getAcademyPreflopRange("UTG").assumptions, 9);
    expect(ante).toEqual({ kind: "PER_PLAYER", perPlayerBb: 0.1, totalBb: 0.9 });
    const money = buildPreflopTableMoney(state(MTT[40], "FACING_OPEN", "BB", "BTN"), ante);
    expect(money.pot).toEqual({ kind: "EXACT", totalBb: 4.7, anteTotalBb: 0.9 }); // 2.3 + 0.5 + 1 + 0.9
    expect(buildPreflopTablePot(3.8, { kind: "NONE" })).toEqual({ kind: "EXACT", totalBb: 3.8, anteTotalBb: 0 });
  });

  it("(17) ambiguous ante fixtures → known contributions + a separate note, never an exact total", () => {
    const fixtures: Array<{ assumptions: AcademyStrategyAssumptions; note: string }> = [
      { assumptions: { anteBb: 1 }, note: "Анте 1 BB · формат не указан" },
      { assumptions: { antePerPlayerBb: 0.1, anteTotalBb: 1 }, note: "Анте 0.1 BB · формат не указан" },
      { assumptions: {}, note: "Анте · источник не уточняет" },
    ];
    for (const { assumptions, note } of fixtures) {
      const ante = resolveAnteSemantics(assumptions, 9);
      expect(ante.kind).toBe("AMBIGUOUS");
      const pot = buildPreflopTableMoney(state(MTT[40], "FACING_OPEN", "BB", "BTN"), ante).pot;
      expect(pot).toEqual({ kind: "WITHOUT_ANTE", knownBb: 3.8, anteNote: note });
      expect(pot).not.toHaveProperty("totalBb");
    }
  });

  it("the MTT reference sets' documented '1 BB ante' is AMBIGUOUS → every MTT spot shows the pot without ante", () => {
    for (const stack of [5, 10, 20, 40, 100] as const) {
      expect(resolveAnteSemantics(ACADEMY_MTT_REFERENCE_IMPORTS[stack].dataset.assumptions, 9)).toEqual({ kind: "AMBIGUOUS", declaredBb: 1 });
    }
    const spots = listAcademyPreflopTrainerSpots();
    for (const spot of spots) {
      const table = toPublicPreflopTrainerSpot(spot).table;
      expect(table, spot.nodeKey).toBeDefined();
      expect(table!.pot.kind).toBe("WITHOUT_ANTE");
      expect(table!.startingStackBb).toBe(spot.stackBb);
    }
    const jam = toPublicPreflopTrainerSpot(publicSpot(20, "FACING_3BET_HJ_VS_SB").spot).table!;
    expect(jam.pot).toEqual({ kind: "WITHOUT_ANTE", knownBb: 23, anteNote: "Анте 1 BB · формат не указан" });
    expect(jam.toCallBb).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// wiring: public actions / history (no scoring inputs touched)
// ---------------------------------------------------------------------------

describe("public actions + history carry trusted sizing only", () => {
  it("20 BB HJ facing SB's all-in: Колл 18 BB; history with sizes", () => {
    const resolved = publicSpot(20, "FACING_3BET_HJ_VS_SB");
    const actions = getPreflopTrainerPublicActions(resolved);
    expect(actions.find((action) => action.code === "CALL")?.sizing?.button).toBe("Колл 18 BB");
    expect(actions.find((action) => action.code === "FOLD")?.sizing).toBeUndefined();
    expect(toPublicPreflopTrainerSpot(resolved.spot).history).toBe("Ты открыл до 2 BB с HJ — SB пошёл олл-ин 20 BB");
  });

  it("history examples (facing open / 4-bet / 5-bet); RFI keeps its plain line", () => {
    const history = (stack: number, key: string) => toPublicPreflopTrainerSpot(publicSpot(stack, key).spot).history;
    expect(history(40, "FACING_OPEN_BB_VS_BTN")).toBe("BTN открыл до 2.3 BB — ты на BB");
    expect(history(100, "FACING_4BET_BTN_VS_CO")).toBe("CO открыл до 2.3 BB — ты сделал 3-бет до 8.05 BB с BTN — CO сделал 4-бет до 20.1 BB");
    expect(history(40, "RFI_CO")).toBe("До тебя все сбросили — ты на CO");
    const fiveBet = listAcademyPreflopTrainerSpots().find((spot) => spot.situation === "FACING_5BET");
    if (fiveBet) expect(toPublicPreflopTrainerSpot(fiveBet).history).toMatch(/^Ты открыл до .* — .* 3-бет до .* — ты 4-бет до .* — .* пошёл олл-ин 100 BB$/);
  });

  it("action codes / kinds / order are exactly the node's (sizing is display-only)", () => {
    for (const spot of listAcademyPreflopTrainerSpots()) {
      const resolved = publicSpot(spot.stackBb, spot.nodeKey);
      expect(getPreflopTrainerPublicActions(resolved).map((action) => action.code)).toEqual([...resolved.node.actionCodes]);
    }
  });

  it("an undocumented level is never sized (generic label fallback)", () => {
    const partial: AcademyPreflopSizingProfile = { stackBb: 40, levels: { OPEN: { kind: "FIXED_OPEN", openBb: 2.3 } } };
    // SB open size undocumented → no SB open size.
    expect(state(partial, "RFI", "SB").heroRaise).toBeUndefined();
    // 3-bet undocumented → hero's 3-bet unsized; facing a 3-bet the whole state is unknown.
    const facingOpen = state(partial, "FACING_OPEN", "BB", "BTN");
    expect(sizePreflopAction(raise, "3-бет", facingOpen)).toBeUndefined();
    expect(sizePreflopAction(call, "Колл", facingOpen)?.button).toBe("Колл 1.3 BB");
    expect(resolvePreflopHandState({ profile: partial, stackBb: 40, situation: "FACING_3BET", heroSeat: "CO", villainSeat: "BTN" })).toBeNull();
    expect(sizePreflopAction(raise, "3-бет", null)).toBeUndefined();
    expect(resolvePreflopHandState({ profile: undefined, stackBb: 40, situation: "RFI", heroSeat: "CO" })).toBeNull();
  });
});
