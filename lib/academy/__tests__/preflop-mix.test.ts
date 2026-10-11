import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACADEMY_PREFLOP_TRAINER_DATASET_IDS } from "@/config/academy/preflop-trainer";
import { getAcademyStrategyDataset } from "@/config/academy/solver-datasets";
import {
  ACADEMY_PREFLOP_MIX_MAX_PURE_FOLD_HANDS,
  ACADEMY_PREFLOP_MIX_QUESTION_COUNT,
  buildAcademyPreflopMixSession,
  classifyPreflopMixCategory,
  derivePreflopMixRandomizerPercent,
  listAcademyPreflopMixCandidates,
  preflopMixNodeWeight,
  selectPreflopMixNodes,
  type AcademyPreflopMixCategory,
} from "@/lib/academy/preflop-mix";
import { buildPreflopTableScene, PREFLOP_TABLE_FOLD_LABEL } from "@/lib/academy/preflop-table-scene";
import {
  buildAcademyPreflopTrainerSession,
  listAcademyPreflopTrainerSpots,
  requireAcademyPreflopTrainerSpotByStack,
  toPublicPreflopTrainerSpot,
} from "@/lib/academy/preflop-trainer";
import { resolveActionFromFrequencies } from "@/lib/academy/solver";
import { deriveDeterministicUnit } from "@/lib/academy/solver-session";

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PLAYER_ID = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const HRC_DATASET_ID = "hrc_scenario_b_rfi_9max_100bb_v1";

function attemptId(seed: number): string {
  return `22222222-2222-4222-8222-${String(seed).padStart(12, "0")}`;
}

function mix(seed: number, playerId = PLAYER_ID) {
  return buildAcademyPreflopMixSession({ playerId, attemptId: attemptId(seed) });
}

