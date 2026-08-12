import { describe, expect, it } from "vitest";
import {
  computeEnvelopeDistribution,
  computeMysteryPool,
  computeRebuys,
  getEnvelopeCount,
  validateEnvelopeBreakdown,
} from "@/lib/mystery-bounty";

describe("computeMysteryPool", () => {
  it("rounds the raw pool up to the nearest 10", () => {
    // totalEntries=21 (Rating Engine v2 formula: ×5 entries, ×10 addons --
    // an add-on carries 2x the weight of a plain entry/rebuy) * 5 + 1*10
    // = 105 + 10 = 115 -> rounded up to 120
    expect(computeMysteryPool({ totalEntries: 21, addons: 1 })).toBe(120);
  });

  it("leaves an exact multiple of 10 unchanged", () => {
    // 20*5 + 4*10 = 100 + 40 = 140, already an exact multiple of 10
    expect(computeMysteryPool({ totalEntries: 20, addons: 4 })).toBe(140);
  });

  it("does not subtract the winner's own bounty", () => {
    // 9*5 = 45 -> rounded up to 50; nothing is subtracted for the winner.
    expect(computeMysteryPool({ totalEntries: 9, addons: 0 })).toBe(50);
  });

  it("an add-on is worth exactly 2x an entry/rebuy, never 1x", () => {
    // Compare deltas of +2 (not +1) so every raw pool lands exactly on a
    // multiple of 10 -- isolates the 2x weighting from ceil-to-10 rounding
    // artifacts, which a +1 delta can otherwise mask or distort.
    const base = computeMysteryPool({ totalEntries: 20, addons: 0 }); // 100
    const plusTwoEntries = computeMysteryPool({ totalEntries: 22, addons: 0 }); // 110
    const plusTwoAddons = computeMysteryPool({ totalEntries: 20, addons: 2 }); // 120
    expect(plusTwoEntries - base).toBe(10); // 5 points per entry
    expect(plusTwoAddons - base).toBe(20); // 10 points per addon -- exactly 2x
  });

  it("matches the corrected ТЗ example: Players=14, Total Entries=28, Addons=10 -> Pool=240", () => {
    // 28*5 + 10*10 = 140 + 100 = 240 (already an exact multiple of 10)
    expect(computeMysteryPool({ totalEntries: 28, addons: 10 })).toBe(240);
  });
});

describe("computeRebuys", () => {
  it("is Total Entries minus Players (the ТЗ example: 28 - 14 = 14)", () => {
    expect(computeRebuys(28, 14)).toBe(14);
  });

  it("is never negative even if Total Entries is somehow below Players", () => {
    expect(computeRebuys(5, 8)).toBe(0);
  });

  it("is 0 when every player entered exactly once", () => {
    expect(computeRebuys(14, 14)).toBe(0);
  });
});

describe("getEnvelopeCount", () => {
  it("is Active Players minus 1", () => {
    expect(getEnvelopeCount(10)).toBe(9);
    expect(getEnvelopeCount(2)).toBe(1);
  });
});

describe("computeEnvelopeDistribution — case A (N=1)", () => {
  it("gives the whole pool to a single envelope", () => {
    const breakdown = computeEnvelopeDistribution(60, 2);
    expect(breakdown).toEqual({
      envelopeCount: 1,
      smallCount: 0,
      smallValue: 0,
      mediumCount: 0,
      mediumValue: 0,
      jackpotValue: 60,
    });
  });
});

describe("computeEnvelopeDistribution — case B (N=2)", () => {
  it("matches the spec's worked example (pool=80)", () => {
    const breakdown = computeEnvelopeDistribution(80, 3);
    expect(breakdown.envelopeCount).toBe(2);
    expect(breakdown.smallCount).toBe(1);
    expect(breakdown.smallValue).toBe(25);
    expect(breakdown.jackpotValue).toBe(55);
  });
});

