import { describe, expect, it } from "vitest";
import {
  FINAL_MONTH_PRESET,
  presetToTournamentFields,
  tournamentToPreset,
  TOURNAMENT_PRESET_TEMPLATES,
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

describe("crazy_pineapple preset", () => {
  it("has a shared template with the exact product copy", () => {
    expect(TOURNAMENT_PRESET_TEMPLATES.crazy_pineapple).toEqual({
      title: "CRAZY PINEAPPLE",
      description:
        "Динамичный формат Hold’em с дополнительной картой на старте. Каждый игрок получает 3 закрытые карты вместо двух. Префлоп и флоп играются по правилам обычного Texas Hold’em, а после завершения торговли на флопе каждый оставшийся игрок обязан сбросить одну из трёх карманных карт. Терн и ривер проходят уже с двумя картами на руках, а итоговая комбинация составляется из лучших 5 доступных карт. Больше стартовых комбинаций, больше решений и больше экшена. Re-entry и Add-on увеличивают рейтинговый пул. Стартовый стек — 30 000 фишек. Add-on — 60 000 фишек.",
    });
  });

  it("presetToTournamentFields maps it straight through as a normal, non-final type", () => {
    expect(presetToTournamentFields("crazy_pineapple")).toEqual({
      tournament_type: "crazy_pineapple",
      is_final: false,
    });
  });

  it("tournamentToPreset maps a non-final crazy_pineapple tournament back to itself", () => {
    expect(
      tournamentToPreset({ tournament_type: "crazy_pineapple", is_final: false }),
    ).toBe("crazy_pineapple");
  });

  it("does not disturb the final_month preset mapping", () => {
    expect(presetToTournamentFields(FINAL_MONTH_PRESET)).toEqual({
      tournament_type: "classic",
      is_final: true,
    });
  });
});
