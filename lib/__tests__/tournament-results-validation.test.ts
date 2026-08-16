import { describe, expect, it } from "vitest";
import {
  assertValidResultPlaces,
  describeResultPlaceIssues,
  findResultPlaceIssues,
  ResultPlaceValidationError,
} from "@/lib/tournament-results-validation";

describe("findResultPlaceIssues", () => {
  it("reports no issues for unique positive integer places", () => {
    expect(
      findResultPlaceIssues([
        { player_id: "p1", place: 1 },
        { player_id: "p2", place: 2 },
        { player_id: "p3", place: 3 },
      ])
    ).toEqual([]);
  });

  it("reports no issues for an empty roster", () => {
    expect(findResultPlaceIssues([])).toEqual([]);
  });

  it("flags two players sharing place=12 (the WIN THE BUTTON production incident)", () => {
    const issues = findResultPlaceIssues([
      { player_id: "p1", place: 1 },
      { player_id: "p2", place: 12, display_name: "Player A" },
      { player_id: "p3", place: 12, display_name: "Player B" },
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toBe("Место 12 указано у нескольких игроков: Player A, Player B.");
  });

  it("flags several different duplicate places independently, sorted ascending", () => {
    const issues = findResultPlaceIssues([
      { player_id: "p1", place: 5, display_name: "E" },
      { player_id: "p2", place: 2, display_name: "B" },
      { player_id: "p3", place: 5, display_name: "F" },
      { player_id: "p4", place: 2, display_name: "C" },
      { player_id: "p5", place: 3, display_name: "D" },
    ]);

    expect(issues).toEqual([
      "Место 2 указано у нескольких игроков: B, C.",
      "Место 5 указано у нескольких игроков: E, F.",
    ]);
  });

  it("flags place=0 as invalid, not as a valid place", () => {
    const issues = findResultPlaceIssues([
      { player_id: "p1", place: 0, display_name: "Zero" },
      { player_id: "p2", place: 1 },
    ]);

    expect(issues).toEqual([
      "Некорректное место (должно быть целым числом больше 0) у игроков: Zero.",
    ]);
  });

  it("flags a negative place as invalid", () => {
    const issues = findResultPlaceIssues([
      { player_id: "p1", place: -3, display_name: "Negative" },
    ]);

    expect(issues).toEqual([
      "Некорректное место (должно быть целым числом больше 0) у игроков: Negative.",
    ]);
  });

  it("flags a non-integer place as invalid", () => {
    const issues = findResultPlaceIssues([
      { player_id: "p1", place: 1.5, display_name: "Half" },
    ]);

    expect(issues).toEqual([
      "Некорректное место (должно быть целым числом больше 0) у игроков: Half.",
    ]);
  });

  it("does not double-count an invalid place as also a duplicate", () => {
    // Two players both send place=0 -- that's one "invalid place" issue,
    // not also a "duplicate place=0" issue (0 was never accepted as a real
    // place to begin with).
    const issues = findResultPlaceIssues([
      { player_id: "p1", place: 0 },
      { player_id: "p2", place: 0 },
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("Некорректное место");
  });

  it("falls back to player_id when display_name is missing", () => {
    const issues = findResultPlaceIssues([
      { player_id: "player-a", place: 4 },
      { player_id: "player-b", place: 4 },
    ]);

    expect(issues[0]).toBe("Место 4 указано у нескольких игроков: player-a, player-b.");
  });
});

describe("describeResultPlaceIssues", () => {
  it("returns null when every place is valid and unique", () => {
    expect(
      describeResultPlaceIssues([
        { player_id: "p1", place: 1 },
        { player_id: "p2", place: 2 },
      ])
    ).toBeNull();
  });

  it("appends a call-to-action suffix when issues exist", () => {
    const message = describeResultPlaceIssues([
      { player_id: "p1", place: 12, display_name: "A" },
      { player_id: "p2", place: 12, display_name: "B" },
    ]);

    expect(message).toBe(
      "Место 12 указано у нескольких игроков: A, B. Исправьте места перед завершением турнира."
    );
  });
});

describe("assertValidResultPlaces", () => {
  it("does not throw for a valid roster", () => {
    expect(() =>
      assertValidResultPlaces([
        { player_id: "p1", place: 1 },
        { player_id: "p2", place: 2 },
      ])
    ).not.toThrow();
  });

  it("throws ResultPlaceValidationError with the formatted message for duplicates", () => {
    expect(() =>
      assertValidResultPlaces([
        { player_id: "p1", place: 12, display_name: "A" },
        { player_id: "p2", place: 12, display_name: "B" },
      ])
    ).toThrow(ResultPlaceValidationError);

    try {
      assertValidResultPlaces([
        { player_id: "p1", place: 12, display_name: "A" },
        { player_id: "p2", place: 12, display_name: "B" },
      ]);
      throw new Error("expected assertValidResultPlaces to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ResultPlaceValidationError);
      expect((err as Error).message).toContain("Место 12 указано у нескольких игроков: A, B.");
    }
  });
});