const signature = (session: ReturnType<typeof mix>) =>
  session.map((question) => `${question.spot.datasetId}/${question.spot.nodeKey}/${question.hand}/${question.randomizerPercent}`).join("|");

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "preflop-mix-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Quick Mix session shape", () => {
  it("(3) a session has exactly 10 questions, indexed 0..9", () => {
    const session = buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
    expect(ACADEMY_PREFLOP_MIX_QUESTION_COUNT).toBe(10);
    expect(session).toHaveLength(10);
    expect(session.map((question) => question.questionIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("(4) one fixture session really mixes nodes, stacks and situations", () => {
    const session = buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
    expect(new Set(session.map((question) => `${question.spot.datasetId}/${question.spot.nodeKey}`)).size).toBe(10);
    expect(new Set(session.map((question) => question.spot.stackBb)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(session.map((question) => question.spot.situation)).size).toBeGreaterThanOrEqual(3);
  });

  it("only uses real nodes of the 5 whitelisted datasets — never the HRC dataset", () => {
    expect(ACADEMY_PREFLOP_TRAINER_DATASET_IDS).not.toContain(HRC_DATASET_ID);
    expect(listAcademyPreflopMixCandidates()).toHaveLength(listAcademyPreflopTrainerSpots().length);
    for (let seed = 0; seed < 60; seed += 1) {
      for (const question of mix(seed)) {
        expect(ACADEMY_PREFLOP_TRAINER_DATASET_IDS).toContain(question.spot.datasetId);
        expect(Object.prototype.hasOwnProperty.call(getAcademyStrategyDataset(question.spot.datasetId).nodes, question.spot.nodeKey)).toBe(true);
      }
    }
  });

  it("(10) frequencies are the dataset's stored values and the resolved action follows the randomizer", () => {
    for (const question of mix(7)) {
      const node = getAcademyStrategyDataset(question.spot.datasetId).nodes[question.spot.nodeKey];
      expect(question.frequencies).toBe(node.hands[question.hand]);
      expect(question.resolvedAction).toBe(resolveActionFromFrequencies(node.hands[question.hand], node.actionCodes, question.randomizerPercent));
      expect(question.actions.map((action) => action.code)).toEqual(node.actionCodes);
    }
  });
});

describe("Quick Mix determinism and isolation", () => {
  it("(5) same (player, attempt) → identical 10-node sequence, hands, cards and randomizers", () => {
    const first = buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
    const second = buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
    expect(second).toEqual(first);
    expect(signature(second)).toBe(signature(first));
  });

  it("(6) different attempts / players give different mixes (40 seeds, all distinct)", () => {
    const byAttempt = new Set(Array.from({ length: 40 }, (_, seed) => signature(mix(seed))));
    expect(byAttempt.size).toBe(40);
    const nodeOrders = new Set(Array.from({ length: 40 }, (_, seed) =>
      mix(seed).map((question) => `${question.spot.stackBb}/${question.spot.nodeKey}`).join("|")));
    expect(nodeOrders.size).toBe(40);
    let differentForOtherPlayer = 0;
    for (let seed = 0; seed < 20; seed += 1) {
      if (signature(mix(seed)) !== signature(mix(seed, OTHER_PLAYER_ID))) differentForOtherPlayer += 1;
    }
    expect(differentForOtherPlayer).toBe(20);
  });

  it("uses its own HMAC inputs (never the fixed-node trainer's derivation)", () => {
    expect(derivePreflopMixRandomizerPercent({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID }, 3)).toBe(
      Math.floor(deriveDeterministicUnit([PLAYER_ID, "solver_preflop_trainer", ATTEMPT_ID, "preflop-quick-mix", "3", "resolve"]) * 100),
    );
    const mixed = buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID })[0];
    const fixed = buildAcademyPreflopTrainerSession({
      playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId: mixed.spot.datasetId, nodeKey: mixed.spot.nodeKey,
    });
    // Same node, same player + attempt: the fixed-node session is its own derivation.
    expect(fixed.map((question) => question.randomizerPercent)).not.toEqual(
      buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID }).map((question) => question.randomizerPercent),
    );
  });

  it("(7) no node (not even the same seat-vs-seat node at another stack) appears twice in a row", () => {
    for (let seed = 0; seed < 150; seed += 1) {
      const session = mix(seed);
      for (let index = 1; index < session.length; index += 1) {
        expect(session[index].spot.nodeKey).not.toBe(session[index - 1].spot.nodeKey);
      }
      expect(new Set(session.map((question) => `${question.spot.datasetId}/${question.spot.nodeKey}`)).size).toBe(10);
    }
  });
});

