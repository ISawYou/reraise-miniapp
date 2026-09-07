import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOURNAMENT_VISUALS,
  getDefaultTournamentVisual,
  isTournamentVisualType,
  TOURNAMENT_VISUAL_TYPES,
} from "@/config/tournament-visuals";

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
});