describe("computeEnvelopeDistribution — case C (N>=3)", () => {
  it("N=3: 1 Small / 1 Medium / 1 Jackpot", () => {
    const b = computeEnvelopeDistribution(60, 4);
    expect(b.envelopeCount).toBe(3);
    expect(b.smallCount).toBe(1);
    expect(b.mediumCount).toBe(1);
  });

  it("N=5: 2 Small / 2 Medium / 1 Jackpot", () => {
    const b = computeEnvelopeDistribution(100, 6);
    expect(b.envelopeCount).toBe(5);
    expect(b.smallCount).toBe(2);
    expect(b.mediumCount).toBe(2);
  });

  it("N=9: 5 Small / 3 Medium / 1 Jackpot", () => {
    const b = computeEnvelopeDistribution(170, 10);
    expect(b.envelopeCount).toBe(9);
    expect(b.smallCount).toBe(5);
    expect(b.mediumCount).toBe(3);
  });

  it("N=15: 9 Small / 5 Medium / 1 Jackpot", () => {
    const b = computeEnvelopeDistribution(300, 16);
    expect(b.envelopeCount).toBe(15);
    expect(b.smallCount).toBe(9);
    expect(b.mediumCount).toBe(5);
  });

  it("matches a full worked example (players=15, total entries=20, addons=4, active=10)", () => {
    const pool = computeMysteryPool({ totalEntries: 20, addons: 4 });
    expect(pool).toBe(140); // 20*5 + 4*10
    expect(computeRebuys(20, 15)).toBe(5);

    const breakdown = computeEnvelopeDistribution(pool, 10);
    expect(breakdown).toEqual({
      envelopeCount: 9,
      smallCount: 5,
      smallValue: 5,
      mediumCount: 3,
      mediumValue: 10,
      jackpotValue: 85,
    });

    const total =
      breakdown.smallCount * breakdown.smallValue +
      breakdown.mediumCount * breakdown.mediumValue +
      breakdown.jackpotValue;
    expect(total).toBe(140);
  });

  it("matches the corrected ТЗ example end-to-end: Players=14, Total Entries=28, Addons=10, Active=14", () => {
    const totalEntries = 28;
    const players = 14;
    const addons = 10;
    const activePlayers = 14;

    expect(computeRebuys(totalEntries, players)).toBe(14);

    const pool = computeMysteryPool({ totalEntries, addons });
    expect(pool).toBe(240); // 28*5 + 10*10, NOT the old 290/380

    expect(getEnvelopeCount(activePlayers)).toBe(13);

    const breakdown = computeEnvelopeDistribution(pool, activePlayers);
    expect(breakdown.envelopeCount).toBe(13);

    const total =
      breakdown.smallCount * breakdown.smallValue +
      breakdown.mediumCount * breakdown.mediumValue +
      breakdown.jackpotValue;
    expect(total).toBe(240);
  });

  it("Medium is always exactly double Small", () => {
    const breakdown = computeEnvelopeDistribution(500, 20);
    expect(breakdown.mediumValue).toBe(breakdown.smallValue * 2);
  });
});

describe("computeEnvelopeDistribution — invariants", () => {
  it("envelope value sum always equals the pool, whenever the pool is large enough to not be rejected", () => {
    let checkedAtLeastOne = false;

    for (let active = 2; active <= 40; active += 1) {
      for (const pool of [50, 60, 100, 170, 240, 500, 1000]) {
        // A too-small pool for this many envelopes is a legitimate §12
        // rejection (validateEnvelopeBreakdown throws) — skip those, they
        // are covered by their own dedicated test below.
        let breakdown;
        try {
          breakdown = computeEnvelopeDistribution(pool, active);
        } catch {
          continue;
        }

        checkedAtLeastOne = true;
        const total =
          breakdown.smallCount * breakdown.smallValue +
          breakdown.mediumCount * breakdown.mediumValue +
          breakdown.jackpotValue;
        expect(total).toBe(pool);
        expect(breakdown.smallCount + breakdown.mediumCount + 1).toBe(breakdown.envelopeCount);
      }
    }

    expect(checkedAtLeastOne).toBe(true);
  });

  it("rejects fewer than 2 active players", () => {
    expect(() => computeEnvelopeDistribution(60, 1)).toThrow();
    expect(() => computeEnvelopeDistribution(60, 0)).toThrow();
  });

  it("rejects a pool too small to give every N>=3 envelope at least 5 points", () => {
    // N=9 envelopes, pool=20 -> far below the 5-point floor per envelope.
    expect(() => computeEnvelopeDistribution(20, 10)).toThrow();
  });
});

describe("validateEnvelopeBreakdown", () => {
  it("throws when the total does not match the pool", () => {
    expect(() =>
      validateEnvelopeBreakdown(
        {
          envelopeCount: 3,
          smallCount: 1,
          smallValue: 10,
          mediumCount: 1,
          mediumValue: 20,
          jackpotValue: 40,
        },
        100
      )
    ).toThrow();
  });

  it("accepts a self-consistent breakdown", () => {
    expect(() =>
      validateEnvelopeBreakdown(
        {
          envelopeCount: 3,
          smallCount: 1,
          smallValue: 10,
          mediumCount: 1,
          mediumValue: 20,
          jackpotValue: 40,
        },
        70
      )
    ).not.toThrow();
  });
});
