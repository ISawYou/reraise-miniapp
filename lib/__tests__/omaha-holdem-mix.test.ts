import { describe, expect, it } from "vitest";
import { getOmahaHoldemMixPhase } from "@/lib/omaha-holdem-mix";

describe("Omaha / Hold'em Mix clock phase", () => {
  it("starts with Hold'em and alternates by blind level", () => {
    expect(getOmahaHoldemMixPhase(1, false).phase).toBe("holdem");
    expect(getOmahaHoldemMixPhase(2, false).phase).toBe("omaha");
    expect(getOmahaHoldemMixPhase(3, false).phase).toBe("holdem");
  });

  it("does not change the format during a break", () => {
    expect(getOmahaHoldemMixPhase(2, true)).toEqual({
      phase: "omaha",
      label: "MIX · уровень 2: Pot-Limit Omaha",
    });
  });

  it("matches Poker Clock display levels before, during and after a break", () => {
    // Poker Clock's producer contract numbers only playable blind levels:
    // [Hold'em, Omaha, break, Hold'em] is exposed as display levels
    // [1, 2, 2, 3], with isBreak=true only for the middle snapshot.
    expect(getOmahaHoldemMixPhase(1, false).phase).toBe("holdem");
    expect(getOmahaHoldemMixPhase(2, false).phase).toBe("omaha");
    expect(getOmahaHoldemMixPhase(2, true).phase).toBe("omaha");
    expect(getOmahaHoldemMixPhase(3, false).phase).toBe("holdem");
  });

  it("fails closed when Poker Clock has no usable current level", () => {
    expect(getOmahaHoldemMixPhase(null, null)).toEqual({
      phase: "unknown",
      label: "MIX · формат уровня уточняется",
    });
    expect(getOmahaHoldemMixPhase(0, false).phase).toBe("unknown");
  });
});
