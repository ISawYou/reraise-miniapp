import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizePlacementPointsMultiplier,
  presetToTournamentFields,
  TOURNAMENT_PRESET_TEMPLATES,
  tournamentToPreset,
} from "@/config/tournament-presets";
import { getDefaultTournamentVisual, DEFAULT_TOURNAMENT_VISUALS } from "@/config/tournament-visuals";
import {
  getTournamentTypeBonusLines,
  getTournamentTypeInstructionLines,
  getTournamentTypeLabel,
  getTournamentTypeMultiplier,
  supportsMysteryBounty,
  supportsTournamentBossKnockouts,
  supportsTournamentKnockouts,
} from "@/lib/tournament-helpers";
import { V2_ONLY_TOURNAMENT_TYPES, VOLUME_FORMATS } from "@/features/rating-v2";
import type { TournamentType } from "@/types/domain";

describe("omaha_holdem_mix format", () => {
  it("is a real persisted preset and round-trips through create/edit", () => {
    const type: TournamentType = "omaha_holdem_mix";
    expect(presetToTournamentFields(type)).toEqual({
      tournament_type: type,
      is_final: false,
    });
    expect(tournamentToPreset({ tournament_type: type, is_final: false })).toBe(type);
    expect(TOURNAMENT_PRESET_TEMPLATES[type]).toMatchObject({
      title: "OMAHA / HOLD'EM MIX",
    });
    expect(TOURNAMENT_PRESET_TEMPLATES[type].description).toContain("ровно 2");
  });

  it("uses ordinary v2 volume rating with no bounty or multiplier mechanics", () => {
    expect(VOLUME_FORMATS.has("omaha_holdem_mix")).toBe(true);
    expect(V2_ONLY_TOURNAMENT_TYPES.has("omaha_holdem_mix")).toBe(true);
    expect(supportsTournamentKnockouts("omaha_holdem_mix")).toBe(false);
    expect(supportsTournamentBossKnockouts("omaha_holdem_mix")).toBe(false);
    expect(supportsMysteryBounty("omaha_holdem_mix")).toBe(false);
    expect(getTournamentTypeMultiplier("omaha_holdem_mix")).toBe(1);
    expect(getTournamentTypeBonusLines("omaha_holdem_mix")).toEqual([]);
    expect(normalizePlacementPointsMultiplier("omaha_holdem_mix", 2)).toBe(1);
  });

  it("publishes rules for the player-facing detail page", () => {
    expect(getTournamentTypeLabel("omaha_holdem_mix")).toBe("Omaha / Hold'em Mix");
    expect(getTournamentTypeInstructionLines("omaha_holdem_mix")).toEqual([
      "Уровень 1 — Texas Hold'em, уровень 2 — Pot-Limit Omaha; затем форматы чередуются на каждом уровне.",
      "Перерыв не меняет порядок чередования. Если текущий уровень или состояние часов неизвестны, ориентируйтесь на объявление дилера.",
      "В Omaha: 4 закрытые карты, ровно 2 из руки и ровно 3 с доски.",
    ]);
  });

  it("has a text-only visual fallback until approved artwork is supplied", () => {
    expect(DEFAULT_TOURNAMENT_VISUALS.omaha_holdem_mix).toBe("");
    expect(getDefaultTournamentVisual("omaha_holdem_mix").assetUrl).toBe("");
  });

  it("widens only the tournament type check in the additive migration", () => {
    const dir = join(process.cwd(), "lib/db/migrations");
    const file = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .find((name) => readFileSync(join(dir, name), "utf8").includes("'omaha_holdem_mix'"));
    expect(file).toBeDefined();
    const sql = readFileSync(join(dir, file!), "utf8");
    expect(sql).toContain('ADD CONSTRAINT "tournaments_tournament_type_check"');
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|DROP TABLE|DROP COLUMN|RENAME)\b/i);
  });
});
