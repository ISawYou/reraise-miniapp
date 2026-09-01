import { describe, expect, it } from "vitest";
import {
  getExpectedPrizePlaces,
  getRegistrationStatus,
  getTournamentKindGradient,
  getTournamentKindLabel,
  getTournamentTypeBonusLines,
  getTournamentTypeLabel,
  getTournamentTypeMultiplier,
  sortActivePlayersByRating,
  sortEliminatedPlayersByPlace,
  sortParticipantsByRating,
  splitTournamentLiveRoster,
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

describe("sortActivePlayersByRating", () => {
  function player(playerId: string, rating: number | null, displayName = playerId) {
    return { playerId, displayName, rating };
  }

  it("sorts descending by rating (rating.ratingPoints field), same primary key as sortParticipantsByRating", () => {
    const input = [player("a", 10), player("b", 30), player("c", 20)];

    expect(sortActivePlayersByRating(input).map((p) => p.playerId)).toEqual(["b", "c", "a"]);
  });

  it("does not modify/mutate any player's rating data -- pure display ordering", () => {
    const input = [player("a", 10), player("b", 30)];
    const snapshot = input.map((p) => ({ ...p }));

    sortActivePlayersByRating(input);

    expect(input).toEqual(snapshot);
  });

  it("tied ratings resolve deterministically by display_name, then player_id", () => {
    const input = [
      player("z-id", 50, "Same Name"),
      player("a-id", 50, "Same Name"),
      player("m-id", 50, "Abby"),
    ];

    // "Abby" < "Same Name" alphabetically; the two "Same Name" ties then
    // resolve by player_id ("a-id" < "z-id").
    expect(sortActivePlayersByRating(input).map((p) => p.playerId)).toEqual([
      "m-id",
      "a-id",
      "z-id",
    ]);
  });

  it("treats null rating (no season) as lowest -- sorts after every positive rating", () => {
    const input = [player("no-rating", null), player("scored", 5)];

    expect(sortActivePlayersByRating(input).map((p) => p.playerId)).toEqual([
      "scored",
      "no-rating",
    ]);
  });

  it("null rating (no season) and a real zero rating (season, no results yet) tie -- same as any other equal rating, resolved by the same deterministic tie-break", () => {
    const input = [player("no-rating", null, "Zed"), player("zero", 0, "Abby")];

    expect(sortActivePlayersByRating(input).map((p) => p.playerId)).toEqual([
      "zero",
      "no-rating",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [player("a", 1), player("b", 2)];
    const original = [...input];

    sortActivePlayersByRating(input);

    expect(input).toEqual(original);
  });
});

describe("sortEliminatedPlayersByPlace", () => {
  function player(playerId: string, place: number | null) {
    return { playerId, place };
  }

  it("sorts ascending by canonical numeric place (best/latest finish first)", () => {
    const input = [player("p1", 12), player("p2", 3), player("p3", 7)];

    expect(sortEliminatedPlayersByPlace(input).map((p) => p.playerId)).toEqual([
      "p2",
      "p3",
      "p1",
    ]);
  });

  it("a null place (canonical place temporarily unavailable) sorts after every known place", () => {
    const input = [player("unknown", null), player("known-2nd", 2), player("known-1st", 1)];

    expect(sortEliminatedPlayersByPlace(input).map((p) => p.playerId)).toEqual([
      "known-1st",
      "known-2nd",
      "unknown",
    ]);
  });

  it("multiple null-place rows all go last, order among themselves is stable", () => {
    const input = [player("null-a", null), player("known", 5), player("null-b", null)];

    expect(sortEliminatedPlayersByPlace(input).map((p) => p.playerId)).toEqual([
      "known",
      "null-a",
      "null-b",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [player("a", 2), player("b", 1)];
    const original = [...input];

    sortEliminatedPlayersByPlace(input);

    expect(input).toEqual(original);
  });
});

describe("splitTournamentLiveRoster", () => {
  function livePlayer(
    playerId: string,
    overrides: Partial<{
      eliminated: boolean;
      rating: number | null;
      place: number | null;
      displayName: string;
    }> = {}
  ) {
    return {
      playerId,
      displayName: overrides.displayName ?? playerId,
      eliminated: overrides.eliminated ?? false,
      rating: overrides.rating ?? 0,
      place: overrides.place ?? null,
    };
  }

  it('"В игре" contains only arrived && !eliminated players', () => {
    const roster = [
      livePlayer("still-in", { eliminated: false }),
      livePlayer("busted", { eliminated: true, place: 5 }),
    ];

    const { active } = splitTournamentLiveRoster(roster);

    expect(active.map((p) => p.playerId)).toEqual(["still-in"]);
  });

  it('"Выбыли" contains only arrived && eliminated players', () => {
    const roster = [
      livePlayer("still-in", { eliminated: false }),
      livePlayer("busted", { eliminated: true, place: 5 }),
    ];

    const { eliminated } = splitTournamentLiveRoster(roster);

    expect(eliminated.map((p) => p.playerId)).toEqual(["busted"]);
  });

  it("a non-arrived player is never shown as active -- the roster passed in never contains one in the first place (getActiveTournamentPlayersForPublicView only ever returns arrived players)", () => {
    // Every row this function receives is arrived by construction -- there
    // is no `arrived` field to filter on here at all. Simulates the
    // guarantee by simply never including a non-arrived row, same as the
    // real upstream data never would.
    const roster = [livePlayer("arrived-only", { eliminated: false })];

    const { active } = splitTournamentLiveRoster(roster);

    expect(active).toHaveLength(1);
  });

  it("active section is sorted by rating descending (delegates to sortActivePlayersByRating, not a second formula)", () => {
    const roster = [
      livePlayer("low", { rating: 5 }),
      livePlayer("high", { rating: 50 }),
    ];

    const { active } = splitTournamentLiveRoster(roster);

    expect(active.map((p) => p.playerId)).toEqual(["high", "low"]);
  });

  it("eliminated section is sorted by numeric place ascending, null place last (delegates to sortEliminatedPlayersByPlace)", () => {
    const roster = [
      livePlayer("unknown", { eliminated: true, place: null }),
      livePlayer("worse", { eliminated: true, place: 10 }),
      livePlayer("best", { eliminated: true, place: 1 }),
    ];

    const { eliminated } = splitTournamentLiveRoster(roster);

    expect(eliminated.map((p) => p.playerId)).toEqual(["best", "worse", "unknown"]);
  });

  it("un-elimination (eliminated: true -> false) moves a player from the eliminated section back into active on the next split", () => {
    const beforeUndo = [livePlayer("p1", { eliminated: true, place: 3 })];
    expect(splitTournamentLiveRoster(beforeUndo).eliminated.map((p) => p.playerId)).toEqual(["p1"]);
    expect(splitTournamentLiveRoster(beforeUndo).active).toHaveLength(0);

    // Admin corrected the elimination -- the exact same roster shape, just
    // one field flipped, same as a later poll would deliver.
    const afterUndo = [{ ...beforeUndo[0], eliminated: false, place: null }];
    expect(splitTournamentLiveRoster(afterUndo).active.map((p) => p.playerId)).toEqual(["p1"]);
    expect(splitTournamentLiveRoster(afterUndo).eliminated).toHaveLength(0);
  });

  it("does not mutate the input array or any player object", () => {
    const roster = [livePlayer("a", { eliminated: false }), livePlayer("b", { eliminated: true, place: 1 })];
    const snapshot = roster.map((p) => ({ ...p }));

    splitTournamentLiveRoster(roster);

    expect(roster).toEqual(snapshot);
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
