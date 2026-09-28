import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  it("1. Bomb Pot: BOMB POT title + the product description says TWO boards (Double Board)", () => {
    const t = TOURNAMENT_PRESET_TEMPLATES.bomb_pot;
    expect(t.title).toBe("BOMB POT");
    expect(t.description).toMatch(/^Турнир по Texas Hold'em со специальными Double Board Bomb Pot раздачами\./);
    expect(t.description).toContain("Double Board");
    expect(t.description).toContain("две отдельные доски флопа");
    expect(t.description).toContain("половина банка разыгрывается по первой доске, половина — по второй");
    expect(t.description).toContain("каждый игрок, получающий карты, вносит 3 BB");
    expect(t.description).toContain("После закрытия поздней регистрации Bomb Pot раздачи больше не проводятся.");
  });

  it("2. Bomb Pot: the old single-board wording is gone", () => {
    const t = TOURNAMENT_PRESET_TEMPLATES.bomb_pot;
    expect(t.description).not.toContain("одна доска флопа");
    expect(t.description).not.toContain("открывается одна доска");
    expect(t.description).not.toContain("Раз в каждый уровень до окончания поздней регистрации проводится одна Bomb Pot раздача");
  });

  it("4. Boost Rating: RERAISE MAIN EVENT copy communicates ×2", () => {
    const t = TOURNAMENT_PRESET_TEMPLATES.boost_rating;
    expect(t.title).toBe("RERAISE MAIN EVENT");
    expect(t.description).toContain("умножаются на ×2");
  });

  it("5. Boost Rating: +2 participation is explicitly called out as unboosted", () => {
    const t = TOURNAMENT_PRESET_TEMPLATES.boost_rating;
    expect(t.description).toContain("Стандартные +2 очка за участие не умножаются.");
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

const ARTWORK = {
  boost_rating: { original: "boost-rating.png", card: "boost-rating-card.png" },
  bomb_pot: { original: "bomb-pot.png", card: "bomb-pot-card.png" },
} as const;

function png(file: string): { width: number; height: number; colorType: number } {
  const buf = readFileSync(join(process.cwd(), "public/tournament-assets", file));
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

describe("built-in artwork", () => {
  it.each(Object.entries(ARTWORK))("%s has its own original + card derivative", (type, files) => {
    const t = type as keyof typeof ARTWORK;
    expect(isTournamentVisualType(t)).toBe(true);
    expect(DEFAULT_TOURNAMENT_VISUALS[t]).toBe(`/tournament-assets/${files.original}`);
    expect(DEFAULT_TOURNAMENT_CARD_VISUALS[t]).toBe(`/tournament-assets/${files.card}`);
    expect(getDefaultTournamentVisual(t)).toMatchObject({
      tournamentType: t,
      assetUrl: `/tournament-assets/${files.original}`,
      cardAssetUrl: `/tournament-assets/${files.card}`,
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      opacity: 100,
    });
    expect(`${DEFAULT_TOURNAMENT_VISUALS[t]}${DEFAULT_TOURNAMENT_CARD_VISUALS[t]}`).not.toContain(
      "pineapple",
    );
  });

  it.each(Object.values(ARTWORK))("originals are the 1254px RGBA sources; cards are 512px RGBA", (files) => {
    expect(png(files.original)).toEqual({ width: 1254, height: 1254, colorType: 6 });
    expect(png(files.card)).toEqual({ width: 512, height: 512, colorType: 6 });
  });

  it("existing defaults are untouched", () => {
    expect(DEFAULT_TOURNAMENT_VISUALS.classic).toBe("/tournament-assets/classic.png");
    expect(DEFAULT_TOURNAMENT_VISUALS.crazy_pineapple).toBe("/tournament-assets/pineapple.png");
    expect(DEFAULT_TOURNAMENT_CARD_VISUALS.crazy_pineapple).toBe("/tournament-assets/pineapple-card.png");
  });
});
