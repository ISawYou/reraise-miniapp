import { describe, expect, it } from "vitest";
import { FAMILY_METRIC, LEGENDARY_METRIC, HOLDERS_ONLY_CODES } from "@/lib/achievement-statistics-mapping";
import { CLUB_STATISTIC_METRIC } from "@/lib/club-statistics-metrics";

describe("FAMILY_METRIC -- achievement family maps to the correct club statistic", () => {
  it("In Game -> tournaments_played", () => {
    expect(FAMILY_METRIC.in_game).toBe(CLUB_STATISTIC_METRIC.TOURNAMENTS_PLAYED);
  });
  it("Triumphator -> wins", () => {
    expect(FAMILY_METRIC.triumphator).toBe(CLUB_STATISTIC_METRIC.WINS);
  });
  it("Player Path -> lifetime_rating", () => {
    expect(FAMILY_METRIC.player_path).toBe(CLUB_STATISTIC_METRIC.LIFETIME_RATING);
  });
  it("ITM -> itm", () => {
    expect(FAMILY_METRIC.itm).toBe(CLUB_STATISTIC_METRIC.ITM);
  });
  it("Community -> referrals", () => {
    expect(FAMILY_METRIC.community).toBe(CLUB_STATISTIC_METRIC.REFERRALS);
  });
  it("Terminator -> knockouts", () => {
    expect(FAMILY_METRIC.terminator).toBe(CLUB_STATISTIC_METRIC.KNOCKOUTS);
  });
  it("Boss Hunter -> boss_knockouts", () => {
    expect(FAMILY_METRIC.boss_hunter).toBe(CLUB_STATISTIC_METRIC.BOSS_KNOCKOUTS);
  });
  it("Streak has no mapping in C1 -- deferred to a follow-up release", () => {
    expect(FAMILY_METRIC.streak).toBeUndefined();
  });
});

describe("LEGENDARY_METRIC -- legendary achievement code mapping", () => {
  it("Headhunter -> headhunter", () => {
    expect(LEGENDARY_METRIC.headhunter).toBe(CLUB_STATISTIC_METRIC.HEADHUNTER);
  });
  it("Bubble Boy (marco_reus) has no mapping in C1 -- deferred to a follow-up release", () => {
    expect(LEGENDARY_METRIC.marco_reus).toBeUndefined();
  });
  it("Royal Flush and Number One have no ranked metric (holders-only instead)", () => {
    expect(LEGENDARY_METRIC.royal_flush).toBeUndefined();
    expect(LEGENDARY_METRIC.number_one).toBeUndefined();
  });
});

describe("HOLDERS_ONLY_CODES -- MANUAL/event achievements get a simple ownership list, never a fabricated ranking", () => {
  it("contains exactly royal_flush and number_one", () => {
    expect(HOLDERS_ONLY_CODES.has("royal_flush")).toBe(true);
    expect(HOLDERS_ONLY_CODES.has("number_one")).toBe(true);
    expect(HOLDERS_ONLY_CODES.size).toBe(2);
  });

  it("does not include any metric-covered family or legendary code", () => {
    for (const metric of Object.values(FAMILY_METRIC)) {
      expect(metric).toBeTruthy();
    }
    expect(HOLDERS_ONLY_CODES.has("headhunter")).toBe(false);
  });
});
