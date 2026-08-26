import { describe, expect, it } from "vitest";
import {
  buildAchievementDisplayModel,
  resolveFeaturedAchievements,
  validateFeaturedAchievementKeys,
} from "@/lib/achievement-display";
import { ACHIEVEMENTS_CATALOG } from "@/config/achievements";

describe("achievement display model", () => {
  it("groups the catalog into exactly 8 tiered cards and 4 Legendary cards", () => {
    const model = buildAchievementDisplayModel([]);
    expect(model.families).toHaveLength(8);
    expect(model.legendary).toHaveLength(4);
    expect(model.families.every((family) => family.tiers.length === 4)).toBe(true);
  });

  it("keeps the canonical four targets for every progression family", () => {
    const targets = Object.fromEntries(
      ["in_game", "triumphator", "player_path", "itm", "community", "terminator", "boss_hunter", "streak"]
        .map((family) => [
          family,
          ACHIEVEMENTS_CATALOG.filter((item) => "family" in item && item.family === family)
            .map((item) => "target" in item ? item.target : null),
        ]),
    );
    expect(targets).toEqual({
      in_game: [1, 10, 25, 100],
      triumphator: [1, 10, 25, 100],
      player_path: [100, 1000, 2500, 10000],
      itm: [1, 10, 25, 100],
      community: [1, 5, 10, 25],
      terminator: [10, 50, 100, 250],
      boss_hunter: [5, 25, 50, 100],
      streak: [3, 5, 10, 20],
    });
  });

  it("resolves current and next tier from permanent completion rows", () => {
    const model = buildAchievementDisplayModel([
      { achievement_code: "first_tournament", current_value: 1, completed_at: "2020-01-01" },
      { achievement_code: "ten_tournaments", current_value: 10, completed_at: "2020-02-01" },
      { achievement_code: "twenty_five_tournaments", current_value: 17, completed_at: null },
    ]);
    const card = model.families.find((family) => family.family === "in_game")!;
    expect(card.currentTier).toBe("silver");
    expect(card.nextTier).toBe("gold");
    expect(card.currentValue).toBe(17);
    expect(card.maxLevel).toBe(false);
  });

  it("marks Platinum as max level", () => {
    const model = buildAchievementDisplayModel([
      { achievement_code: "first_itm", current_value: 1, completed_at: "1" },
      { achievement_code: "ten_itm", current_value: 10, completed_at: "2" },
      { achievement_code: "twenty_five_itm", current_value: 25, completed_at: "3" },
      { achievement_code: "hundred_itm", current_value: 100, completed_at: "4" },
    ]);
    expect(model.families.find((family) => family.family === "itm")).toMatchObject({
      currentTier: "platinum",
      nextTier: null,
      maxLevel: true,
    });
  });

  it("keeps hidden Legendary secret until earned", () => {
    const locked = buildAchievementDisplayModel([]).legendary.find((item) => item.code === "royal_flush")!;
    const unlocked = buildAchievementDisplayModel([
      { achievement_code: "royal_flush", current_value: 1, completed_at: "2020-01-01" },
    ]).legendary.find((item) => item.code === "royal_flush")!;
    expect(locked.name).toBe("Секретное достижение");
    expect(locked.description).not.toMatch(/Роял/i);
    expect(unlocked.name).toBe("Флеш Рояль");
    expect(unlocked.earned).toBe(true);
  });

  it("accepts at most three earned featured achievements", () => {
    const rows = [
      { achievement_code: "first_tournament", current_value: 1, completed_at: "1" },
      { achievement_code: "first_win", current_value: 1, completed_at: "2" },
      { achievement_code: "first_itm", current_value: 1, completed_at: "3" },
    ];
    expect(validateFeaturedAchievementKeys(rows, ["in_game", "triumphator", "itm"]))
      .toEqual(["in_game", "triumphator", "itm"]);
    expect(() => validateFeaturedAchievementKeys(rows, ["in_game", "triumphator", "itm", "community"]))
      .toThrow(/трёх/);
    expect(() => validateFeaturedAchievementKeys(rows, ["community"])).toThrow();
  });

  it("resolves a selected family to its current earned tier", () => {
    const rows = [
      { achievement_code: "first_tournament", current_value: 1, completed_at: "1" },
      { achievement_code: "ten_tournaments", current_value: 10, completed_at: "2" },
    ];
    const [selected] = resolveFeaturedAchievements(rows, ["in_game"]);
    expect(selected).toMatchObject({ key: "in_game", tier: "silver" });
    const family = buildAchievementDisplayModel(rows).families.find((card) => card.family === "in_game");
    expect(family?.tiers[1]).toMatchObject({ tier: "silver", completedAt: "2", earned: true });
  });
});
