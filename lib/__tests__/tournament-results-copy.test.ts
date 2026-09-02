import { describe, expect, it } from "vitest";
import { formatTournamentResultsForCopy } from "@/lib/tournament-results-copy";
import type { TournamentResult, TournamentType } from "@/types/domain";

function tournament(overrides: Partial<{ title: string; start_at: string; tournament_type: TournamentType }> = {}) {
  return {
    title: "CLASSIC",
    start_at: "2026-09-02T18:00:00.000Z",
    tournament_type: "classic" as TournamentType,
    ...overrides,
  };
}

function result(overrides: Partial<TournamentResult> = {}): TournamentResult {
  return {
    player_id: "p-id-should-never-appear",
    place: 1,
    knockouts: 0,
    boss_knockouts: 0,
    mystery_bounty_points: 0,
    reentries: 1,
    addons: 0,
    free_reentries: 0,
    rating_points: 50,
    username: "@should_never_appear",
    display_name: "Player",
    ...overrides,
  };
}

describe("formatTournamentResultsForCopy", () => {
  it("produces a compact header with title, date, and player count", () => {
    const text = formatTournamentResultsForCopy(
      tournament({ title: "CLASSIC", start_at: "2026-09-02T18:00:00.000Z" }),
      [result({ place: 1, display_name: "Player One", rating_points: 52 })]
    );

    expect(text).toContain("Турнир: CLASSIC");
    expect(text).toContain("Дата: 02.09.2026");
    expect(text).toContain("Игроков: 1");
  });

  it("formats a normal tournament's results with correct очко/очка/очков agreement", () => {
    const results = [
      result({ place: 1, display_name: "Player One", rating_points: 52 }),
      result({ place: 2, display_name: "Player Two", rating_points: 43 }),
      result({ place: 3, display_name: "Player Three", rating_points: 37 }),
    ];

    const text = formatTournamentResultsForCopy(tournament(), results);

    expect(text).toContain("1. Player One — 52 очка");
    expect(text).toContain("2. Player Two — 43 очка");
    expect(text).toContain("3. Player Three — 37 очков");
  });

  it("orders lines by the ALREADY PERSISTED place, not input array order or rating", () => {
    const results = [
      result({ place: 3, display_name: "Third", rating_points: 10 }),
      result({ place: 1, display_name: "First", rating_points: 5 }), // lower rating, better place
      result({ place: 2, display_name: "Second", rating_points: 20 }),
    ];

    const text = formatTournamentResultsForCopy(tournament(), results);
    const lines = text.split("\n").filter((l) => /^\d+\./.test(l));

    expect(lines).toEqual([
      "1. First — 5 очков",
      "2. Second — 20 очков",
      "3. Third — 10 очков",
    ]);
  });

  it("displays the persisted rating_points value exactly, never recalculated", () => {
    const text = formatTournamentResultsForCopy(tournament(), [
      result({ place: 1, display_name: "Player", rating_points: 123 }),
    ]);

    expect(text).toContain("— 123 очка");
  });

  it("shows ordinary KO when > 0 for a KO-supporting format (bounty)", () => {
    const text = formatTournamentResultsForCopy(
      tournament({ tournament_type: "bounty" }),
      [result({ place: 1, display_name: "Hunter", rating_points: 70, knockouts: 4 })]
    );

    expect(text).toContain("1. Hunter — 70 очков — KO: 4");
  });

  it("omits KO when it is exactly 0, even for a KO-supporting format", () => {
    const text = formatTournamentResultsForCopy(
      tournament({ tournament_type: "bounty" }),
      [result({ place: 1, display_name: "NoKO", rating_points: 30, knockouts: 0 })]
    );

    expect(text).not.toContain("KO:");
  });

  it("shows Boss KO when > 0 for Boss Bounty, alongside ordinary KO", () => {
    const text = formatTournamentResultsForCopy(
      tournament({ tournament_type: "boss_bounty" }),
      [result({ place: 1, display_name: "Boss Slayer", rating_points: 82, knockouts: 3, boss_knockouts: 1 })]
    );

    expect(text).toContain("1. Boss Slayer — 82 очка — KO: 3 — Boss KO: 1");
  });

  it("omits Boss KO when it is exactly 0, even for Boss Bounty", () => {
    const text = formatTournamentResultsForCopy(
      tournament({ tournament_type: "boss_bounty" }),
      [result({ place: 1, display_name: "Player", rating_points: 50, knockouts: 2, boss_knockouts: 0 })]
    );

    expect(text).toContain("KO: 2");
    expect(text).not.toContain("Boss KO:");
  });

  it("never prints KO/Boss KO for a format that doesn't support them (classic)", () => {
    const text = formatTournamentResultsForCopy(
      tournament({ tournament_type: "classic" }),
      // Even if a stray non-zero knockouts value exists on the row for a
      // non-KO format, the canonical helper decides relevance, not the raw
      // number.
      [result({ place: 1, display_name: "Player", rating_points: 50, knockouts: 3, boss_knockouts: 1 })]
    );

    expect(text).not.toContain("KO:");
    expect(text).not.toContain("Boss KO:");
  });

  it("shows Mystery Bounty points when > 0 for a mystery_bounty tournament", () => {
    const text = formatTournamentResultsForCopy(
      tournament({ tournament_type: "mystery_bounty" }),
      [result({ place: 1, display_name: "Lucky", rating_points: 60, mystery_bounty_points: 25 })]
    );

    expect(text).toContain("1. Lucky — 60 очков — Mystery Bounty: 25");
  });

  it("omits Mystery Bounty when 0, and never shows it for a non-mystery format", () => {
    const zeroMystery = formatTournamentResultsForCopy(
      tournament({ tournament_type: "mystery_bounty" }),
      [result({ place: 1, display_name: "Player", rating_points: 50, mystery_bounty_points: 0 })]
    );
    expect(zeroMystery).not.toContain("Mystery Bounty");

    const nonMysteryFormat = formatTournamentResultsForCopy(
      tournament({ tournament_type: "classic" }),
      [result({ place: 1, display_name: "Player", rating_points: 50, mystery_bounty_points: 40 })]
    );
    expect(nonMysteryFormat).not.toContain("Mystery Bounty");
  });

  it("includes ALL finishers, not just top-3/top-9", () => {
    const results = Array.from({ length: 24 }, (_, i) =>
      result({ place: i + 1, display_name: `Player ${i + 1}`, rating_points: 100 - i })
    );

    const text = formatTournamentResultsForCopy(tournament(), results);
    const lines = text.split("\n").filter((l) => /^\d+\./.test(l));

    expect(lines).toHaveLength(24);
    expect(text).toContain("24. Player 24");
  });

  it("contains no player-facing-unsafe data -- no player_id, telegram username, or other internal fields", () => {
    const text = formatTournamentResultsForCopy(tournament(), [
      result({
        place: 1,
        display_name: "Player",
        rating_points: 50,
        player_id: "11111111-2222-3333-4444-555555555555",
        username: "@leak_me_not",
      }),
    ]);

    expect(text).not.toContain("11111111-2222-3333-4444-555555555555");
    expect(text).not.toContain("@leak_me_not");
    expect(text).not.toContain("player_id");
    expect(text).not.toContain("username");
  });

  it("handles a long/unusual nickname as valid plain text without breaking formatting", () => {
    const weirdName = "🔥 Ver-y Long Nickname With — Dashes & \"Quotes\" 🎲".repeat(2);
    const text = formatTournamentResultsForCopy(tournament(), [
      result({ place: 1, display_name: weirdName, rating_points: 50 }),
    ]);

    expect(text).toContain(`1. ${weirdName} — 50 очков`);
    expect(typeof text).toBe("string");
  });

  it("handles a missing optional format-specific stat safely -- undefined boss_knockouts/mystery_bounty_points never crash or print as undefined/NaN", () => {
    const row = result({ place: 1, display_name: "Player", rating_points: 50, knockouts: 2 });
    delete (row as Partial<TournamentResult>).boss_knockouts;
    delete (row as Partial<TournamentResult>).mystery_bounty_points;

    const text = formatTournamentResultsForCopy(tournament({ tournament_type: "boss_bounty" }), [row]);

    expect(text).not.toContain("undefined");
    expect(text).not.toContain("NaN");
    expect(text).toContain("KO: 2");
  });

  it("never invents a place for malformed/missing place data, but still includes the player (ALL FINISHERS)", () => {
    const results = [
      result({ place: 1, display_name: "Valid First", rating_points: 50 }),
      // Malformed historical data: place 0, negative, or non-integer.
      result({ place: 0, display_name: "Broken Zero", rating_points: 10 }),
      result({ place: -1, display_name: "Broken Negative", rating_points: 5 }),
    ];

    const text = formatTournamentResultsForCopy(tournament(), results);

    expect(text).toContain("1. Valid First — 50 очков");
    expect(text).toContain("— Broken Zero — 10 очков");
    expect(text).toContain("— Broken Negative — 5 очков");
    // Never a fabricated "0." or "-1." place prefix.
    expect(text).not.toMatch(/^0\.\s/m);
    expect(text).not.toMatch(/^-1\.\s/m);
  });

  it("is a pure function -- never mutates the input results array or any result object", () => {
    const results = [result({ place: 2, display_name: "B" }), result({ place: 1, display_name: "A" })];
    const snapshot = results.map((r) => ({ ...r }));

    formatTournamentResultsForCopy(tournament(), results);

    expect(results).toEqual(snapshot);
  });

  it("is deterministic -- calling twice with the same input produces identical output", () => {
    const results = [result({ place: 1, display_name: "A", rating_points: 10 })];
    const t = tournament();

    expect(formatTournamentResultsForCopy(t, results)).toBe(formatTournamentResultsForCopy(t, results));
  });

  it("produces plain text, not HTML", () => {
    const text = formatTournamentResultsForCopy(tournament(), [result({ place: 1, display_name: "Player" })]);

    expect(text).not.toMatch(/<[a-z]+>/i);
  });
});