describe("(11) balanced mix policy over many simulated attempts", () => {
  const ATTEMPTS = 400;
  const sessions = () => Array.from({ length: ATTEMPTS }, (_, seed) => mix(1000 + seed));

  it("favours facing-open / blind defence / RFI over rare deep branches, structurally and in aggregate", () => {
    const totals: Record<AcademyPreflopMixCategory, number> = {
      BLIND_DEFENSE: 0, FACING_OPEN: 0, RFI: 0, FACING_3BET: 0, FACING_4BET: 0, FACING_5BET: 0,
    };
    let sessionsWithDeepBranch = 0;
    for (const session of sessions()) {
      const counts: Record<string, number> = {};
      for (const question of session) {
        const category = classifyPreflopMixCategory(question.spot);
        counts[category] = (counts[category] ?? 0) + 1;
        totals[category] += 1;
      }
      // Every session: ≥ 5 facing-open (incl. blind defence), ≥ 3 blind defence, ≥ 2 RFI, ≥ 2 facing a 3-bet,
      // and at most ONE facing-4bet / 5-bet spot.
      expect((counts.BLIND_DEFENSE ?? 0) + (counts.FACING_OPEN ?? 0)).toBeGreaterThanOrEqual(5);
      expect(counts.BLIND_DEFENSE ?? 0).toBeGreaterThanOrEqual(3);
      expect(counts.RFI ?? 0).toBeGreaterThanOrEqual(2);
      expect(counts.FACING_3BET ?? 0).toBeGreaterThanOrEqual(2);
      const deep = (counts.FACING_4BET ?? 0) + (counts.FACING_5BET ?? 0);
      expect(deep).toBeLessThanOrEqual(1);
      if (deep > 0) sessionsWithDeepBranch += 1;
      // Stack depth varies inside every session.
      expect(new Set(session.map((question) => question.spot.stackBb)).size).toBeGreaterThanOrEqual(3);
    }
    const n = ATTEMPTS * 10;
    expect((totals.BLIND_DEFENSE + totals.FACING_OPEN) / n).toBeGreaterThan(0.5);
    expect(totals.RFI / n).toBeGreaterThan(0.2);
    expect(totals.FACING_5BET).toBeLessThan(totals.RFI / 5);
    expect(totals.FACING_4BET).toBeLessThan(totals.BLIND_DEFENSE / 5);
    // Uniform sampling would give facing-4/5-bet 106/434 ≈ 24% of questions; the mix keeps them ~5%.
    expect((totals.FACING_4BET + totals.FACING_5BET) / n).toBeLessThan(0.08);
    // ...but they do appear occasionally.
    expect(sessionsWithDeepBranch / ATTEMPTS).toBeGreaterThan(0.25);
    expect(sessionsWithDeepBranch / ATTEMPTS).toBeLessThan(0.75);
  });

  it("sessions are never dominated by trivial pure folds", () => {
    let pureFoldTotal = 0;
    let mixedTotal = 0;
    for (const session of sessions()) {
      const pureFolds = session.filter((question) => question.bucket === "PURE:FOLD").length;
      expect(pureFolds).toBeLessThanOrEqual(ACADEMY_PREFLOP_MIX_MAX_PURE_FOLD_HANDS);
      pureFoldTotal += pureFolds;
      mixedTotal += session.filter((question) => question.bucket === "MIXED").length;
    }
    expect(pureFoldTotal / (ATTEMPTS * 10)).toBeLessThan(0.3);
    expect(mixedTotal / (ATTEMPTS * 10)).toBeGreaterThan(0.25);
  });

  it("node weight prefers non-trivial nodes and the pick follows it", () => {
    expect(preflopMixNodeWeight(1)).toBeCloseTo(0.25);
    expect(preflopMixNodeWeight(0)).toBe(1);
    // Over many seeded streams, low-weight (mostly pure-fold) RFI nodes are picked less often than high-weight ones.
    const rfi = listAcademyPreflopMixCandidates().filter((candidate) => candidate.category === "RFI");
    const heaviest = rfi.reduce((best, candidate) => (candidate.weight > best.weight ? candidate : best));
    const lightest = rfi.reduce((best, candidate) => (candidate.weight < best.weight ? candidate : best));
    expect(heaviest.weight).toBeGreaterThan(lightest.weight);
    let seed = 1;
    const lcg = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const picks = new Map<string, number>();
    for (let run = 0; run < 3000; run += 1) {
      for (const candidate of selectPreflopMixNodes(lcg)) {
        if (candidate.category !== "RFI") continue;
        const id = `${candidate.spot.datasetId}/${candidate.spot.nodeKey}`;
        picks.set(id, (picks.get(id) ?? 0) + 1);
      }
    }
    const id = (candidate: typeof heaviest) => `${candidate.spot.datasetId}/${candidate.spot.nodeKey}`;
    expect(picks.get(id(heaviest)) ?? 0).toBeGreaterThan(picks.get(id(lightest)) ?? 0);
  });
});

