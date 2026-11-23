import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOURNAMENT_CARD_VISUALS,
  DEFAULT_TOURNAMENT_VISUALS,
  getDefaultTournamentVisual,
  isTournamentVisualType,
  TOURNAMENT_VISUAL_TYPES,
} from "@/config/tournament-visuals";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngDimensions(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  expect(buf.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const ALL_TOURNAMENT_TYPES = [
  "qualification_final",
  "classic",
  "phoenix",
  "deep_stack",
  "bounty",
  "boss_bounty",
  "win_the_button",
  "mystery_bounty",
  "crazy_pineapple",
  "bomb_pot",
  "boost_rating",
  "free_roll",
  "omaha_holdem_mix",
];

describe("13 tournament visual types", () => {
  it("recognizes exactly the 13 current TournamentType visual entries", () => {
    expect(TOURNAMENT_VISUAL_TYPES.slice().sort()).toEqual(ALL_TOURNAMENT_TYPES.slice().sort());
    expect(TOURNAMENT_VISUAL_TYPES).toHaveLength(13);
  });

  it("crazy_pineapple remains recognized as a valid tournament visual type", () => {
    expect(isTournamentVisualType("crazy_pineapple")).toBe(true);
  });
});

describe("crazy_pineapple default artwork", () => {
  it("resolves to /tournament-assets/pineapple.png", () => {
    expect(DEFAULT_TOURNAMENT_VISUALS.crazy_pineapple).toBe(
      "/tournament-assets/pineapple.png",
    );
    expect(getDefaultTournamentVisual("crazy_pineapple").assetUrl).toBe(
      "/tournament-assets/pineapple.png",
    );
  });

  it("is recognized as a valid tournament visual type (admin visual surface derives from this)", () => {
    expect(TOURNAMENT_VISUAL_TYPES).toContain("crazy_pineapple");
    expect(isTournamentVisualType("crazy_pineapple")).toBe(true);
  });

  it("the supplied PNG exists at the built-in artwork location and is a valid PNG", () => {
    const bytes = readFileSync(
      join(process.cwd(), "public/tournament-assets/pineapple.png"),
    );
    // PNG magic number: 89 50 4E 47 0D 0A 1A 0A
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it("the original remains 1024x1024, untouched by derivative generation", () => {
    const { width, height } = pngDimensions(
      join(process.cwd(), "public/tournament-assets/pineapple.png"),
    );
    expect(width).toBe(1024);
    expect(height).toBe(1024);
  });
});

describe("crazy_pineapple built-in 512px card derivative (Phase 2B.2)", () => {
  it("pineapple-card.png exists and is a valid 512x512 PNG", () => {
    const { width, height } = pngDimensions(
      join(process.cwd(), "public/tournament-assets/pineapple-card.png"),
    );
    expect(width).toBe(512);
    expect(height).toBe(512);
  });

  it("DEFAULT_TOURNAMENT_CARD_VISUALS maps crazy_pineapple to pineapple-card.png", () => {
    expect(DEFAULT_TOURNAMENT_CARD_VISUALS.crazy_pineapple).toBe(
      "/tournament-assets/pineapple-card.png",
    );
  });

  it("does NOT invent card entries for the seven legacy types with no committed original", () => {
    const legacyTypes = [
      "classic",
      "bounty",
      "boss_bounty",
      "win_the_button",
      "deep_stack",
      "mystery_bounty",
      "phoenix",
    ] as const;
    for (const type of legacyTypes) {
      expect(DEFAULT_TOURNAMENT_CARD_VISUALS[type]).toBeUndefined();
    }
  });

  it('getDefaultTournamentVisual("crazy_pineapple") returns the exact original+card pair, unchanged geometry', () => {
    const config = getDefaultTournamentVisual("crazy_pineapple");
    expect(config).toEqual({
      tournamentType: "crazy_pineapple",
      assetUrl: "/tournament-assets/pineapple.png",
      cardAssetUrl: "/tournament-assets/pineapple-card.png",
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      opacity: 100,
    });
  });

  it("getDefaultTournamentVisual for a legacy type has no cardAssetUrl key at all", () => {
    const config = getDefaultTournamentVisual("classic");
    expect(config.cardAssetUrl).toBeUndefined();
    expect("cardAssetUrl" in config).toBe(false);
  });

  it("the card derivative is meaningfully smaller than the original", () => {
    const originalSize = readFileSync(
      join(process.cwd(), "public/tournament-assets/pineapple.png"),
    ).length;
    const cardSize = readFileSync(
      join(process.cwd(), "public/tournament-assets/pineapple-card.png"),
    ).length;
    expect(cardSize).toBeLessThan(originalSize);
  });
});

describe("Omaha / Hold'em Mix approved artwork", () => {
  it("ships the 1024px original and 512px card derivative", () => {
    expect(DEFAULT_TOURNAMENT_VISUALS.omaha_holdem_mix).toBe("/tournament-assets/omaha-holdem-mix.png");
    expect(DEFAULT_TOURNAMENT_CARD_VISUALS.omaha_holdem_mix).toBe("/tournament-assets/omaha-holdem-mix-card.png");
    expect(pngDimensions(join(process.cwd(), "public/tournament-assets/omaha-holdem-mix.png"))).toEqual({ width: 1024, height: 1024 });
    expect(pngDimensions(join(process.cwd(), "public/tournament-assets/omaha-holdem-mix-card.png"))).toEqual({ width: 512, height: 512 });
  });
});

describe("Progressive Knockout artwork preparation", () => {
  it("ships approved assets without adding an unfinished TournamentType mapping", () => {
    expect(pngDimensions(join(process.cwd(), "public/tournament-assets/progressive-knockout.png"))).toEqual({ width: 1024, height: 1024 });
    expect(pngDimensions(join(process.cwd(), "public/tournament-assets/progressive-knockout-card.png"))).toEqual({ width: 512, height: 512 });
    expect(TOURNAMENT_VISUAL_TYPES).not.toContain("progressive_knockout");
  });
});
