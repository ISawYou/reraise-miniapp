import { describe, expect, it } from "vitest";
import { getExpectedPrizePlaces } from "@/lib/tournament-helpers";
import { isEffectiveArrivedResult } from "../ResultRepository";

describe("Bubble Boy historical attendance fallback", () => {
  it("counts historical positive-rating rows in the field and identifies the bubble", () => {
    const field = Array.from({ length: 20 }, () => ({ arrived: null, rating_points: 2 }));
    const fieldSize = field.filter(isEffectiveArrivedResult).length;

    expect(fieldSize).toBe(20);
    expect(7).toBe(getExpectedPrizePlaces(fieldSize) + 1);
  });

  it("does not count a historical zero-rating row as arrived", () => {
    expect(isEffectiveArrivedResult({ arrived: null, rating_points: 0 })).toBe(false);
  });

  it("keeps explicit arrived=true behavior unchanged", () => {
    expect(isEffectiveArrivedResult({ arrived: true, rating_points: 0 })).toBe(true);
  });
});
