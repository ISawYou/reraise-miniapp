import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { db as Database } from "@/lib/db";

const url = process.env.RERAISE_IDENTITY_CORRECTION_TEST_DATABASE_URL;
process.env.DATABASE_PROVIDER = "postgres";
const h = vi.hoisted(() => ({ db: null as unknown as typeof Database }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_target, key) { const value = Reflect.get(h.db, key); return typeof value === "function" ? value.bind(h.db) : value; } }) }));
const { applyCompletedIdentityCorrection, previewCompletedIdentityCorrection, IDENTITY_CORRECTION } = await import("./completed-identity-correction");

const admin = "00000000-0000-4000-8000-000000000001";
const source = IDENTITY_CORRECTION.sourcePlayerId;
const target = IDENTITY_CORRECTION.targetPlayerId;
const other = ["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004", "00000000-0000-4000-8000-000000000005"];
const finalId = IDENTITY_CORRECTION.finalTournamentId;
let client: ReturnType<typeof postgres>;

async function seed() {
  await client`TRUNCATE qualification_audit, qualification_squad_members, qualification_invitations, qualification_events, tournament_attendance, registrations, tournaments, player_achievements, players CASCADE`;
  await h.db.insert(schema.players).values([
    { id: admin, displayName: "Admin", role: "admin" },
    { id: source, displayName: "PlaYa_btw", email: "empty@example.invalid" },
    { id: target, displayName: "PlaYa_btw", username: "PlaYa_btw", telegramId: 777001 },
    ...other.map((id, i) => ({ id, displayName: `Finalist ${i}` })),
  ]);
  await h.db.insert(schema.tournaments).values({ id: finalId, title: "Qualification Final", kind: "free", maxPlayers: 18, startingStack: 50000, startAt: new Date("2026-11-14T09:00:00Z"), status: "open", tournamentType: "qualification_final" });
  await h.db.insert(schema.qualificationEvents).values({ id: IDENTITY_CORRECTION.eventId, slug: "put-v-kaliningrad-2026", title: "Путь в Калининград", rules: "rules", timezone: "Europe/Moscow", finalDate: "2026-11-14", status: "final", version: 39, finalTournamentId: finalId, winnerPlayerId: other[3], finalRosterLockedAt: new Date("2026-11-13T23:00:00Z") });
  const invitePlayers = [source, ...other];
  await h.db.insert(schema.qualificationInvitations).values(invitePlayers.map((playerId, i) => ({ eventId: IDENTITY_CORRECTION.eventId, playerId, qualifyingRank: i === 0 ? null : i + 1, manualAdmission: i === 0, seat: i + 1, status: "accepted" })));
  await h.db.insert(schema.registrations).values(invitePlayers.map(playerId => ({ tournamentId: finalId, playerId, status: "attended" })));
  await h.db.insert(schema.tournamentAttendance).values(invitePlayers.map(playerId => ({ tournamentId: finalId, playerId, arrived: true })));
  await h.db.insert(schema.qualificationSquad).values([
    { id: IDENTITY_CORRECTION.squadMemberId, eventId: IDENTITY_CORRECTION.eventId, playerId: source, source: "final_top3", slot: 1, confirmedAt: new Date("2026-11-14T13:00:00Z") },
    { eventId: IDENTITY_CORRECTION.eventId, playerId: other[0], source: "final_top3", slot: 2, confirmedAt: new Date("2026-11-14T13:00:00Z") },
    { eventId: IDENTITY_CORRECTION.eventId, playerId: other[1], source: "final_top3", slot: 3, confirmedAt: new Date("2026-11-14T13:00:00Z") },
    { eventId: IDENTITY_CORRECTION.eventId, playerId: other[2], source: "captain", slot: 0, confirmedAt: new Date("2026-11-14T13:00:00Z") },
    { eventId: IDENTITY_CORRECTION.eventId, playerId: other[3], source: "qualification_winner", slot: 0, confirmedAt: new Date("2026-11-14T13:00:00Z") },
  ]);
  await h.db.update(schema.qualificationEvents).set({ status: "completed", squadConfirmedAt: new Date("2026-11-14T13:40:00Z"), finalOutcome: { survivorIds: [source, other[0], other[1]], arrivedIds: invitePlayers, eliminations: [{ playerId: other[2], place: 4 }, { playerId: other[3], place: 5 }], completedAt: "2026-11-14T13:39:00.000Z" }, version: 39 }).where(eq(schema.qualificationEvents.id, IDENTITY_CORRECTION.eventId));
  await h.db.update(schema.tournaments).set({ status: "completed" }).where(eq(schema.tournaments.id, finalId));
  await h.db.insert(schema.playerAchievements).values({ playerId: target, achievementCode: "existing", currentValue: 1 });
}

