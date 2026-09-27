import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOOST_PLACEMENT_POINTS_MULTIPLIER,
  normalizePlacementPointsMultiplier,
  parsePlacementPointsMultiplierInput,
  presetToTournamentFields,
  TOURNAMENT_PRESET_TEMPLATES,
} from "@/config/tournament-presets";
import {
  DEFAULT_TOURNAMENT_CARD_VISUALS,
  DEFAULT_TOURNAMENT_VISUALS,
  getDefaultTournamentVisual,
  isTournamentVisualType,
} from "@/config/tournament-visuals";
import {
  formatPlacementPointsMultiplier,
  getBoostRatingBadge,
  getTournamentTypeBonusLines,
  getTournamentTypeLabel,
  supportsTournamentBossKnockouts,
  supportsTournamentKnockouts,
} from "@/lib/tournament-helpers";
import { getFreeSheetColumnLayout } from "@/lib/tournament-sheet-parsing";

describe("templates", () => {
  it("Bomb Pot: BOMB POT title + the product description", () => {
    const t = TOURNAMENT_PRESET_TEMPLATES.bomb_pot;
    expect(t.title).toBe("BOMB POT");
    expect(t.description).toMatch(/^Турнир по Texas Hold'em со специальными Bomb Pot раздачами\./);
    expect(t.description).toContain("каждый игрок, получающий карты, вносит 3 BB");
    expect(t.description).toContain("После закрытия Late Registration специальные раздачи прекращаются.");
  });

  it("Boost Rating: title is RERAISE MAIN EVENT (not the type name)", () => {
    const t = TOURNAMENT_PRESET_TEMPLATES.boost_rating;
    expect(t.title).toBe("RERAISE MAIN EVENT");
    expect(t.description).toContain("коэффициент составляет x2");
    expect(t.description).toContain("+2 очка за участие не умножаются.");
    expect(t.description).toContain("Нокаут-бонусов в этом формате нет.");
  });

  it("both presets map straight through to real, non-final types", () => {
    expect(presetToTournamentFields("bomb_pot")).toEqual({ tournament_type: "bomb_pot", is_final: false });
    expect(presetToTournamentFields("boost_rating")).toEqual({
      tournament_type: "boost_rating",
      is_final: false,
    });
  });
});

describe("placement multiplier input/normalization", () => {
  it("boost default is 2", () => {
    expect(DEFAULT_BOOST_PLACEMENT_POINTS_MULTIPLIER).toBe(2);
  });

  it("form parser: non-boost always 1; boost accepts 2 / 1.5 / 1,5; rejects invalid", () => {
    expect(parsePlacementPointsMultiplierInput("classic", "7")).toBe(1);
    expect(parsePlacementPointsMultiplierInput("bomb_pot", "")).toBe(1);
    expect(parsePlacementPointsMultiplierInput("boost_rating", "2")).toBe(2);
    expect(parsePlacementPointsMultiplierInput("boost_rating", "2.0")).toBe(2);
    expect(parsePlacementPointsMultiplierInput("boost_rating", "1.5")).toBe(1.5);
    expect(parsePlacementPointsMultiplierInput("boost_rating", "1,5")).toBe(1.5);
    for (const bad of ["", "0", "0.00", "-1", "abc", "1.234", "1000"]) {
      expect(parsePlacementPointsMultiplierInput("boost_rating", bad)).toBeNull();
    }
  });

  it("server normalizer: ordinary tournaments stay 1.0", () => {
    expect(normalizePlacementPointsMultiplier("classic", 2)).toBe(1);
    expect(normalizePlacementPointsMultiplier("bomb_pot", null)).toBe(1);
    expect(normalizePlacementPointsMultiplier("boost_rating", null)).toBe(2);
    expect(normalizePlacementPointsMultiplier("boost_rating", 1.5)).toBe(1.5);
    expect(() => normalizePlacementPointsMultiplier("boost_rating", 0)).toThrow();
  });
});

describe("labels / KO / bonus lines", () => {
  it("labels", () => {
    expect(getTournamentTypeLabel("bomb_pot")).toBe("Bomb Pot");
    expect(getTournamentTypeLabel("boost_rating")).toBe("Boost Rating");
  });

  it.each(["bomb_pot", "boost_rating"] as const)("%s is a non-knockout format", (type) => {
    expect(supportsTournamentKnockouts(type)).toBe(false);
    expect(supportsTournamentBossKnockouts(type)).toBe(false);
    expect(getTournamentTypeBonusLines(type)).toEqual([]);
  });

  it("use the ordinary (non-Boss/non-Mystery) free sheet layout", () => {
    expect(getFreeSheetColumnLayout("bomb_pot")).toEqual(getFreeSheetColumnLayout("classic"));
    expect(getFreeSheetColumnLayout("boost_rating")).toEqual(getFreeSheetColumnLayout("classic"));
  });
});

describe("Boost badge", () => {
  it("formats cleanly: 2.0 -> ×2, 1.5 -> ×1.5", () => {
    expect(formatPlacementPointsMultiplier(2)).toBe("2");
    expect(formatPlacementPointsMultiplier(2.0)).toBe("2");
    expect(formatPlacementPointsMultiplier(1.5)).toBe("1.5");
    expect(formatPlacementPointsMultiplier(1.25)).toBe("1.25");
    expect(getBoostRatingBadge({ tournament_type: "boost_rating", placement_points_multiplier: 2 })).toBe(
      "BOOST RATING ×2"
    );
    expect(
      getBoostRatingBadge({ tournament_type: "boost_rating", placement_points_multiplier: 1.5 })
    ).toBe("BOOST RATING ×1.5");
  });

  it("no badge for any other type", () => {
    expect(getBoostRatingBadge({ tournament_type: "bomb_pot", placement_points_multiplier: 1 })).toBeNull();
    expect(getBoostRatingBadge({ tournament_type: "classic", placement_points_multiplier: 2 })).toBeNull();
  });
});

describe("visuals fallback", () => {
  it.each(["bomb_pot", "boost_rating"] as const)(
    "%s is its own visual key with the built-in fallback artwork + card derivative",
    (type) => {
      expect(isTournamentVisualType(type)).toBe(true);
      expect(DEFAULT_TOURNAMENT_VISUALS[type]).toBe("/tournament-assets/pineapple.png");
      expect(DEFAULT_TOURNAMENT_CARD_VISUALS[type]).toBe("/tournament-assets/pineapple-card.png");
      expect(getDefaultTournamentVisual(type)).toMatchObject({
        tournamentType: type,
        assetUrl: "/tournament-assets/pineapple.png",
      });
    }
  );

  it("existing defaults are untouched", () => {
    expect(DEFAULT_TOURNAMENT_VISUALS.classic).toBe("/tournament-assets/classic.png");
    expect(DEFAULT_TOURNAMENT_VISUALS.crazy_pineapple).toBe("/tournament-assets/pineapple.png");
  });
});
