import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { db as Database } from "@/lib/db";

const url = process.env.RERAISE_ADMIN_ADMISSION_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" || !parsed.pathname.startsWith("/reraise_admin_admission_test_")) {
    throw new Error("Tournament operations integration tests require a disposable localhost database");
  }
}

const holder = vi.hoisted(() => ({ db: null as unknown as typeof Database }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, {
    get(_target, key) {
      const value = Reflect.get(holder.db, key);
      return typeof value === "function" ? value.bind(holder.db) : value;
    },
  }),
}));
vi.mock("@/lib/admin-auth", () => ({
  assertServerActorRole: vi.fn(async () => ({ id: "operations-staff", role: "operator" })),
}));
vi.mock("@/features/achievements", () => ({ syncPlayersAchievementsIfEnabled: vi.fn() }));
vi.mock("@/features/club-activity", () => ({ publishTournamentWinnerEvent: vi.fn() }));
vi.mock("@/lib/poker-clock-client", () => ({ finishPokerClockTournament: vi.fn(async () => ({ status: "not_linked" })) }));

const { tournamentOperationsRepository } = await import("@/lib/repositories/tournament-operations/PostgresTournamentOperationsRepository");

const describePostgres = url ? describe : describe.skip;
let client: ReturnType<typeof postgres> | undefined;
const tournamentId = randomUUID();
const playerId = randomUUID();
const actorId = randomUUID();

