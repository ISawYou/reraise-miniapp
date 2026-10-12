/**
 * "Новичкам · Шаг 2" lessons are bound to REAL registered nodes, and every
 * number / data-dependent sentence in their copy comes from the live sizing
 * resolver and the live node — asserted here against the registry itself,
 * never against literals copied from the lesson.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePreflopTrainerRouteSpot } from "@/app/academy/solver/preflop/[stack]/[node]/params";
import { ACADEMY_BEGINNER_AFTER_OPEN_LESSONS, getBeginnerAfterOpenLesson } from "@/config/academy/beginner-after-open";
import { getAcademyPreflopSizingProfile } from "@/config/academy/preflop-sizing-profiles";
import { preflopTrainerSpotRoute, preflopTrainerTrainRoute } from "@/config/academy/preflop-trainer";
import { getBeginnerAfterOpenLessonView } from "@/lib/academy/beginner-after-open";
import { ACADEMY_HRC_SCENARIO_B_RFI_100BB_DATASET_ID } from "@/config/academy/solver-dataset-ids";
import { formatSizingBbLabel, isInPositionPostflop, resolvePreflopHandState } from "@/lib/academy/preflop-sizing";
import {
  buildAcademyPreflopTrainerSession,
  getPreflopTrainerSpotHandState,
  listAcademyPreflopTrainerSpots,
  requireAcademyPreflopTrainerSpotByStack,
  toPreflopTrainerReveal,
} from "@/lib/academy/preflop-trainer";
import { getAcademyStrategyDataset } from "@/config/academy/solver-datasets";
import type { AcademyStrategyNodeHands } from "@/types/academy";

const view = (slug: string) => getBeginnerAfterOpenLessonView(slug)!;

/** Live resolver output for a (stack, node), computed independently of the lesson module. */
function liveState(stackBb: number, nodeKey: string) {
  const { spot } = requireAcademyPreflopTrainerSpotByStack(stackBb, nodeKey);
  return resolvePreflopHandState({
    profile: getAcademyPreflopSizingProfile(spot.datasetId),
    stackBb: spot.stackBb,
    situation: spot.situation,
    heroSeat: spot.heroPosition,
    ...(spot.villainPosition ? { villainSeat: spot.villainPosition } : {}),
  })!;
}

/** Share of the 169 hand classes (unweighted) per action code. */
function shares(hands: AcademyStrategyNodeHands): Record<string, number> {
  const out: Record<string, number> = {};
  for (const frequencies of Object.values(hands)) {
    for (const [code, value] of Object.entries(frequencies)) out[code] = (out[code] ?? 0) + value / 169;
  }
  return out;
}

const text = (slug: string) => view(slug).paragraphs.join(" ");
const fact = (slug: string, code: string) => view(slug).facts.find((entry) => entry.code === code)?.value;

describe("every lesson is bound to a real, validated registry node", () => {
  it.each(ACADEMY_BEGINNER_AFTER_OPEN_LESSONS.map((lesson) => [lesson.slug, lesson] as const))("%s", (_slug, lesson) => {
    for (const ref of [lesson.spot, ...(lesson.compareSpot ? [lesson.compareSpot] : [])]) {
      const registered = listAcademyPreflopTrainerSpots().find((spot) => spot.stackBb === ref.stackBb && spot.nodeKey === ref.nodeKey);
      expect(registered, `${ref.stackBb}/${ref.nodeKey}`).toBeDefined();
      const dataset = getAcademyStrategyDataset(registered!.datasetId);
      expect(Object.prototype.hasOwnProperty.call(dataset.nodes, ref.nodeKey)).toBe(true);
      // Real frequencies: 169 hands, each summing to 1.
      const hands = dataset.nodes[ref.nodeKey].hands;
      expect(Object.keys(hands)).toHaveLength(169);
      for (const frequencies of Object.values(hands)) {
        expect(Object.values(frequencies).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6);
      }
      // A sizing profile exists for that dataset and resolves this node.
      expect(getAcademyPreflopSizingProfile(registered!.datasetId)).toBeDefined();
      expect(getPreflopTrainerSpotHandState(registered!)).not.toBeNull();
    }
    expect(getBeginnerAfterOpenLesson(lesson.slug)).toBe(lesson);
  });

  it("no lesson is about the BB opening an unopened pot (no such node exists)", () => {
    expect(listAcademyPreflopTrainerSpots().some((spot) => spot.situation === "RFI" && spot.heroPosition === "BB")).toBe(false);
    for (const lesson of ACADEMY_BEGINNER_AFTER_OPEN_LESSONS) {
      expect(lesson.spot.nodeKey).not.toBe("RFI_BB");
    }
  });
});

