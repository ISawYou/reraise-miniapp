import { describe, expect, it } from "vitest";
import { computeDerivedEliminationPlaces } from "@/lib/tournament-placement";

describe("computeDerivedEliminationPlaces", () => {
  it("returns an empty map when nobody is eliminated", () => {
    expect(computeDerivedEliminationPlaces(19, [])).toEqual(new Map());
  });

  it("fieldSize 19: first eliminated -> 19, second -> 18, third -> 17", () => {
    const places = computeDerivedEliminationPlaces(19, [
      { player_id: "a", eliminated_at: "2026-08-25T19:00:00.000Z" },
      { player_id: "b", eliminated_at: "2026-08-25T19:05:00.000Z" },
      { player_id: "c", eliminated_at: "2026-08-25T19:10:00.000Z" },
    ]);

    expect(places.get("a")).toBe(19);
    expect(places.get("b")).toBe(18);
    expect(places.get("c")).toBe(17);
  });

  it("input order does not matter -- always sorted by eliminated_at", () => {
    const places = computeDerivedEliminationPlaces(3, [
      { player_id: "c", eliminated_at: "2026-08-25T19:10:00.000Z" },
      { player_id: "a", eliminated_at: "2026-08-25T19:00:00.000Z" },
      { player_id: "b", eliminated_at: "2026-08-25T19:05:00.000Z" },
    ]);

    expect(places.get("a")).toBe(3);
    expect(places.get("b")).toBe(2);
    expect(places.get("c")).toBe(1);
  });

  it("a growing fieldSize shifts every already-eliminated player's place upward by the same amount", () => {
    const entries = [
      { player_id: "a", eliminated_at: "2026-08-25T19:00:00.000Z" },
      { player_id: "b", eliminated_at: "2026-08-25T19:05:00.000Z" },
    ];

    expect(computeDerivedEliminationPlaces(17, entries)).toEqual(
      new Map([
        ["a", 17],
        ["b", 16],
      ])
    );
    expect(computeDerivedEliminationPlaces(19, entries)).toEqual(
      new Map([
        ["a", 19],
        ["b", 18],
      ])
    );
  });

  it("fieldSize 0 (nobody arrived) yields no places at all", () => {
    expect(
      computeDerivedEliminationPlaces(0, [{ player_id: "a", eliminated_at: "2026-08-25T19:00:00.000Z" }])
    ).toEqual(new Map());
  });

  it("identical timestamps resolve deterministically by player_id (documented simultaneous-elimination limitation)", () => {
    const first = computeDerivedEliminationPlaces(2, [
      { player_id: "z", eliminated_at: "2026-08-25T19:00:00.000Z" },
      { player_id: "a", eliminated_at: "2026-08-25T19:00:00.000Z" },
    ]);
    const second = computeDerivedEliminationPlaces(2, [
      { player_id: "a", eliminated_at: "2026-08-25T19:00:00.000Z" },
      { player_id: "z", eliminated_at: "2026-08-25T19:00:00.000Z" },
    ]);

    expect(first).toEqual(second);
    expect(first.get("a")).toBe(2);
    expect(first.get("z")).toBe(1);
  });
});
