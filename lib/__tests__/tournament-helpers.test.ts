import { describe, expect, it } from "vitest";
import {
  getExpectedPrizePlaces,
  getRegistrationStatus,
  getTournamentKindGradient,
  getTournamentKindLabel,
  getTournamentTypeBonusLines,
  getTournamentTypeLabel,
  getTournamentTypeMultiplier,
  sortParticipantsByRating,
  supportsTournamentKnockouts,
} from "@/lib/tournament-helpers";

describe("getTournamentKindLabel", () => {
  it('returns "Платный" for paid', () => {
    expect(getTournamentKindLabel("paid")).toBe("Платный");
  });

  it('returns "Кэш" for cash', () => {
    expect(getTournamentKindLabel("cash")).toBe("Кэш");
  });

  it('returns "Бесплатный" for free', () => {
    expect(getTournamentKindLabel("free")).toBe("Бесплатный");
  });
});

describe("getTournamentKindGradient", () => {
  it('contains "amber" for paid', () => {
    expect(getTournamentKindGradient("paid")).toContain("amber");
  });

  it('contains "cyan" for cash', () => {
    expect(getTournamentKindGradient("cash")).toContain("cyan");
  });

  it('contains "emerald" for free', () => {
    expect(getTournamentKindGradient("free")).toContain("emerald");
  });
});

describe("getRegistrationStatus", () => {
  it('returns "registered" when slots available', () => {
    expect(getRegistrationStatus(5, 10)).toBe("registered");
  });

  it('returns "waitlist" when slots exactly full', () => {
    expect(getRegistrationStatus(10, 10)).toBe("waitlist");
  });
});

describe("tournament type helpers", () => {
  it("returns correct labels", () => {
    expect(getTournamentTypeLabel("classic")).toBe("Texas Classic");
    expect(getTournamentTypeLabel("boss_bounty")).toBe("Boss Bounty");
    expect(getTournamentTypeLabel("win_the_button")).toBe("Win The Button");
  });

  it("returns correct multipliers", () => {
    expect(getTournamentTypeMultiplier("classic")).toBe(1);
    expect(getTournamentTypeMultiplier("phoenix")).toBe(1.2);
  });

  it("detects knockout formats", () => {
    expect(supportsTournamentKnockouts("bounty")).toBe(true);
    expect(supportsTournamentKnockouts("boss_bounty")).toBe(true);
    expect(supportsTournamentKnockouts("classic")).toBe(false);
  });

  it("returns compact bonus lines", () => {
    expect(getTournamentTypeBonusLines("phoenix")).toEqual(["Бонус рейтинга x1.20"]);
    expect(getTournamentTypeBonusLines("bounty")).toEqual(["Нокауты: +5 очков"]);
    expect(getTournamentTypeBonusLines("boss_bounty")).toEqual([
      "Нокауты: +5 очков",
      "Boss-нокауты: +10 очков",
    ]);
  });
});

describe("sortParticipantsByRating", () => {
  function participant(id: string, rating: number) {
    return { registration_id: id, rating };
  }

  it("sorts descending by rating", () => {
    const input = [participant("a", 10), participant("b", 30), participant("c", 20)];

    expect(sortParticipantsByRating(input).map((p) => p.registration_id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("preserves original registration order for tied ratings", () => {
    const input = [
      participant("first", 50),
      participant("second", 50),
      participant("third", 50),
    ];

    expect(sortParticipantsByRating(input).map((p) => p.registration_id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("puts zero/no-rating participants after everyone with positive rating", () => {
    const input = [
      participant("zero-1", 0),
      participant("scored", 15),
      participant("zero-2", 0),
    ];

    expect(sortParticipantsByRating(input).map((p) => p.registration_id)).toEqual([
      "scored",
      "zero-1",
      "zero-2",
    ]);
  });

  it("does not mutate the input array (display-only, never touches registration order)", () => {
    const input = [participant("a", 1), participant("b", 2)];
    const original = [...input];

    sortParticipantsByRating(input);

    expect(input).toEqual(original);
  });

  it("sorts a player marked out-of-competition by their raw points like anyone else", () => {
    // "Вне зачёта" eligibility is a separate flag entirely -- this helper
    // only ever sees each participant's raw current-season rating number,
    // the same field every row already displays, so an out-of-competition
    // player with real points sorts normally instead of being pushed down.
    const input = [
      participant("eligible-low", 5),
      participant("out-of-competition-high", 40),
    ];

    expect(sortParticipantsByRating(input).map((p) => p.registration_id)).toEqual([
      "out-of-competition-high",
      "eligible-low",
    ]);
  });
});

describe("getExpectedPrizePlaces", () => {
  it("handles edge cases", () => {
    expect(getExpectedPrizePlaces(0)).toBe(0);
    expect(getExpectedPrizePlaces(1)).toBe(1);
    expect(getExpectedPrizePlaces(2)).toBe(2);
    expect(getExpectedPrizePlaces(10)).toBe(3);
    expect(getExpectedPrizePlaces(11)).toBe(4);
  });
});