describe("SB first-in", () => {
  const lesson = getBeginnerAfterOpenLesson("sb-first-in")!;
  const resolved = requireAcademyPreflopTrainerSpotByStack(lesson.spot.stackBb, lesson.spot.nodeKey);

  it("hero SB, first in, everyone before folded, BB still active, forced blinds in", () => {
    expect(resolved.spot).toMatchObject({ situation: "RFI", heroPosition: "SB" });
    const v = view("sb-first-in");
    const seats = Object.fromEntries(v.main.spot.scene.seats.map((seat) => [seat.seat, seat.role]));
    for (const seat of ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN"]) expect(seats[seat], seat).toBe("folded");
    expect(seats.SB).toBe("hero");
    expect(seats.BB).not.toBe("folded");
    const money = v.main.spot.table!;
    expect(money.seats.find((seat) => seat.seat === "SB")).toMatchObject({ committedBb: 0.5, blind: "SB" });
    expect(money.seats.find((seat) => seat.seat === "BB")).toMatchObject({ committedBb: 1, blind: "BB" });
    expect(fact("sb-first-in", "HERO_STACK")).toBe(formatSizingBbLabel(liveState(40, "RFI_SB").heroRemainingBb));
  });

  it("the open size shown is the live resolver's SB open — and only because the profile documents one", () => {
    const state = liveState(lesson.spot.stackBb, lesson.spot.nodeKey);
    expect(state.heroRaise).toBeDefined();
    expect(fact("sb-first-in", "HERO_RAISE")).toBe(formatSizingBbLabel(state.heroRaise!.totalBb));
    expect(text("sb-first-in")).toContain(`рейзом до ${formatSizingBbLabel(state.heroRaise!.totalBb)}`);
    // HRC 100bb documents no SB open size: the resolver must give no SB raise there.
    const hrc = getAcademyPreflopSizingProfile(ACADEMY_HRC_SCENARIO_B_RFI_100BB_DATASET_ID)!;
    expect(hrc).toBeDefined();
    expect(resolvePreflopHandState({ profile: hrc, stackBb: hrc.stackBb, situation: "RFI", heroSeat: "SB" })?.heroRaise).toBeUndefined();
  });

  it("limp is taught IFF the real node offers a LIMP action", () => {
    const realHasLimp = resolved.node.actionCodes.includes("LIMP");
    const v = view("sb-first-in");
    expect(v.hasLimp).toBe(realHasLimp);
    expect(v.main.actions.map((action) => action.code)).toEqual(resolved.node.actionCodes);
    if (realHasLimp) {
      expect(text("sb-first-in")).toContain("лимп используется");
      expect(v.terms).toContain("LIMP");
    } else {
      expect(text("sb-first-in")).toContain("только два действия: рейз или фолд");
      expect(text("sb-first-in")).not.toContain("лимп используется");
      expect(v.terms).not.toContain("LIMP");
    }
  });

  it("the limp branch really is data-driven: the 20 / 100 BB RFI_SB nodes DO have LIMP, 40 BB does not", () => {
    expect(requireAcademyPreflopTrainerSpotByStack(20, "RFI_SB").node.actionCodes).toContain("LIMP");
    expect(requireAcademyPreflopTrainerSpotByStack(100, "RFI_SB").node.actionCodes).toContain("LIMP");
    expect(requireAcademyPreflopTrainerSpotByStack(40, "RFI_SB").node.actionCodes).not.toContain("LIMP");
  });
});

describe("BB defence", () => {
  const lesson = getBeginnerAfterOpenLesson("bb-defence")!;

  it("real BB-vs-opener node with fold / call / 3-bet", () => {
    const { spot, node } = requireAcademyPreflopTrainerSpotByStack(lesson.spot.stackBb, lesson.spot.nodeKey);
    expect(spot).toMatchObject({ situation: "FACING_OPEN", heroPosition: "BB", villainPosition: "BTN" });
    expect([...node.actionCodes].sort()).toEqual(["CALL", "FOLD", "RAISE"]);
  });

  it("forced 1 BB, opener size, call amount and 3-bet size all equal the live resolver", () => {
    const state = liveState(lesson.spot.stackBb, lesson.spot.nodeKey);
    expect(state.heroCommittedBb).toBe(1);
    expect(fact("bb-defence", "HERO_IN")).toBe(formatSizingBbLabel(1));
    expect(fact("bb-defence", "VILLAIN_BET")).toBe(formatSizingBbLabel(state.villainCommittedBb!));
    expect(fact("bb-defence", "TO_CALL")).toBe(formatSizingBbLabel(state.toCallBb));
    expect(fact("bb-defence", "HERO_RAISE")).toBe(formatSizingBbLabel(state.heroRaise!.totalBb));
    expect(text("bb-defence")).toContain(`доплатить всего ${formatSizingBbLabel(state.toCallBb)}`);
    expect(text("bb-defence")).toContain(`рейзом до ${formatSizingBbLabel(state.villainCommittedBb!)}`);
    expect(text("bb-defence")).toContain(`рейз до ${formatSizingBbLabel(state.heroRaise!.totalBb)}`);
    // Call button label from the trainer's own action sizing matches too.
    expect(view("bb-defence").main.actions.find((action) => action.code === "CALL")?.sizing?.toCallBb).toBe(state.toCallBb);
  });

  it("'tighter vs earlier positions' is true in the data (continue share vs BTN > vs UTG); prose gives no percentages", () => {
    const v = view("bb-defence");
    const vsBtn = shares(v.main.hands);
    const vsUtg = shares(v.compare!.hands);
    expect(v.compare!.spot.villainPosition).toBe("UTG");
    expect(1 - vsBtn.FOLD).toBeGreaterThan(1 - vsUtg.FOLD);
    expect(text("bb-defence")).not.toMatch(/\d+\s?%/);
  });
});

describe("SB vs open", () => {
  const lesson = getBeginnerAfterOpenLesson("sb-vs-open")!;

  it("real node: hero SB, villain the opener, BB still to act", () => {
    const { spot } = requireAcademyPreflopTrainerSpotByStack(lesson.spot.stackBb, lesson.spot.nodeKey);
    expect(spot).toMatchObject({ situation: "FACING_OPEN", heroPosition: "SB", villainPosition: "BTN" });
    const seats = Object.fromEntries(view("sb-vs-open").main.spot.scene.seats.map((seat) => [seat.seat, seat.role]));
    expect(seats.SB).toBe("hero");
    expect(seats.BTN).toBe("villain");
    expect(seats.BB).not.toBe("folded");
    expect(isInPositionPostflop("SB", "BTN")).toBe(false);
    expect(text("sb-vs-open")).toContain("без позиции");
  });

  it("forced blind money: SB 0.5 in, BB 1 dead/live blind, call = live resolver", () => {
    const state = liveState(lesson.spot.stackBb, lesson.spot.nodeKey);
    expect(state.committedBb).toMatchObject({ SB: 0.5, BB: 1 });
    expect(fact("sb-vs-open", "HERO_IN")).toBe(formatSizingBbLabel(0.5));
    expect(fact("sb-vs-open", "TO_CALL")).toBe(formatSizingBbLabel(state.toCallBb));
    expect(fact("sb-vs-open", "HERO_RAISE")).toBe(formatSizingBbLabel(state.heroRaise!.totalBb));
    const bb = liveState(40, "FACING_OPEN_BB_VS_BTN");
    expect(text("sb-vs-open")).toContain(`У BB колл стоит ${formatSizingBbLabel(bb.toCallBb)}, а у тебя — ${formatSizingBbLabel(state.toCallBb)}`);
  });

  it("'not the same as BB defence' claim holds in the data: SB folds more and calls less than BB vs the same opener", () => {
    const v = view("sb-vs-open");
    const sb = shares(v.main.hands);
    const bb = shares(v.compare!.hands);
    expect(v.compare!.spot.heroPosition).toBe("BB");
    expect(sb.FOLD).toBeGreaterThan(bb.FOLD);
    expect(sb.CALL).toBeLessThan(bb.CALL);
  });
});

describe("3-bet basics: prose numbers == live sizing resolver", () => {
  it("IP and OOP 3-bet sizes in the prose are exactly the resolver's output for the chosen nodes", () => {
    const lesson = getBeginnerAfterOpenLesson("three-bet")!;
    const ip = liveState(lesson.spot.stackBb, lesson.spot.nodeKey);
    const oop = liveState(lesson.compareSpot!.stackBb, lesson.compareSpot!.nodeKey);
    expect(isInPositionPostflop(ip.heroSeat, ip.villainSeat!)).toBe(true);
    expect(isInPositionPostflop(oop.heroSeat, oop.villainSeat!)).toBe(false);
    const prose = text("three-bet");
    expect(prose).toContain(`3-бет здесь — до ${formatSizingBbLabel(ip.heroRaise!.totalBb)}`);
    expect(prose).toContain(`открылся до ${formatSizingBbLabel(ip.villainCommittedBb!)}`);
    expect(prose).toContain(`— до ${formatSizingBbLabel(oop.heroRaise!.totalBb)}`);
    // Multipliers are derived from the same numbers (3× IP / 4× OOP of the open at 40 BB today).
    const times = (state: typeof ip) => Number((state.heroRaise!.totalBb / state.villainCommittedBb!).toFixed(2));
    expect(prose).toContain(`в ${times(ip)} раза больше открытия`);
    expect(prose).toContain(`в ${times(oop)} раза больше открытия`);
    expect(fact("three-bet", "HERO_RAISE")).toBe(formatSizingBbLabel(ip.heroRaise!.totalBb));
    // The OOP sentence only claims "bigger" because it IS bigger here.
    expect(oop.heroRaise!.totalBb).toBeGreaterThan(ip.heroRaise!.totalBb);
    expect(prose).toContain("Без позиции 3-бет делают крупнее");
  });

  it("the trainer's own 3-bet button carries the same size as the prose", () => {
    const v = view("three-bet");
    const raise = v.main.actions.find((action) => action.kind === "RAISE")!;
    expect(raise.sizing?.button).toBe(`3-бет до ${formatSizingBbLabel(liveState(40, "FACING_OPEN_BTN_VS_CO").heroRaise!.totalBb)}`);
  });
});

describe("facing a 3-bet", () => {
  const lesson = getBeginnerAfterOpenLesson("facing-three-bet")!;

  it("hero's open, villain's 3-bet, call amount and stacks equal the live resolver", () => {
    const state = liveState(lesson.spot.stackBb, lesson.spot.nodeKey);
    expect(state.situation).toBe("FACING_3BET");
    expect(fact("facing-three-bet", "HERO_IN")).toBe(formatSizingBbLabel(state.heroCommittedBb));
    expect(fact("facing-three-bet", "VILLAIN_BET")).toBe(formatSizingBbLabel(state.villainCommittedBb!));
    expect(fact("facing-three-bet", "TO_CALL")).toBe(formatSizingBbLabel(state.toCallBb));
    expect(fact("facing-three-bet", "HERO_STACK")).toBe(formatSizingBbLabel(state.heroRemainingBb));
    expect(state.toCallBb).toBeCloseTo(state.villainCommittedBb! - state.heroCommittedBb, 9);
    const money = view("facing-three-bet").main.spot.table!;
    expect(money.seats.find((seat) => seat.seat === state.heroSeat)?.committedBb).toBe(state.heroCommittedBb);
    expect(money.seats.find((seat) => seat.seat === state.villainSeat)?.committedBb).toBe(state.villainCommittedBb);
  });

  it("pot stays conservative: the ambiguous MTT ante is NOT added — 'без анте' + separate note", () => {
    const v = view("facing-three-bet");
    const dataset = getAcademyStrategyDataset(requireAcademyPreflopTrainerSpotByStack(40, lesson.spot.nodeKey).spot.datasetId);
    expect(dataset.assumptions.antePerPlayerBb).toBeUndefined();
    const pot = v.main.spot.table!.pot;
    expect(pot.kind).toBe("WITHOUT_ANTE");
    if (pot.kind === "WITHOUT_ANTE") {
      expect(pot.anteNote).toMatch(/Анте/);
      expect(fact("facing-three-bet", "POT")).toBe(formatSizingBbLabel(pot.knownBb));
      expect(v.facts.find((entry) => entry.code === "POT")?.label).toBe("Банк без анте");
      expect(text("facing-three-bet")).toContain(`${formatSizingBbLabel(pot.knownBb)} (без анте)`);
    }
  });

  it("the aggressive option described is exactly the node's real one (no invented 4-bet language)", () => {
    const { node } = requireAcademyPreflopTrainerSpotByStack(lesson.spot.stackBb, lesson.spot.nodeKey);
    const prose = text("facing-three-bet");
    expect(prose).not.toMatch(/4-бет/);
    if (node.actionCodes.includes("ALL_IN")) {
      expect(prose).toContain(`пойти олл-ин на все ${formatSizingBbLabel(40)}`);
      expect(fact("facing-three-bet", "HERO_ALL_IN")).toBe(formatSizingBbLabel(40));
    } else if (node.actionCodes.includes("RAISE")) {
      expect(prose).toContain("снова повысить");
    } else {
      expect(prose).toContain("только колл или фолд");
    }
  });
});

describe("direct practice: every CTA is the existing trainer route of that exact node", () => {
  beforeEach(() => vi.stubEnv("SESSION_SECRET", "beginner-after-open-secret"));
  afterEach(() => vi.unstubAllEnvs());

  it.each(ACADEMY_BEGINNER_AFTER_OPEN_LESSONS.map((lesson) => [lesson.slug, lesson] as const))("%s", (_slug, lesson) => {
    const v = view(lesson.slug);
    expect(v.main.practiceHref).toBe(preflopTrainerTrainRoute(lesson.spot.stackBb, lesson.spot.nodeKey));
    expect(v.main.studyHref).toBe(preflopTrainerSpotRoute(lesson.spot.stackBb, lesson.spot.nodeKey));
    // The route params resolve back to the same real node through the trainer's own (fail-closed) parser.
    const [, , , , stack, node, train] = v.main.practiceHref.split("/");
    expect(train).toBe("train");
    const resolved = resolvePreflopTrainerRouteSpot(stack, node);
    expect(resolved?.spot).toMatchObject({ stackBb: lesson.spot.stackBb, nodeKey: lesson.spot.nodeKey });
  });

  it.each(ACADEMY_BEGINNER_AFTER_OPEN_LESSONS.map((lesson) => [lesson.slug, lesson] as const))(
    "%s: the deep-linked session scores mixed positive-frequency answers as correct (normal practice semantics)",
    (_slug, lesson) => {
      const { spot } = requireAcademyPreflopTrainerSpotByStack(lesson.spot.stackBb, lesson.spot.nodeKey);
      const session = buildAcademyPreflopTrainerSession({
        playerId: "66666666-6666-4666-8666-666666666666",
        attemptId: "77777777-7777-4777-8777-777777777777",
        datasetId: spot.datasetId,
        nodeKey: spot.nodeKey,
      });
      expect(session).toHaveLength(10);
      for (const question of session) {
        for (const action of question.actions) {
          const reveal = toPreflopTrainerReveal(question, action.code);
          expect(reveal.countsAsCorrect).toBe((question.frequencies[action.code] ?? 0) > 0);
        }
      }
    },
  );
});
