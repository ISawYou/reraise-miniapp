// Pure Mystery Bounty math — pool sizing and envelope-denomination
// distribution. No I/O, no repository access: deliberately kept separate
// from features/mystery-bounty.ts so the arithmetic itself is trivially
// unit-testable and has no way to depend on DB/Sheets state.
//
// See docs/MYSTERY_BOUNTY_RESEARCH.md for why this lives on top of the
// existing free-tournament flow rather than a new `kind`.

export type MysteryPoolInput = {
  // Total Entries = Initial Entries + Rebuys, summed across every arrived
  // player. NOT "Players" and NOT "Rebuys" on their own — Google Sheets
  // (and the shared free-tournament "Re-buy" field generally) never stores
  // initial entries and rebuys as separate values, only this combined
  // count per player. Players + Rebuys = Total Entries by definition, so
  // using Total Entries directly here is the safe form of the formula: it
  // can never diverge from (players + rebuys) the way computing the two
  // separately and re-adding them could if a caller ever got the
  // Total-Entries-vs-Rebuys distinction wrong upstream.
  totalEntries: number;
  addons: number;
};

export type EnvelopeBreakdown = {
  envelopeCount: number;
  smallCount: number;
  smallValue: number;
  mediumCount: number;
  mediumValue: number;
  jackpotValue: number;
};

// Raw Pool = Total Entries × 6 + Addons × 12, rounded UP to the nearest 10.
// Bounty of the eventual winner is not subtracted (spec §3).
export function computeMysteryPool(input: MysteryPoolInput): number {
  const rawPool = input.totalEntries * 6 + input.addons * 12;
  return Math.ceil(rawPool / 10) * 10;
}

// True Rebuys, derived from the aggregated Total-Entries figure for
// display/diagnostics only — never fed back into the pool formula above
// (which uses Total Entries directly to avoid a players+rebuys reconciliation
// gap). Clamped at 0: Total Entries should never be lower than Players (every
// arrived player has at least one entry), but if upstream data is wrong this
// surfaces as Rebuys=0 rather than a negative number, so the anomaly is
// visible by comparing the raw Total Entries/Players the UI shows separately
// rather than hidden inside a nonsensical negative Rebuys.
export function computeRebuys(totalEntries: number, players: number): number {
  return Math.max(0, totalEntries - players);
}

// N = Active Players at Late Registration Close − 1 (spec §4). Rebuys/addons
// affect the pool but never the envelope count.
export function getEnvelopeCount(activePlayers: number): number {
  return activePlayers - 1;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Mystery Bounty: некорректный номинал конверта (${label} = ${value})`);
  }
}

// Spec §5-§9: automatic envelope-count + denomination calculation. Same
// (pool, activePlayers) pair always produces the same breakdown — no
// randomness here; only which physical envelope a player draws is random,
// and that happens outside the app entirely.
export function computeEnvelopeDistribution(
  mysteryPool: number,
  activePlayers: number
): EnvelopeBreakdown {
  if (!Number.isInteger(activePlayers) || activePlayers < 2) {
    throw new Error(
      "Mystery Bounty: недостаточно активных игроков для распределения конвертов (нужно минимум 2)"
    );
  }

  const envelopeCount = getEnvelopeCount(activePlayers);

  let breakdown: EnvelopeBreakdown;

  if (envelopeCount === 1) {
    // Случай A: один конверт получает весь пул.
    breakdown = {
      envelopeCount,
      smallCount: 0,
      smallValue: 0,
      mediumCount: 0,
      mediumValue: 0,
      jackpotValue: mysteryPool,
    };
  } else if (envelopeCount === 2) {
    // Случай B: один "small" конверт + весь остаток вторым конвертом.
    const small = Math.floor(mysteryPool / 3 / 5) * 5;
    const jackpot = mysteryPool - small;

    breakdown = {
      envelopeCount,
      smallCount: 1,
      smallValue: small,
      mediumCount: 0,
      mediumValue: 0,
      jackpotValue: jackpot,
    };
  } else {
    // Случай C: N >= 3 — Small (вес 1) / Medium (вес 2) / ровно один Jackpot (базовый вес 4).
    const jackpotCount = 1;
    const mediumCount = Math.round(envelopeCount * 0.3);
    const smallCount = envelopeCount - mediumCount - jackpotCount;

    if (smallCount < 0) {
      throw new Error("Mystery Bounty: некорректное распределение Small/Medium/Jackpot");
    }

    const totalWeight = smallCount + mediumCount * 2 + 4;
    const rawSmall = mysteryPool / totalWeight;
    const smallValue = Math.max(5, Math.floor(rawSmall / 5) * 5);
    const mediumValue = smallValue * 2;
    const baseJackpot = smallValue * 4;
    const baseDistributed = smallCount * smallValue + mediumCount * mediumValue + baseJackpot;
    const remainder = mysteryPool - baseDistributed;
    const jackpotValue = baseJackpot + remainder;

    breakdown = {
      envelopeCount,
      smallCount,
      smallValue,
      mediumCount,
      mediumValue,
      jackpotValue,
    };
  }

  validateEnvelopeBreakdown(breakdown, mysteryPool);
  return breakdown;
}

// Spec §11/§12: defensive checks before the snapshot is ever persisted —
// wrong envelope count, wrong total, or a non-integer/non-positive
// denomination must block activation rather than silently save.
export function validateEnvelopeBreakdown(
  breakdown: EnvelopeBreakdown,
  mysteryPool: number
): void {
  const { envelopeCount, smallCount, smallValue, mediumCount, mediumValue, jackpotValue } =
    breakdown;

  // Exactly one Jackpot envelope in every case (A/B fold their single/second
  // envelope into jackpotValue too) — so small + medium + 1 must equal N.
  if (smallCount + mediumCount + 1 !== envelopeCount) {
    throw new Error("Mystery Bounty: количество конвертов не совпадает с расчётным N");
  }

  if (smallCount > 0) assertPositiveInteger(smallValue, "Small");
  if (mediumCount > 0) assertPositiveInteger(mediumValue, "Medium");
  assertPositiveInteger(jackpotValue, "Jackpot");

  const total = smallCount * smallValue + mediumCount * mediumValue + jackpotValue;

  if (total !== mysteryPool) {
    throw new Error(
      `Mystery Bounty: сумма номиналов конвертов (${total}) не равна Mystery Pool (${mysteryPool})`
    );
  }
}
