import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/lib/db/schema";
import type { db as Database } from "@/lib/db";

const url = process.env.RERAISE_PKO_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (process.env.PKO_DISPOSABLE_DATABASE !== "true" || !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/reraise" || parsed.username !== "reraise") {
    throw Error("PKO integration requires explicit disposable localhost database");
  }
}
const h = vi.hoisted(() => ({ db: null as unknown as typeof Database }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, {
  get(_target, key) {
    const value = Reflect.get(h.db, key);
    return typeof value === "function" ? value.bind(h.db) : value;
  },
}) }));
const { pkoLedgerRepository } = await import("@/lib/repositories/pko/PostgresPkoLedgerRepository");
const id = randomUUID(), a = randomUUID(), b = randomUUID(), staff = randomUUID(), outsider = randomUUID();
let client: ReturnType<typeof postgres>;

describe.runIf(!!url)("PKO real transaction ledger on disposable PostgreSQL", () => {
  beforeAll(async () => {
    client = postgres(url!, { max: 8, onnotice: () => {} });
    h.db = drizzle(client, { schema });
    await h.db.insert(schema.players).values([
      { id: a, displayName: "A" }, { id: b, displayName: "B" },
      { id: staff, displayName: "Staff", role: "operator" },
      { id: outsider, displayName: "Outsider", role: "player" },
    ]);
    await h.db.insert(schema.tournaments).values({ id, title: "PKO integration", startAt: new Date(), maxPlayers: 32, kind: "free", status: "open", tournamentType: "progressive_knockout" });
    await h.db.insert(schema.registrations).values([{ tournamentId: id, playerId: a, status: "registered" }, { tournamentId: id, playerId: b, status: "registered" }]);
    await h.db.insert(schema.tournamentAttendance).values([{ tournamentId: id, playerId: a, arrived: true }, { tournamentId: id, playerId: b, arrived: true }]);
  });
  afterAll(async () => {
    if (!client) return;
    await h.db.delete(schema.tournaments).where(eq(schema.tournaments.id, id));
    for (const pid of [a, b, staff, outsider]) await h.db.delete(schema.players).where(eq(schema.players.id, pid));
    await client.end();
  });
  const entry = (playerId: string, entryId: string) => ({ kind: "entry" as const, eventId: "entry:" + entryId, entryId, playerId });
  const ko = (eventId: string, eliminatedEntryId: string, recipientEntryId: string, points: number) =>
    ({ kind: "knockout" as const, eventId, eliminatedEntryId, shares: [{ recipientEntryId, points }] });
  const append = (event: unknown, expectedRevision: number, actorId = staff) =>
    pkoLedgerRepository.append({ tournamentId: id, actorId, expectedRevision, event });

  it("persists entries atomically with rebuy totals and serializes two staff writers", async () => {
    const first = entry(a, "a1"), second = entry(b, "b1");
    const calls = await Promise.allSettled([append(first, 0), append(second, 0)]);
    expect(calls.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(calls.filter(x => x.status === "rejected")).toHaveLength(1);
    const current = await pkoLedgerRepository.read(id);
    expect(current.revision).toBe(1);
    const next = first.eventId === current.events[0].eventId ? second : first;
    expect((await append(next, 1)).revision).toBe(2);
    expect((await append(next, 0)).duplicate).toBe(true);
    await expect(append({ ...next, playerId: outsider }, 2)).rejects.toThrow(/другим содержимым/);
    expect((await h.db.select().from(schema.tournamentRebuyState).where(eq(schema.tournamentRebuyState.tournamentId, id))).map(x => x.rebuys).sort()).toEqual([1, 1]);
  });

  it("rejects invalid KO and actors without any partial writes", async () => {
    await expect(append(ko("bad", "b1", "a1", 5), 2)).rejects.toThrow(/exactly equal/);
    await expect(append(ko("bad-actor", "b1", "a1", 6), 2, outsider)).rejects.toThrow(/прав/);
    const current = await pkoLedgerRepository.read(id);
    expect(current.revision).toBe(2);
    expect(current.snapshot.totalBountyCreated).toBe(12);
  });

  it("tracks KO, re-entry, winner and freezes all points, with no double award", async () => {
    await append(ko("ko-1", "b1", "a1", 6), 2);
    expect((await append(entry(b, "b2"), 3)).revision).toBe(4);
    expect((await h.db.select().from(schema.tournamentRebuyState).where(and(eq(schema.tournamentRebuyState.tournamentId, id), eq(schema.tournamentRebuyState.playerId, b))))[0].rebuys).toBe(2);
    await expect(pkoLedgerRepository.updateAddons({ tournamentId: id, playerId: b, actorId: staff, expectedEntries: 1, addons: 1 })).rejects.toThrow(/изменились/);
    expect(await pkoLedgerRepository.updateAddons({ tournamentId: id, playerId: b, actorId: staff, expectedEntries: 2, addons: 1 })).toEqual({ rebuys: 2, addons: 1 });
    await append(ko("ko-2", "b2", "a1", 6), 4);
    const finished = await append({ kind: "finish", eventId: "finish", winnerEntryId: "a1" }, 5);
    expect(finished.snapshot).toMatchObject({ totalBountyCreated: 18, distributedRatingPoints: 18, outstandingBounty: 0, finished: true });
    expect(finished.snapshot.players.find(x => x.playerId === a)?.totalPkoRatingPoints).toBe(18);
    const undone = await append({ kind: "void_finish", eventId: "undo-finish", targetEventId: "finish" }, 6);
    expect(undone.snapshot).toMatchObject({ finished: false, distributedRatingPoints: 9, outstandingBounty: 9 });
    const reclosed = await append({ kind: "finish", eventId: "finish-2", winnerEntryId: "a1" }, 7);
    expect(reclosed.snapshot).toMatchObject({ finished: true, distributedRatingPoints: 18, outstandingBounty: 0 });
    await expect(append({ kind: "finish", eventId: "again", winnerEntryId: "a1" }, 8)).rejects.toThrow(/уже завершён/);
  });

  it("blocks writes after completed tournament and never changes other formats", async () => {
    await h.db.update(schema.tournaments).set({ status: "completed" }).where(eq(schema.tournaments.id, id));
    await expect(append(entry(b, "b3"), 8)).rejects.toThrow(/нельзя менять/);
    await h.db.update(schema.tournaments).set({ status: "open", tournamentType: "classic" }).where(eq(schema.tournaments.id, id));
    await expect(append(entry(b, "b3"), 8)).rejects.toThrow(/только в турнире/);
    await h.db.update(schema.tournaments).set({ tournamentType: "progressive_knockout" }).where(eq(schema.tournaments.id, id));
  });
});
