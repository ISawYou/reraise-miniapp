import { describe, expect, it } from "vitest";
import { computeMaxTournamentStreak } from "@/lib/tournament-streak";

describe("computeMaxTournamentStreak", () => {
  it("0 tournaments -> 0", () => {
    expect(computeMaxTournamentStreak([], new Set())).toBe(0);
  });

  it("no attendance at all -> 0", () => {
    expect(computeMaxTournamentStreak(["t1", "t2", "t3"], new Set())).toBe(0);
  });

  it("1 tournament attended -> 1", () => {
    expect(computeMaxTournamentStreak(["t1"], new Set(["t1"]))).toBe(1);
  });

  it("2 tournaments attended in a row -> 2", () => {
    expect(computeMaxTournamentStreak(["t1", "t2"], new Set(["t1", "t2"]))).toBe(2);
  });

  it("the example from the spec: YES YES YES NO YES YES YES -> max streak 3", () => {
    const ordered = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"];
    const attended = new Set(["t1", "t2", "t3", "t5", "t6", "t7"]);
    expect(computeMaxTournamentStreak(ordered, attended)).toBe(3);
  });

  it("a miss resets the current streak", () => {
    const ordered = ["t1", "t2", "t3", "t4"];
    const attended = new Set(["t1", "t2"]); // miss t3, t4
    expect(computeMaxTournamentStreak(ordered, attended)).toBe(2);
  });

  it("a new streak starts after a miss and can exceed the earlier one", () => {
    const ordered = ["t1", "t2", "t3", "t4", "t5", "t6"];
    const attended = new Set(["t1", "t2", "t4", "t5", "t6"]); // miss t3 only
    expect(computeMaxTournamentStreak(ordered, attended)).toBe(3); // t4,t5,t6
  });

  it("returns the MAXIMUM historical streak, not the current (trailing) one", () => {
    const ordered = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10", "t11", "t12"];
    // A streak of 10, then a miss, then attends 1 more -- current streak
    // is 1, but the max (already earned) streak of 10 must not be lost.
    const attended = new Set(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10", "t12"]);
    expect(computeMaxTournamentStreak(ordered, attended)).toBe(10);
  });

  it("exact thresholds: 5, 10, 20", () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

    expect(computeMaxTournamentStreak(make(5), new Set(make(5)))).toBe(5);
    expect(computeMaxTournamentStreak(make(10), new Set(make(10)))).toBe(10);
    expect(computeMaxTournamentStreak(make(20), new Set(make(20)))).toBe(20);
  });

  it("accepts a plain array for attendedTournamentIds, not only a Set", () => {
    expect(computeMaxTournamentStreak(["t1", "t2"], ["t1", "t2"])).toBe(2);
  });

  it("a tournament absent from orderedTournamentIds (e.g. cancelled/non-completed, filtered by the caller) is simply not part of the sequence", () => {
    // The caller (features/achievements.ts) is responsible for only
    // passing completed tournaments -- this function has no special
    // handling for "cancelled", it just never sees them.
    const ordered = ["t1", "t2", "t4"]; // t3 (cancelled) never appears
    const attended = new Set(["t1", "t2", "t4"]);
    expect(computeMaxTournamentStreak(ordered, attended)).toBe(3);
  });

  it("deterministic: identical inputs always produce identical output", () => {
    const ordered = ["t1", "t2", "t3", "t4", "t5"];
    const attended = new Set(["t1", "t3", "t4", "t5"]);
    const results = Array.from({ length: 5 }, () => computeMaxTournamentStreak(ordered, attended));
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe(3); // t3, t4, t5
  });
});
