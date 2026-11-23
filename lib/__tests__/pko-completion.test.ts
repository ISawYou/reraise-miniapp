import { describe, expect, it } from "vitest";
import { addPkoRatingPoints, validatePkoCompletion } from "../pko-completion";
import type { PkoEvent } from "../progressive-knockout-core";

const events: PkoEvent[] = [
  { kind: "entry", eventId: "e-a", entryId: "a1", playerId: "a" },
  { kind: "entry", eventId: "e-b", entryId: "b1", playerId: "b" },
  { kind: "knockout", eventId: "k-b", eliminatedEntryId: "b1", shares: [{ recipientEntryId: "a1", points: 6 }] },
  { kind: "entry", eventId: "e-b2", entryId: "b2", playerId: "b" },
  { kind: "knockout", eventId: "k-b2", eliminatedEntryId: "b2", shares: [{ recipientEntryId: "a1", points: 6 }] },
  { kind: "finish", eventId: "finish", winnerEntryId: "a1" },
];
const rows = [
  { player_id: "a", place: 1, arrived: true, entries: 1 },
  { player_id: "b", place: 2, arrived: true, entries: 2 },
];
const base = [
  { player_id: "a", rating_points: 25, participation_points: 2, itm_points: 23, knockout_points: 0, boss_bounty_points: 0, mystery_bounty_points: 0 },
  { player_id: "b", rating_points: 12, participation_points: 2, itm_points: 10, knockout_points: 0, boss_bounty_points: 0, mystery_bounty_points: 0 },
];
describe("PKO ledger frozen rating reconciliation", () => {
  it("reconciles physical entries and awards winner pool exactly once", () => {
    const allocation = validatePkoCompletion(rows, events);
    expect(allocation.snapshot).toMatchObject({ totalBountyCreated: 18, distributedRatingPoints: 18, outstandingBounty: 0 });
    expect(allocation.perPlayer.get("a")).toEqual({ points: 18, soloKnockouts: 2, entries: 1 });
    expect(allocation.perPlayer.get("b")).toEqual({ points: 0, soloKnockouts: 0, entries: 2 });
    expect(addPkoRatingPoints(base, allocation)[0]).toMatchObject({ rating_points: 43, knockout_points: 18, itm_points: 23 });
    expect(addPkoRatingPoints(base, allocation)[1]).toMatchObject({ rating_points: 12, knockout_points: 0 });
  });
  it("refuses to finish while any bounty is outstanding", () => {
    expect(() => validatePkoCompletion(rows, events.slice(0, -1))).toThrow(/завершите журнал/);
  });
  it("refuses mismatch between per-player total entries and event history", () => {
    expect(() => validatePkoCompletion([{ ...rows[0], entries: 2 }, rows[1]], events)).toThrow(/число входов/);
  });
  it("refuses a different winner in placements", () => {
    expect(() => validatePkoCompletion([{ ...rows[0], place: 2 }, { ...rows[1], place: 1 }], events)).toThrow(/первое место/);
  });
  it("rejects entries from absent players", () => {
    expect(() => validatePkoCompletion([{ ...rows[0], arrived: false }, rows[1]], events)).toThrow(/отсутствующего/);
  });
  it("rejects a ledger player not in official results", () => {
    expect(() => validatePkoCompletion([rows[0]], events)).toThrow(/вне официального состава/);
  });
  it("does not invent numeric shared KO counts, but keeps their points", () => {
    const split: PkoEvent[] = [
      { kind: "entry", eventId: "1", entryId: "a", playerId: "a" },
      { kind: "entry", eventId: "2", entryId: "b", playerId: "b" },
      { kind: "entry", eventId: "3", entryId: "c", playerId: "c" },
      { kind: "knockout", eventId: "4", eliminatedEntryId: "c", shares: [{ recipientEntryId: "a", points: 3 }, { recipientEntryId: "b", points: 3 }] },
      { kind: "knockout", eventId: "5", eliminatedEntryId: "b", shares: [{ recipientEntryId: "a", points: 8 }] },
      { kind: "finish", eventId: "6", winnerEntryId: "a" },
    ];
    const x = validatePkoCompletion([
      { player_id: "a", place: 1, arrived: true, entries: 1 },
      { player_id: "b", place: 2, arrived: true, entries: 1 },
      { player_id: "c", place: 3, arrived: true, entries: 1 },
    ], split);
    expect(x.perPlayer.get("a")?.soloKnockouts).toBe(1);
    expect(x.perPlayer.get("b")?.soloKnockouts).toBe(0);
    expect(x.snapshot.distributedRatingPoints).toBe(18);
  });
});
