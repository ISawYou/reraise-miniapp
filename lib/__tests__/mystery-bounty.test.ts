import { describe, expect, it } from "vitest";
import {
  computeEnvelopeDistribution,
  computeMysteryPool,
  getEnvelopeCount,
  validateEnvelopeBreakdown,
} from "@/lib/mystery-bounty";

describe("computeMysteryPool", () => {
  it("rounds the raw pool up to the nearest 10", () => {
    // 168 -> 170
    expect(computeMysteryPool({ players: 15, rebuys: 5, addons: 4 })).toBe(170);
  });

  it("rounds up even when already close to a multiple of 10", () => {
    // (players+rebuys)*6 = 161 raw -> 170
    expect(computeMysteryPool({ players: 20, rebuys: 6, addons: 1 })).toBe(170);
  });

  it("leaves an exact multiple of 10 unchanged", () => {
    // (10+0)*6 = 60
    expect(computeMysteryPool({ players: 10, rebuys: 0, addons: 0 })).toBe(60);
  });

  it("does not subtract the winner's own bounty", () => {
    // (8+0)*6 = 48 -> rounded up to 50; nothing is subtracted for the winner.
    expect(computeMysteryPool({ players: 8, rebuys: 0, addons: 0 })).toBe(50);
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

  it("matches the full worked example from the spec (players=15, rebuys=5, addons=4, active=10)", () => {
    const pool = computeMysteryPool({ players: 15, rebuys: 5, addons: 4 });
    expect(pool).toBe(170);

    const breakdown = computeEnvelopeDistribution(pool, 10);
    expect(breakdown).toEqual({
      envelopeCount: 9,
      smallCount: 5,
      smallValue: 10,
      mediumCount: 3,
      mediumValue: 20,
      jackpotValue: 60,
    });

    const total =
      breakdown.smallCount * breakdown.smallValue +
      breakdown.mediumCount * breakdown.mediumValue +
      breakdown.jackpotValue;
    expect(total).toBe(170);
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
