export type OmahaHoldemMixPhase = "holdem" | "omaha" | "unknown";

export function getOmahaHoldemMixPhase(
  currentLevel: number | null,
  isBreak: boolean | null,
): { phase: OmahaHoldemMixPhase; label: string } {
  // A break carries no new level. If the clock cannot provide the level even
  // during a break, keep the UI honest instead of guessing from the blinds.
  if (isBreak === true && currentLevel === null) {
    return { phase: "unknown", label: "MIX · формат уровня уточняется" };
  }
  if (!Number.isInteger(currentLevel) || currentLevel === null || currentLevel < 1) {
    return { phase: "unknown", label: "MIX · формат уровня уточняется" };
  }

  // Level 1 is Hold'em, level 2 is Omaha. A break does not advance the
  // current level, so the same currentLevel remains authoritative while the
  // clock is on break. `_isBreak` is accepted to make that contract explicit
  // without deriving a phase from blind 0/0.
  return currentLevel % 2 === 1
    ? { phase: "holdem", label: `MIX · уровень ${currentLevel}: Texas Hold'em` }
    : { phase: "omaha", label: `MIX · уровень ${currentLevel}: Pot-Limit Omaha` };
}
