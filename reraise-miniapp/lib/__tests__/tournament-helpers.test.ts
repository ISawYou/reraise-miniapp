import { describe, expect, it } from "vitest";
import {
  getExpectedPrizePlaces,
  getRegistrationStatus,
  getTournamentKindGradient,
  getTournamentKindLabel,
  getTournamentTypeBonusLines,
  getTournamentTypeLabel,
  getTournamentTypeMultiplier,
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
    expect(getTournamentTypeLabel("win_the_button")).toBe("Win The Button");
  });

  it("returns correct multipliers", () => {
    expect(getTournamentTypeMultiplier("classic")).toBe(1);
    expect(getTournamentTypeMultiplier("phoenix")).toBe(1.2);
  });

  it("detects knockout formats", () => {
    expect(supportsTournamentKnockouts("bounty")).toBe(true);
    expect(supportsTournamentKnockouts("classic")).toBe(false);
  });

  it("returns compact bonus lines", () => {
    expect(getTournamentTypeBonusLines("phoenix")).toEqual(["Бонус рейтинга x1.20"]);
    expect(getTournamentTypeBonusLines("bounty")).toEqual(["Нокауты: +5 очков"]);
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
