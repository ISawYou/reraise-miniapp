import { describe, expect, it } from "vitest";
import { getFreeSheetColumnLayout, parseFreeSheetValues } from "@/lib/tournament-sheet-parsing";

function metaRows(): string[][] {
  return [
    ["Tournament ID", "t1"],
    ["", "", "Название", "Test Tournament", "100", "50", "0"],
    [],
    [],
    [],
    [],
  ];
}

function sheetValues(headers: string[], dataRows: string[][]): string[][] {
  return [...metaRows(), headers, ...dataRows];
}

describe("getFreeSheetColumnLayout", () => {
  it("classic/bounty/deep_stack/phoenix/win_the_button share the same base layout (no extra column)", () => {
    for (const type of ["classic", "deep_stack", "phoenix", "bounty", "win_the_button"] as const) {
      const layout = getFreeSheetColumnLayout(type);
      expect(layout.knockoutsIndex).toBe(11);
      expect(layout.bossKnockoutsIndex).toBeNull();
      expect(layout.mysteryBountyPointsIndex).toBeNull();
      expect(layout.placeIndex).toBe(12);
      expect(layout.eliminatedIndex).toBe(14);
      expect(layout.headers).toHaveLength(16);
    }
  });

  it("boss_bounty inserts an extra 'Boss Nok' column, shifting Место/Выбыл by one", () => {
    const layout = getFreeSheetColumnLayout("boss_bounty");
    expect(layout.bossKnockoutsIndex).toBe(12);
    expect(layout.mysteryBountyPointsIndex).toBeNull();
    expect(layout.placeIndex).toBe(13);
    expect(layout.eliminatedIndex).toBe(15);
    expect(layout.headers).toContain("Boss Nok");
  });

  it("mystery_bounty inserts an extra 'Bounty Points' column, shifting Место/Выбыл by one", () => {
    const layout = getFreeSheetColumnLayout("mystery_bounty");
    expect(layout.bossKnockoutsIndex).toBeNull();
    expect(layout.mysteryBountyPointsIndex).toBe(12);
    expect(layout.placeIndex).toBe(13);
    expect(layout.eliminatedIndex).toBe(15);
    expect(layout.headers).toContain("Bounty Points");
  });
});

describe("parseFreeSheetValues", () => {
  it("parses a normal classic-layout row, including Выбыл=true", () => {
    const layout = getFreeSheetColumnLayout("classic");
    const values = sheetValues(layout.headers, [
      ["p1", "alice", "Alice", "@alice", "registered", "true", "false", "", "0", "3", "1", "2", "1", "80", "true", "26.08.2026 20:00"],
    ]);

    const result = parseFreeSheetValues(values, "classic");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = result.rows.get("p1");
    expect(row).toMatchObject({
      player_id: "p1",
      arrived: true,
      rebuys: 3,
      addons: 1,
      knockouts: 2,
      boss_knockouts: 0,
      mystery_bounty_points: 0,
      place: 1,
      eliminated: true,
      rowNumber: 8,
    });
  });

  it("parses Выбыл=false and a blank place as null", () => {
    const layout = getFreeSheetColumnLayout("classic");
    const values = sheetValues(layout.headers, [
      ["p1", "alice", "Alice", "@alice", "registered", "true", "false", "", "0", "0", "0", "0", "", "", "false", ""],
    ]);

    const result = parseFreeSheetValues(values, "classic");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows.get("p1")).toMatchObject({ eliminated: false, place: null });
  });

  it("parses boss_bounty layout, reading Boss Nok into boss_knockouts and KO into knockouts separately", () => {
    const layout = getFreeSheetColumnLayout("boss_bounty");
    const values = sheetValues(layout.headers, [
      ["p1", "alice", "Alice", "@alice", "registered", "true", "false", "", "0", "0", "0", "4", "2", "1", "80", "false", ""],
    ]);

    const result = parseFreeSheetValues(values, "boss_bounty");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows.get("p1")).toMatchObject({ knockouts: 4, boss_knockouts: 2, mystery_bounty_points: 0 });
  });

  it("parses mystery_bounty layout, reading Bounty Points into mystery_bounty_points", () => {
    const layout = getFreeSheetColumnLayout("mystery_bounty");
    const values = sheetValues(layout.headers, [
      ["p1", "alice", "Alice", "@alice", "registered", "true", "false", "", "0", "0", "0", "0", "15", "1", "80", "false", ""],
    ]);

    const result = parseFreeSheetValues(values, "mystery_bounty");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows.get("p1")).toMatchObject({ mystery_bounty_points: 15, boss_knockouts: 0 });
  });

  it("duplicate player_id rows: the last one wins", () => {
    const layout = getFreeSheetColumnLayout("classic");
    const values = sheetValues(layout.headers, [
      ["p1", "alice", "Alice", "@alice", "registered", "false", "false", "", "0", "0", "0", "0", "", "", "false", ""],
      ["p1", "alice", "Alice", "@alice", "registered", "true", "false", "", "0", "5", "0", "0", "", "", "true", ""],
    ]);

    const result = parseFreeSheetValues(values, "classic");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows.get("p1")).toMatchObject({ arrived: true, rebuys: 5, eliminated: true });
    expect(result.rows.size).toBe(1);
  });

  it("skips rows with an empty player_id", () => {
    const layout = getFreeSheetColumnLayout("classic");
    const values = sheetValues(layout.headers, [
      ["", "", "", "", "", "false", "false", "", "0", "0", "0", "0", "", "", "false", ""],
    ]);

    const result = parseFreeSheetValues(values, "classic");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows.size).toBe(0);
  });

  it("rejects an unexpected/reordered header instead of silently misreading columns", () => {
    const layout = getFreeSheetColumnLayout("classic");
    const scrambledHeaders = [...layout.headers];
    // Swap Re-buy and Addon -- a real-world "someone reordered a column"
    // scenario.
    [scrambledHeaders[9], scrambledHeaders[10]] = [scrambledHeaders[10], scrambledHeaders[9]];

    const values = sheetValues(scrambledHeaders, [
      ["p1", "alice", "Alice", "@alice", "registered", "true", "false", "", "0", "3", "1", "0", "", "", "false", ""],
    ]);

    const result = parseFreeSheetValues(values, "classic");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Re-buy");
  });

  it("rejects a header row that is missing entirely (e.g. an empty tab)", () => {
    const values = [...metaRows(), [], []];
    const result = parseFreeSheetValues(values, "classic");
    expect(result.ok).toBe(false);
  });
});