describe("(12)(13) table scene derived from the node only", () => {
  const scene = (stackBb: number, nodeKey: string) => toPublicPreflopTrainerSpot(requireAcademyPreflopTrainerSpotByStack(stackBb, nodeKey).spot).scene;
  const labels = (value: ReturnType<typeof scene>) => Object.fromEntries(value.seats.map((seat) => [seat.seat, seat.actionLabel ?? null]));
  const roles = (value: ReturnType<typeof scene>) => Object.fromEntries(value.seats.map((seat) => [seat.seat, seat.role]));

  it("RFI: earlier seats folded, no villain, no label on hero or later seats", () => {
    const value = scene(20, "RFI_CO");
    expect(value.heroSeat).toBe("CO");
    expect(value.villainSeat).toBeUndefined();
    expect(labels(value)).toEqual({ UTG: "Фолд", UTG1: "Фолд", UTG2: "Фолд", LJ: "Фолд", HJ: "Фолд", CO: null, BTN: null, SB: null, BB: null });
    expect(roles(value)).toMatchObject({ CO: "hero", BTN: "waiting", SB: "waiting", BB: "waiting" });
  });

  it("facing an open: the opener's 'Рейз' / 'Олл-ин' comes from that opener's real RFI node", () => {
    const deep = scene(20, "FACING_OPEN_BB_VS_BTN");
    expect(deep).toMatchObject({ heroSeat: "BB", villainSeat: "BTN" });
    expect(labels(deep)).toEqual({ UTG: "Фолд", UTG1: "Фолд", UTG2: "Фолд", LJ: "Фолд", HJ: "Фолд", CO: "Фолд", BTN: "Рейз", SB: "Фолд", BB: null });
    // 5 BB: the opener's RFI node is shove / fold, so the label is "Олл-ин", not an invented raise.
    expect(labels(scene(5, "FACING_OPEN_BB_VS_BTN")).BTN).toBe("Олл-ин");
    // Seats after the hero have not acted yet.
    expect(roles(scene(40, "FACING_OPEN_CO_VS_UTG"))).toMatchObject({ UTG: "villain", HJ: "folded", CO: "hero", BTN: "waiting", BB: "waiting" });
  });

  it("facing 3-/4-bets: both players' earlier aggressive actions, everyone else folded", () => {
    expect(labels(scene(20, "FACING_3BET_BTN_VS_BB"))).toMatchObject({ BTN: "Рейз", BB: "Олл-ин", SB: "Фолд", UTG: "Фолд" });
    expect(labels(scene(100, "FACING_4BET_BB_VS_BTN"))).toMatchObject({ BTN: "4-бет", BB: "3-бет", SB: "Фолд", CO: "Фолд" });
    expect(labels(scene(100, "FACING_3BET_CO_VS_BTN"))).toMatchObject({ CO: "Рейз", BTN: "3-бет", SB: "Фолд", BB: "Фолд" });
  });

  it("never invents sizes or labels: every scene of all 434 nodes uses only node-implied labels", () => {
    const allowed = new Set([PREFLOP_TABLE_FOLD_LABEL, "Рейз", "3-бет", "4-бет", "5-бет", "Олл-ин"]);
    const spots = listAcademyPreflopTrainerSpots();
    expect(spots).toHaveLength(434);
    for (const spot of spots) {
      const value = toPublicPreflopTrainerSpot(spot).scene;
      expect(value.seats.map((seat) => seat.seat)).toEqual(["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"]);
      for (const seat of value.seats) {
        if (seat.actionLabel === undefined) continue;
        expect(allowed.has(seat.actionLabel)).toBe(true);
        expect(seat.actionLabel).not.toMatch(/BB|\d\s*(BB|%)|\d[.,]\d/);
      }
      if (spot.villainPosition) {
        expect(value.seats.find((seat) => seat.seat === spot.villainPosition)!.actionLabel).toBeDefined();
      }
    }
  });

  it("without supplied labels it shows folds only (no guessed aggressor action)", () => {
    const value = buildPreflopTableScene({ situation: "FACING_OPEN", heroPosition: "BB", villainPosition: "SB" });
    expect(value.seats.find((seat) => seat.seat === "SB")).toEqual({ seat: "SB", role: "villain" });
    expect(() => buildPreflopTableScene({ situation: "FACING_OPEN", heroPosition: "UTG", villainPosition: "BB" })).toThrow();
  });
});