describe.runIf(!!url)("completed qualification identity correction", () => {
  beforeAll(async () => { client = postgres(url!, { prepare: false, onnotice: () => {} }); h.db = drizzle(client, { schema }); await client.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;"); await migrate(h.db, { migrationsFolder: "lib/db/migrations" }); });
  beforeEach(seed);
  afterAll(async () => { await client.end(); });

  it("previews and atomically replaces only the approved current references", async () => {
    const preview = await previewCompletedIdentityCorrection(39);
    expect(preview.replacement).toEqual({ from: source, to: target });
    const before = await client`SELECT place,rating_points FROM results WHERE player_id IN (${source}::uuid,${target}::uuid)`;
    await expect(applyCompletedIdentityCorrection(admin, 39, "Владелец подтвердил исправление аккаунта PlaYa_btw")).resolves.toMatchObject({ version: 40, ok: true });
    const state = await client`SELECT player_id,selection_source,slot FROM qualification_squad_members WHERE event_id=${IDENTITY_CORRECTION.eventId} ORDER BY selection_source,slot`;
    expect(state).toHaveLength(5); expect(state.find(row => row.selection_source === "final_top3" && row.slot === 1)?.player_id).toBe(target);
    expect(state.filter(row => row.player_id !== target).map(row => row.player_id).sort()).toEqual(other.slice().sort());
    expect(await client`SELECT player_id FROM registrations WHERE tournament_id=${finalId} AND player_id=${target}`).toHaveLength(1);
    expect(await client`SELECT player_id FROM tournament_attendance WHERE tournament_id=${finalId} AND player_id=${target}`).toHaveLength(1);
    expect((await client`SELECT final_outcome->'survivorIds' AS ids,version,status FROM qualification_events WHERE id=${IDENTITY_CORRECTION.eventId}`)[0]).toMatchObject({ version: 40, status: "completed" });
    expect((await client`SELECT final_outcome->'survivorIds' AS ids FROM qualification_events WHERE id=${IDENTITY_CORRECTION.eventId}`)[0].ids).toContain(target);
    expect((await client`SELECT final_outcome->'survivorIds' AS ids FROM qualification_events WHERE id=${IDENTITY_CORRECTION.eventId}`)[0].ids).not.toContain(source);
    expect(await client`SELECT action FROM qualification_audit WHERE event_id=${IDENTITY_CORRECTION.eventId} AND action='completed_identity_correction'`).toHaveLength(1);
    expect(await client`SELECT place,rating_points FROM results WHERE player_id IN (${source}::uuid,${target}::uuid)`).toEqual(before);
    expect(await client`SELECT achievement_code,current_value FROM player_achievements WHERE player_id=${target}`).toHaveLength(1);
  });

  it("fails closed on stale version and leaves all references unchanged", async () => {
    await expect(applyCompletedIdentityCorrection(admin, 38, "Владелец подтвердил исправление аккаунта PlaYa_btw")).rejects.toThrow("Версия события");
    expect(await client`SELECT player_id FROM qualification_squad_members WHERE id=${IDENTITY_CORRECTION.squadMemberId}`).toEqual([{ player_id: source }]);
  });

  it("keeps the ordinary completed-final registration guard effective", async () => {
    await expect(client`UPDATE registrations SET player_id=${target} WHERE tournament_id=${finalId} AND player_id=${source}`).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects an unexpected target squad reference and a missing source row", async () => {
    await client`UPDATE qualification_squad_members SET player_id=${target} WHERE id=${IDENTITY_CORRECTION.squadMemberId}`;
    await expect(previewCompletedIdentityCorrection(39)).rejects.toThrow("Целевой аккаунт уже есть в сборной");
    await seed();
    await client`DELETE FROM qualification_squad_members WHERE id=${IDENTITY_CORRECTION.squadMemberId}`;
    await expect(previewCompletedIdentityCorrection(39)).rejects.toThrow("пять уникальных");
  });

  it("rejects a target already registered in the final", async () => {
    await client.begin(async tx => {
      await tx`SELECT set_config('app.qualification_identity_repair_scope', ${`${IDENTITY_CORRECTION.eventId}:${finalId}:${source}:${target}`}, true)`;
      await tx`UPDATE registrations SET player_id=${target} WHERE tournament_id=${finalId} AND player_id=${source}`;
    });
    await expect(previewCompletedIdentityCorrection(39)).rejects.toThrow("Целевой аккаунт уже зарегистрирован");
  });
});