describePostgres("PostgreSQL-owned tournament operations", () => {
  beforeAll(async () => {
    client = postgres(url!, { prepare: false, onnotice: () => undefined });
    holder.db = drizzle(client, { schema });
    await migrate(holder.db, { migrationsFolder: "lib/db/migrations" });
    await holder.db.insert(schema.players).values([
      { id: playerId, displayName: "Operations fixture" },
      { id: actorId, displayName: "Operations staff", role: "operator" },
    ]);
    await holder.db.insert(schema.tournaments).values({
      id: tournamentId,
      title: "Operations fixture",
      kind: "free",
      status: "open",
      tournamentType: "bounty",
      sourceMode: "POSTGRESQL",
      startAt: new Date(),
      maxPlayers: 46,
    });
    await holder.db.insert(schema.registrations).values({ tournamentId, playerId, status: "registered" });
    await holder.db.insert(schema.tournamentLateRegistration).values({
      tournamentId,
      arrivedPlayersCount: 1,
      initialStacksCount: 1,
      totalEntriesCount: 1,
      rebuysCount: 0,
      addonsCount: 0,
      tournamentType: "bounty",
      ratingFormulaVersion: "v2",
      ratingPlaces: [{ place: 1, points: 50 }],
    });
  });

  afterAll(async () => {
    if (!client) return;
    await holder.db.delete(schema.tournamentOperationAudit).where(eq(schema.tournamentOperationAudit.tournamentId, tournamentId));
    await holder.db.delete(schema.tournaments).where(eq(schema.tournaments.id, tournamentId));
    await holder.db.delete(schema.players).where(eq(schema.players.id, playerId));
    await holder.db.delete(schema.players).where(eq(schema.players.id, actorId));
    await client.end();
  });

  it("persists staff operations with CAS/audit and rejects legacy or completed writes", async () => {
    const frozenBefore = await holder.db.select().from(schema.tournamentLateRegistration).where(eq(schema.tournamentLateRegistration.tournamentId, tournamentId));
    const base = { tournamentId, playerId, actorId };

    await expect(tournamentOperationsRepository.patch({ ...base, expectedVersion: 0, patch: { paid: true, knockouts: 2 } }))
      .resolves.toMatchObject({ version: 1, paid: true, knockouts: 2 });
    await expect(tournamentOperationsRepository.patch({ ...base, expectedVersion: 0, patch: { paid: false } }))
      .rejects.toThrow("изменены");
    await expect(tournamentOperationsRepository.patch({ ...base, expectedVersion: 1, patch: { place: 1 } }))
      .resolves.toMatchObject({ version: 2, place: 1 });

    await holder.db.update(schema.tournaments).set({ sourceMode: "LEGACY_GOOGLE_SHEETS" }).where(eq(schema.tournaments.id, tournamentId));
    await expect(tournamentOperationsRepository.patch({ ...base, expectedVersion: 2, patch: { paid: false } }))
      .rejects.toThrow("PostgreSQL-источника");
    await holder.db.update(schema.tournaments).set({ sourceMode: "POSTGRESQL", status: "completed" }).where(eq(schema.tournaments.id, tournamentId));
    await expect(tournamentOperationsRepository.patch({ ...base, expectedVersion: 2, patch: { paid: false } }))
      .rejects.toThrow("Завершённый");

    expect(await holder.db.select().from(schema.tournamentLateRegistration).where(eq(schema.tournamentLateRegistration.tournamentId, tournamentId))).toEqual(frozenBefore);
    expect(await holder.db.select().from(schema.tournamentOperationAudit).where(eq(schema.tournamentOperationAudit.tournamentId, tournamentId))).toHaveLength(2);
  });

  it("completes a PostgreSQL-owned tournament from canonical rows and preserves the frozen snapshot", async () => {
    const { previewPostgresCompletion, completePostgresTournament } = await import("@/features/postgres-tournament-completion");
    const id = randomUUID();
    const participant = randomUUID();
    const snapshot = { place: 1, points: 50 };
    await holder.db.insert(schema.players).values({ id: participant, displayName: "Completion fixture" });
    await holder.db.insert(schema.tournaments).values({
      id,
      title: "Completion fixture",
      kind: "free",
      status: "open",
      tournamentType: "bounty",
      sourceMode: "POSTGRESQL",
      googleSheetTabName: "archive-only",
      startAt: new Date(),
      maxPlayers: 10,
    });
    await holder.db.insert(schema.registrations).values({ tournamentId: id, playerId: participant, status: "registered" });
    await holder.db.insert(schema.tournamentAttendance).values({ tournamentId: id, playerId: participant, arrived: true });
    await holder.db.insert(schema.tournamentRebuyState).values({ tournamentId: id, playerId: participant, rebuys: 1, addons: 0 });
    await holder.db.insert(schema.tournamentOperations).values({ tournamentId: id, playerId: participant, updatedBy: actorId, paid: false, place: 1, knockouts: 2 });
    await holder.db.insert(schema.tournamentLateRegistration).values({
      tournamentId: id,
      arrivedPlayersCount: 1,
      initialStacksCount: 1,
      totalEntriesCount: 1,
      rebuysCount: 0,
      addonsCount: 0,
      tournamentType: "bounty",
      ratingFormulaVersion: "v2",
      ratingPlaces: [snapshot],
    });
    try {
      const before = await holder.db.select().from(schema.tournamentLateRegistration).where(eq(schema.tournamentLateRegistration.tournamentId, id));
      const preview = await previewPostgresCompletion(id);
      await expect(completePostgresTournament(id, preview.fingerprint)).resolves.toMatchObject({ ok: true, completedCount: 1 });
      const [tournament] = await holder.db.select().from(schema.tournaments).where(eq(schema.tournaments.id, id));
      const [result] = await holder.db.select().from(schema.results).where(eq(schema.results.tournamentId, id));
      expect(tournament.status).toBe("completed");
      expect(result).toMatchObject({ playerId: participant, place: 1, knockouts: 2, ratingPoints: 62 });
      expect(await holder.db.select().from(schema.tournamentLateRegistration).where(eq(schema.tournamentLateRegistration.tournamentId, id))).toEqual(before);
      await expect(completePostgresTournament(id, preview.fingerprint)).rejects.toThrow("уже завершён");
    } finally {
      await holder.db.delete(schema.tournamentOperationAudit).where(eq(schema.tournamentOperationAudit.tournamentId, id));
      await holder.db.delete(schema.tournaments).where(eq(schema.tournaments.id, id));
      await holder.db.delete(schema.players).where(eq(schema.players.id, participant));
    }
  });
});
