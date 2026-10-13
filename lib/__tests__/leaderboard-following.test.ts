import { describe, expect, it } from "vitest";
import { filterFollowingStandings } from "@/lib/leaderboard-following";

// The "Подписки" filter is pure: it only narrows the already computed
// official standings. The rule that matters most: official ranks are attached
// BEFORE filtering, so a player's number never depends on who is followed.

type Row = { player_id: string; display_name: string; rating: number };

const row = (id: string, rating = 100): Row => ({ player_id: id, display_name: id, rating });

// An official season: Alice #1, Bob #2, Carol #3, Dave #4, Erin #5, Frank #6, Grace #7.
const SEASON = ["alice", "bob", "carol", "dave", "erin", "frank", "grace"].map((id, i) => row(id, 700 - i * 50));
const OOC = [row("oscar", 410), row("olga", 300)];

const ranks = (result: ReturnType<typeof filterFollowingStandings<Row>>) =>
  result.ranked.map(({ row: r, rank }) => `${r.player_id}:${rank}`);

describe("filterFollowingStandings", () => {
  it("1. current player only, no follows -> just the viewer, at their official rank", () => {
    const result = filterFollowingStandings(SEASON, OOC, "erin", new Set());

    expect(ranks(result)).toEqual(["erin:5"]);
    expect(result.outOfCompetition).toEqual([]);
  });

  it("2. me + one followed ranked player", () => {
    const result = filterFollowingStandings(SEASON, OOC, "erin", new Set(["bob"]));

    expect(ranks(result)).toEqual(["bob:2", "erin:5"]);
  });

  it("3. several followed players", () => {
    const result = filterFollowingStandings(SEASON, OOC, "erin", new Set(["alice", "dave", "grace"]));

    expect(ranks(result)).toEqual(["alice:1", "dave:4", "erin:5", "grace:7"]);
  });

  it("4. unrelated players are excluded", () => {
    const result = filterFollowingStandings(SEASON, OOC, "erin", new Set(["bob"]));

    const ids = result.ranked.map(({ row: r }) => r.player_id);
    expect(ids).not.toContain("carol");
    expect(ids).not.toContain("alice");
  });

  it("5. the original row order is preserved (not re-sorted by anything)", () => {
    // Followed ids supplied in a scrambled order; output follows the standings.
    const result = filterFollowingStandings(SEASON, OOC, "frank", ["grace", "alice", "carol"]);

    expect(result.ranked.map(({ row: r }) => r.player_id)).toEqual(["alice", "carol", "frank", "grace"]);
  });

  it("6. official ranks are preserved, never renumbered inside the subset (#2 and #7 stay #2 and #7)", () => {
    const result = filterFollowingStandings(SEASON, OOC, "nobody-ranked", new Set(["bob", "grace"]));

    expect(ranks(result)).toEqual(["bob:2", "grace:7"]);
    // The subset numbering (1, 2) must never appear.
    expect(result.ranked.map(({ rank }) => rank)).not.toEqual([1, 2]);
  });

  it("6b. a rank gap is kept: following #1 and #6 yields #1 and #6", () => {
    const result = filterFollowingStandings(SEASON, [], "zed", new Set(["alice", "frank"]));

    expect(result.ranked.map(({ rank }) => rank)).toEqual([1, 6]);
  });

  it("7. the current player is included even though they are not in the followed ids", () => {
    const result = filterFollowingStandings(SEASON, OOC, "carol", new Set(["bob"]));

    expect(ranks(result)).toEqual(["bob:2", "carol:3"]);
  });

  it("8. a followed out-of-competition player is included, rank-less, in original order", () => {
    const result = filterFollowingStandings(SEASON, OOC, "erin", new Set(["olga", "oscar"]));

    expect(result.outOfCompetition.map((r) => r.player_id)).toEqual(["oscar", "olga"]);
    // OOC players never get a ranked entry or a number.
    expect(result.ranked.map(({ row: r }) => r.player_id)).toEqual(["erin"]);
  });

  it("9. an unrelated out-of-competition player is excluded", () => {
    const result = filterFollowingStandings(SEASON, OOC, "erin", new Set(["oscar"]));

    expect(result.outOfCompetition.map((r) => r.player_id)).toEqual(["oscar"]);
  });

  it("10. the current player is included when they are out of competition", () => {
    const result = filterFollowingStandings(SEASON, OOC, "olga", new Set());

    expect(result.ranked).toEqual([]);
    expect(result.outOfCompetition.map((r) => r.player_id)).toEqual(["olga"]);
  });

  it("11. more than 50 followed ids work, and a player beyond the first 50 is still included", () => {
    const many = Array.from({ length: 120 }, (_, i) => `player-${i + 1}`);
    const season = many.map((id, i) => row(id, 1000 - i));
    // Follow all 120; the 117th id is far past any 50-item page.
    const result = filterFollowingStandings(season, [], "viewer-not-ranked", new Set(many));

    expect(result.ranked).toHaveLength(120);
    expect(result.ranked.find(({ row: r }) => r.player_id === "player-117")?.rank).toBe(117);
  });

  it("11b. accepts a plain array of ids as well as a Set", () => {
    expect(ranks(filterFollowingStandings(SEASON, OOC, "zed", ["bob"]))).toEqual(["bob:2"]);
    expect(ranks(filterFollowingStandings(SEASON, OOC, "zed", new Set(["bob"])))).toEqual(["bob:2"]);
  });

  it("12. does not mutate or reorder its inputs", () => {
    const season = SEASON.map((r) => ({ ...r }));
    const ooc = OOC.map((r) => ({ ...r }));
    const ids = new Set(["grace", "bob"]);
    const before = JSON.stringify({ season, ooc, ids: [...ids] });

    const result = filterFollowingStandings(season, ooc, "erin", ids);

    expect(JSON.stringify({ season, ooc, ids: [...ids] })).toBe(before);
    // Output rows are the SAME objects (so e.g. rankMovement stays attached).
    expect(result.ranked[0].row).toBe(season[1]);
    expect(result.ranked).not.toBe(season);
  });

  it("13. an empty leaderboard gives an empty result", () => {
    const result = filterFollowingStandings([], [], "erin", new Set(["bob"]));

    expect(result).toEqual({ ranked: [], outOfCompetition: [] });
  });

  it("14. anonymous (null current player): only followed players, never an accidental match on null", () => {
    expect(ranks(filterFollowingStandings(SEASON, OOC, null, new Set(["bob"])))).toEqual(["bob:2"]);
    expect(filterFollowingStandings(SEASON, OOC, null, new Set())).toEqual({ ranked: [], outOfCompetition: [] });
  });

  it("a followed player with no season row simply does not appear (no zero-rating row is invented)", () => {
    const result = filterFollowingStandings(SEASON, OOC, "erin", new Set(["no-results-yet"]));

    expect(ranks(result)).toEqual(["erin:5"]);
  });

  it("keeps extra row fields such as rankMovement attached to the right player", () => {
    const season = [
      { ...row("a"), rankMovement: { type: "up", places: 2 } },
      { ...row("b"), rankMovement: { type: "down", places: 1 } },
      { ...row("c"), rankMovement: { type: "same" } },
    ];

    const result = filterFollowingStandings(season, [], "zed", new Set(["b", "c"]));

    expect(result.ranked.map(({ row: r, rank }) => [r.player_id, rank, r.rankMovement.type])).toEqual([
      ["b", 2, "down"],
      ["c", 3, "same"],
    ]);
  });
});
