import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  normalizePlacementPointsMultiplier,
  presetToTournamentFields,
  TOURNAMENT_PRESET_TEMPLATES,
  tournamentToPreset,
} from "@/config/tournament-presets";
import {
  DEFAULT_TOURNAMENT_CARD_VISUALS,
  DEFAULT_TOURNAMENT_VISUALS,
  getDefaultTournamentVisual,
  isTournamentVisualType,
} from "@/config/tournament-visuals";
import {
  getBoostRatingBadge,
  getTournamentTypeBonusLines,
  getTournamentTypeLabel,
  getTournamentTypeMultiplier,
  supportsMysteryBounty,
  supportsTournamentBossKnockouts,
  supportsTournamentKnockouts,
} from "@/lib/tournament-helpers";
import { getFreeSheetColumnLayout } from "@/lib/tournament-sheet-parsing";
import type { TournamentType } from "@/types/domain";

const FREE_ROLL_DESCRIPTION =
  "Классический фриролл по Texas Hold'em. Первый вход в турнир бесплатный для каждого игрока. Re-entry и Add-on оплачиваются по обычным правилам и продолжают увеличивать рейтинговый пул турнира. Стартовый стек — 30 000 фишек. Add-on — 60 000 фишек.";

describe("FREE-ROLL -- a real persisted TournamentType", () => {
  it("is accepted as a TournamentType and maps straight through (not a Final Month alias)", () => {
    const type: TournamentType = "free_roll";
    expect(presetToTournamentFields(type)).toEqual({ tournament_type: "free_roll", is_final: false });
    expect(tournamentToPreset({ tournament_type: "free_roll", is_final: false })).toBe("free_roll");
  });

  it("is allowlisted by the Postgres CHECK constraint in the Drizzle schema", () => {
    const schema = readFileSync(join(process.cwd(), "lib/db/schema/tournaments.ts"), "utf8");
    const check = schema.split("\n").find((line) => line.includes("${table.tournamentType} IN ("));
    expect(check).toBeDefined();
    expect(check).toContain("'free_roll'");
    for (const existing of ["classic", "bomb_pot", "boost_rating", "mystery_bounty"]) {
      expect(check).toContain(`'${existing}'`);
    }
  });

  it("the latest migration widens the CHECK constraint purely additively", () => {
    const dir = join(process.cwd(), "lib/db/migrations");
    const file = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .find((name) => readFileSync(join(dir, name), "utf8").includes("'free_roll'"));
    expect(file).toBeDefined();
    const sql = readFileSync(join(dir, file!), "utf8");
    expect(sql).toContain('ADD CONSTRAINT "tournaments_tournament_type_check"');
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|DROP TABLE|DROP COLUMN|RENAME)\b/i);
  });
});

describe("FREE-ROLL -- preset + labels", () => {
  it("template: FREE-ROLL title + the exact canonical description", () => {
    expect(TOURNAMENT_PRESET_TEMPLATES.free_roll).toEqual({
      title: "FREE-ROLL",
      description: FREE_ROLL_DESCRIPTION,
    });
  });

  it("label helper returns Free-roll", () => {
    expect(getTournamentTypeLabel("free_roll")).toBe("Free-roll");
  });
});

describe("FREE-ROLL -- no special rating mechanics", () => {
  it("no knockouts, boss knockouts, Mystery Bounty, type multiplier, bonus lines or boost", () => {
    expect(supportsTournamentKnockouts("free_roll")).toBe(false);
    expect(supportsTournamentBossKnockouts("free_roll")).toBe(false);
    expect(supportsMysteryBounty("free_roll")).toBe(false);
    expect(getTournamentTypeMultiplier("free_roll")).toBe(1);
    expect(getTournamentTypeBonusLines("free_roll")).toEqual([]);
    expect(normalizePlacementPointsMultiplier("free_roll", 2)).toBe(1);
    expect(getBoostRatingBadge({ tournament_type: "free_roll", placement_points_multiplier: 2 })).toBeNull();
  });

  it("uses the ordinary (classic) free sheet layout -- no Boss Nok / Mystery columns", () => {
    expect(getFreeSheetColumnLayout("free_roll")).toEqual(getFreeSheetColumnLayout("classic"));
    expect(getFreeSheetColumnLayout("free_roll").mysteryBountyPointsIndex).toBeNull();
  });
});

describe("FREE-ROLL -- built-in artwork", () => {
  it("visual mappings point at the committed original + 512 card derivative", () => {
    expect(isTournamentVisualType("free_roll")).toBe(true);
    expect(DEFAULT_TOURNAMENT_VISUALS.free_roll).toBe("/tournament-assets/free-roll.png");
    expect(DEFAULT_TOURNAMENT_CARD_VISUALS.free_roll).toBe("/tournament-assets/free-roll-card.png");
    expect(getDefaultTournamentVisual("free_roll")).toMatchObject({
      tournamentType: "free_roll",
      assetUrl: "/tournament-assets/free-roll.png",
      cardAssetUrl: "/tournament-assets/free-roll-card.png",
    });
  });

  it("original is 1254px with alpha; card derivative exists on disk at 512px with alpha", async () => {
    const original = await sharp(join(process.cwd(), "public/tournament-assets/free-roll.png")).metadata();
    expect({ w: original.width, h: original.height, alpha: original.hasAlpha }).toEqual({
      w: 1254,
      h: 1254,
      alpha: true,
    });
    const card = await sharp(join(process.cwd(), "public/tournament-assets/free-roll-card.png")).metadata();
    expect({ w: card.width, h: card.height, alpha: card.hasAlpha }).toEqual({ w: 512, h: 512, alpha: true });
  });
});
