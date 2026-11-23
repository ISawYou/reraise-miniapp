import { describe, expect, it } from "vitest";
import {
  PKO_STARTING_BOUNTY,
  replayPkoEvents,
  splitPkoBounty,
  parsePkoEvent,
  type PkoEvent,
} from "../progressive-knockout-core";

const entry = (entryId: string, playerId = entryId): PkoEvent => ({
  kind: "entry", eventId: "enter:" + entryId, entryId, playerId,
});

const ko = (eventId: string, eliminatedEntryId: string, recipientEntryId: string, points: number): PkoEvent => ({
  kind: "knockout", eventId, eliminatedEntryId, shares: [{ recipientEntryId, points }],
});

describe("pure PKO accounting (intentionally not wired to production)", () => {
  it("mints six points per entry and splits floor/ceil on each KO share", () => {
    expect(PKO_STARTING_BOUNTY).toBe(6);
    expect(splitPkoBounty(6)).toEqual({ earnedPoints: 3, growingBounty: 3 });
    expect(splitPkoBounty(9)).toEqual({ earnedPoints: 4, growingBounty: 5 });
    expect(splitPkoBounty(13)).toEqual({ earnedPoints: 6, growingBounty: 7 });
    expect(splitPkoBounty(27)).toEqual({ earnedPoints: 13, growingBounty: 14 });
  });

  it("awards surviving bounty once and preserves the entire pool", () => {
    const x = replayPkoEvents([
      entry("a"), entry("b"), ko("k1", "b", "a", 6),
      { kind: "finish", eventId: "f1", winnerEntryId: "a" },
    ]);
    expect(x).toMatchObject({
      totalBountyCreated: 12, outstandingBounty: 0,
      distributedRatingPoints: 12, finished: true,
    });
    expect(x.players.find(p => p.playerId === "a")).toMatchObject({
      earnedKoPoints: 3, winnerBountyPoints: 9, totalPkoRatingPoints: 12,
    });
  });

  it("requires explicit allocations for shared KO, without inventing tie-breaks", () => {
    const x = replayPkoEvents([
      entry("a"), entry("b"), entry("c"),
      { kind: "knockout", eventId: "k", eliminatedEntryId: "c",
        shares: [
          { recipientEntryId: "a", points: 3 },
          { recipientEntryId: "b", points: 3 },
        ],
      },
    ]);
    expect(x).toMatchObject({ totalBountyCreated: 18, distributedRatingPoints: 2, outstandingBounty: 16 });
    expect(x.entries.find(p => p.entryId === "a")).toMatchObject({ bounty: 8, earnedKoPoints: 1 });
    expect(x.entries.find(p => p.entryId === "b")).toMatchObject({ bounty: 8, earnedKoPoints: 1 });
  });

  it("rejects invalid allocation totals, missing shares and duplicates", () => {
    expect(() => replayPkoEvents([entry("a"), entry("b"), ko("k", "b", "a", 5)])).toThrow(/exactly equal/);
    expect(() => replayPkoEvents([
      entry("a"), entry("b"),
      { kind: "knockout", eventId: "k", eliminatedEntryId: "b", shares: [] },
    ])).toThrow(/Explicit KO shares/);
    expect(() => replayPkoEvents([entry("a"), entry("b"), ko("k", "b", "a", 6), ko("k2", "b", "a", 6)])).toThrow(/not active/);
    expect(() => replayPkoEvents([entry("a"), entry("b"), ko("k", "b", "a", 6), ko("k", "b", "a", 6)])).toThrow(/Duplicate eventId/);
  });

  it("preserves earned player totals across sequential re-entry", () => {
    const x = replayPkoEvents([entry("a"), entry("b"), ko("k", "b", "a", 6), entry("b2", "b")]);
    expect(x.entries.find(p => p.entryId === "b2")).toMatchObject({ bounty: 6, status: "active" });
    expect(x.players.find(p => p.playerId === "b")).toMatchObject({ entryCount: 2 });
    expect(() => replayPkoEvents([entry("a"), entry("a2", "a")])).toThrow(/active entry/);
  });

  it("replays a voided KO without leaking or duplicating points", () => {
    const x = replayPkoEvents([
      entry("a"), entry("b"), ko("k", "b", "a", 6),
      { kind: "void_knockout", eventId: "v", targetEventId: "k" },
    ]);
    expect(x).toMatchObject({ totalBountyCreated: 12, distributedRatingPoints: 0, outstandingBounty: 12 });
    expect(x.entries.find(p => p.entryId === "b")).toMatchObject({ bounty: 6, status: "active" });
    expect(() => replayPkoEvents([
      entry("a"), entry("b"), ko("k", "b", "a", 6),
      { kind: "void_knockout", eventId: "v", targetEventId: "k" },
      { kind: "void_knockout", eventId: "v2", targetEventId: "k" },
    ])).toThrow(/already voided/);
  });

  it("requires exactly one surviving entry and forbids events after finish", () => {
    expect(() => replayPkoEvents([entry("a"), entry("b"), {
      kind: "finish", eventId: "f", winnerEntryId: "a",
    }])).toThrow(/one surviving/);
    expect(() => replayPkoEvents([entry("a"), {
      kind: "finish", eventId: "f", winnerEntryId: "a",
    }, entry("b")])).toThrow(/after tournament finish/);
  });
});

describe("PKO untrusted JSON boundary", () => {
  it("accepts a strict entry event", () => {
    expect(parsePkoEvent({ kind: "entry", eventId: "request-1", entryId: "entry-1", playerId: "player-1" }))
      .toEqual({ kind: "entry", eventId: "request-1", entryId: "entry-1", playerId: "player-1" });
  });
  it.each(["surprise", null, undefined])("fails closed on unknown kinds (%s)", kind => {
    expect(() => parsePkoEvent({ kind, eventId: "x" })).toThrow();
  });
  it("rejects forged extra event and share fields", () => {
    expect(() => parsePkoEvent({ kind: "entry", eventId: "x", entryId: "a", playerId: "p", actorId: "forged" })).toThrow(/Unexpected/);
    expect(() => parsePkoEvent({ kind: "knockout", eventId: "k", eliminatedEntryId: "a", shares: [{ recipientEntryId: "b", points: 6, bonus: 600 }] })).toThrow(/Unexpected/);
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "6", null])("rejects invalid share points (%s)", points => {
    expect(() => parsePkoEvent({ kind: "knockout", eventId: "k", eliminatedEntryId: "a", shares: [{ recipientEntryId: "b", points }] })).toThrow();
  });
  it("rejects empty IDs and oversized allocations", () => {
    expect(() => parsePkoEvent({ kind: "entry", eventId: " ", entryId: "a", playerId: "p" })).toThrow();
    expect(() => parsePkoEvent({ kind: "entry", eventId: "x", entryId: "a", playerId: "p".repeat(129) })).toThrow();
    expect(() => parsePkoEvent({ kind: "knockout", eventId: "x", eliminatedEntryId: "a", shares: Array(101).fill({ recipientEntryId: "b", points: 1 }) })).toThrow();
  });
});
