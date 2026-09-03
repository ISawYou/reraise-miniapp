import { describe, expect, it } from "vitest";
import {
  FINAL_MONTH_PRESET,
  presetToTournamentFields,
  tournamentToPreset,
} from "@/config/tournament-presets";

describe("presetToTournamentFields", () => {
  it("maps final_month -> tournament_type=classic, is_final=true", () => {
    expect(presetToTournamentFields(FINAL_MONTH_PRESET)).toEqual({
      tournament_type: "classic",
      is_final: true,
    });
  });

  it("maps a normal type straight through with is_final=false", () => {
    expect(presetToTournamentFields("phoenix")).toEqual({
      tournament_type: "phoenix",
      is_final: false,
    });
  });

  it("classic (the normal option) and final_month never collide on the same fields", () => {
    expect(presetToTournamentFields("classic")).toEqual({
      tournament_type: "classic",
      is_final: false,
    });
    expect(presetToTournamentFields(FINAL_MONTH_PRESET)).toEqual({
      tournament_type: "classic",
      is_final: true,
    });
  });
});

describe("tournamentToPreset -- inverse mapping for loading the edit form", () => {
  it("an is_final tournament always maps back to final_month, regardless of its persisted tournament_type", () => {
    expect(tournamentToPreset({ tournament_type: "classic", is_final: true })).toBe(
      FINAL_MONTH_PRESET,
    );
  });

  it("a normal tournament maps back to its own tournament_type", () => {
    expect(tournamentToPreset({ tournament_type: "bounty", is_final: false })).toBe("bounty");
  });
});
