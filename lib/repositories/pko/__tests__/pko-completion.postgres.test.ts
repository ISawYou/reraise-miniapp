import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/lib/db/schema";
import type { db as Database } from "@/lib/db";

const url = process.env.RERAISE_PKO_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (process.env.PKO_DISPOSABLE_DATABASE !== "true" || !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/reraise" || parsed.username !== "reraise") throw Error("Disposable localhost PKO test DB only");
}
const h = vi.hoisted(() => ({ db: null as unknown as typeof Database }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_target, key) {
  const value = Reflect.get(h.db, key);
  return typeof value === "function" ? value.bind(h.db) : value;
}}) }));
vi.mock("@/lib/admin-auth", () => ({ assertServerActorRole: vi.fn().mockResolvedValue({ id: "test-operator", role: "operator" }) }));
vi.mock("@/features/achievements", () => ({ syncPlayersAchievementsIfEnabled: vi.fn() }));
vi.mock("@/features/club-activity", () => ({ publishTournamentWinnerEvent: vi.fn() }));
vi.mock("@/lib/poker-clock-client", () => ({ finishPokerClockTournament: vi.fn().mockResolvedValue({status:"not_linked"}) }));
const { pkoLedgerRepository } = await import("@/lib/repositories/pko/PostgresPkoLedgerRepository");
const tournamentId = randomUUID(), a = randomUUID(), b = randomUUID(), actor = randomUUID();
let client: ReturnType<typeof postgres>;

describe.runIf(!!url)("PKO completion + frozen results in a real disposable DB", () => {
  beforeAll(async () => {
    vi.stubEnv("DATABASE_PROVIDER", "postgres");
    client = postgres(url!, { max: 8, onnotice: () => {} });
    h.db = drizzle(client, { schema });
    await h.db.insert(schema.players).values([{ id: a, displayName: "Alpha" }, { id: b, displayName: "Bravo" }, { id: actor, displayName: "Staff", role: "operator" }]);
    await h.db.insert(schema.tournaments).values({ id: tournamentId, title: "PKO completion", status: "open", kind: "free", sourceMode: "POSTGRESQL", tournamentType: "progressive_knockout", startAt: new Date(), maxPlayers: 32 });
    await h.db.insert(schema.registrations).values([{ tournamentId, playerId: a, status: "registered" }, { tournamentId, playerId: b, status: "registered" }]);
    await h.db.insert(schema.tournamentAttendance).values([{ tournamentId, playerId: a, arrived: true }, { tournamentId, playerId: b, arrived: true }]);
    await h.db.insert(schema.tournamentOperations).values([
      { tournamentId, playerId: a, updatedBy: actor, place: 1, paid: true },
      { tournamentId, playerId: b, updatedBy: actor, place: 2, paid: true },
    ]);
  });
  afterAll(async () => {
    if (!client) return;
    await h.db.delete(schema.tournamentOperationAudit).where(eq(schema.tournamentOperationAudit.tournamentId, tournamentId));
    await h.db.delete(schema.tournaments).where(eq(schema.tournaments.id, tournamentId));
    for (const id of [a, b, actor]) await h.db.delete(schema.players).where(eq(schema.players.id, id));
    await client.end();
  });
  const evt = (event: unknown, expectedRevision: number) =>
    pkoLedgerRepository.append({ tournamentId, actorId: actor, expectedRevision, event });
  it("rejects premature completion, then freezes exact PKO awards and prevents a double completion", async () => {
    const { previewPostgresCompletion, completePostgresTournament } = await import("@/features/postgres-tournament-completion");
    const { commitTournamentCompletion } = await import("@/features/tournament-completion-commit");
    const a1 = randomUUID(), b1 = randomUUID(), b2 = randomUUID();
    await evt({ kind: "entry", eventId: randomUUID(), entryId: a1, playerId: a }, 0);
    await evt({ kind: "entry", eventId: randomUUID(), entryId: b1, playerId: b }, 1);
    await expect(previewPostgresCompletion(tournamentId)).rejects.toThrow(/завершите журнал/);
    await evt({ kind: "knockout", eventId: randomUUID(), eliminatedEntryId: b1, shares: [{ recipientEntryId: a1, points: 6 }] }, 2);
    await evt({ kind: "entry", eventId: randomUUID(), entryId: b2, playerId: b }, 3);
    await evt({ kind: "knockout", eventId: randomUUID(), eliminatedEntryId: b2, shares: [{ recipientEntryId: a1, points: 6 }] }, 4);
    await evt({ kind: "finish", eventId: randomUUID(), winnerEntryId: a1 }, 5);
    const preview = await previewPostgresCompletion(tournamentId);
    expect(preview.rating.find(r => r.player_id === a)?.knockout_points).toBe(18);
    expect(preview.rating.find(r => r.player_id === b)?.knockout_points).toBe(0);
    expect(preview.rows.find(r => r.player_id === a)?.knockouts).toBe(2);
    await expect(commitTournamentCompletion({ tournamentId, results: [], attendedPlayerIds: [] })).rejects.toThrow(/fingerprint/);
    await pkoLedgerRepository.updateAddons({ tournamentId, playerId: b, actorId: actor, expectedEntries: 2, addons: 1 });
    await expect(completePostgresTournament(tournamentId, preview.fingerprint)).rejects.toThrow(/устарел/);
    const fresh = await previewPostgresCompletion(tournamentId);
    expect((await completePostgresTournament(tournamentId, fresh.fingerprint)).ok).toBe(true);
    const rows = await h.db.select().from(schema.results).where(eq(schema.results.tournamentId, tournamentId));
    expect(rows).toHaveLength(2);
    const winner = rows.find(row => row.playerId === a)!;
    const loser = rows.find(row => row.playerId === b)!;
    expect(winner).toMatchObject({ place: 1, reentries: 1, knockouts: 2, knockoutPoints: 18 });
    expect(loser).toMatchObject({ place: 2, reentries: 2, knockoutPoints: 0, addons: 1 });
    for (const row of rows) expect(row.ratingPoints).toBe((row.participationPoints ?? 0) + (row.knockoutPoints ?? 0) +
      (row.bossBountyPoints ?? 0) + row.mysteryBountyPoints + (row.itmPoints ?? 0));
    await expect(completePostgresTournament(tournamentId, fresh.fingerprint)).rejects.toThrow(/уже завершён/);
    expect((await h.db.select().from(schema.tournaments).where(eq(schema.tournaments.id, tournamentId)))[0].status).toBe("completed");
  });
});
