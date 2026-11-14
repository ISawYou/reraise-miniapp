import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { players, results, registrations, tournamentAttendance, qualificationEvents as events, qualificationInvitations as invites, qualificationSquad as squad, qualificationAudit as audit, playerAchievements } from "@/lib/db/schema";

export const IDENTITY_CORRECTION = {
  eventId: "1b98f989-5668-4461-9126-5e36397929e7",
  finalTournamentId: "bd2c3795-1a1a-4f9a-a1f2-6f018f2c0902",
  squadMemberId: "e72c8f95-5999-45b3-bb49-e1514b200683",
  sourcePlayerId: "9571d26e-cea2-47d2-b37b-854cad67d3e9",
  targetPlayerId: "1e802bf2-e6ab-4861-9863-3d3ebc40cce8",
} as const;

export class IdentityCorrectionError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

type Executor = Pick<typeof db, "select" | "insert" | "update" | "execute">;
type CorrectionState = Awaited<ReturnType<typeof readState>>;

function fail(message: string, status = 409): never { throw new IdentityCorrectionError(message, status); }

function scope() {
  return `${IDENTITY_CORRECTION.eventId}:${IDENTITY_CORRECTION.finalTournamentId}:${IDENTITY_CORRECTION.sourcePlayerId}:${IDENTITY_CORRECTION.targetPlayerId}`;
}

async function readState(tx: Executor) {
  const [event] = await tx.select().from(events).where(eq(events.id, IDENTITY_CORRECTION.eventId));
  if (!event) fail("Квалификационное событие не найдено", 404);
  if (event.finalTournamentId !== IDENTITY_CORRECTION.finalTournamentId) fail("Финал события не совпадает с утверждённым финалом");
  const [finalTournament] = await tx.select({ tournamentId: registrations.tournamentId }).from(registrations).where(eq(registrations.tournamentId, IDENTITY_CORRECTION.finalTournamentId)).limit(1);
  const playerRows = await tx.select({ id: players.id, displayName: players.displayName, username: players.username, email: players.email, telegramId: players.telegramId, isBlocked: players.isBlocked, mergedIntoPlayerId: players.mergedIntoPlayerId }).from(players).where(inArray(players.id, [IDENTITY_CORRECTION.sourcePlayerId, IDENTITY_CORRECTION.targetPlayerId]));
  const sourcePlayer = playerRows.find(p => p.id === IDENTITY_CORRECTION.sourcePlayerId) ?? null;
  const targetPlayer = playerRows.find(p => p.id === IDENTITY_CORRECTION.targetPlayerId) ?? null;
  const squadRows = await tx.select().from(squad).where(eq(squad.eventId, IDENTITY_CORRECTION.eventId));
  const sourceSquad = squadRows.find(row => row.id === IDENTITY_CORRECTION.squadMemberId) ?? null;
  const sourceInvitations = await tx.select().from(invites).where(and(eq(invites.eventId, IDENTITY_CORRECTION.eventId), eq(invites.playerId, IDENTITY_CORRECTION.sourcePlayerId)));
  const targetInvitations = await tx.select().from(invites).where(and(eq(invites.eventId, IDENTITY_CORRECTION.eventId), eq(invites.playerId, IDENTITY_CORRECTION.targetPlayerId)));
  const sourceRegistrations = await tx.select().from(registrations).where(and(eq(registrations.tournamentId, IDENTITY_CORRECTION.finalTournamentId), eq(registrations.playerId, IDENTITY_CORRECTION.sourcePlayerId)));
  const targetRegistrations = await tx.select().from(registrations).where(and(eq(registrations.tournamentId, IDENTITY_CORRECTION.finalTournamentId), eq(registrations.playerId, IDENTITY_CORRECTION.targetPlayerId)));
  const sourceAttendance = await tx.select().from(tournamentAttendance).where(and(eq(tournamentAttendance.tournamentId, IDENTITY_CORRECTION.finalTournamentId), eq(tournamentAttendance.playerId, IDENTITY_CORRECTION.sourcePlayerId)));
  const targetAttendance = await tx.select().from(tournamentAttendance).where(and(eq(tournamentAttendance.tournamentId, IDENTITY_CORRECTION.finalTournamentId), eq(tournamentAttendance.playerId, IDENTITY_CORRECTION.targetPlayerId)));
  return { event, finalTournament, sourcePlayer, targetPlayer, squadRows, sourceSquad, sourceInvitations, targetInvitations, sourceRegistrations, targetRegistrations, sourceAttendance, targetAttendance };
}

function validateState(state: CorrectionState, actorId?: string, expectedVersion?: number) {
  const { event, sourcePlayer: source, targetPlayer: target } = state;
  if (event.status !== "completed" || !event.squadConfirmedAt || !event.finalOutcome) fail("Событие не находится в подтверждённом completed-состоянии");
  if (event.version !== (expectedVersion ?? 39)) fail(`Версия события изменилась: ожидается ${expectedVersion ?? 39}, фактически ${event.version}`);
  if (!source || source.id !== IDENTITY_CORRECTION.sourcePlayerId || source.displayName !== "PlaYa_btw" || source.isBlocked || source.mergedIntoPlayerId) fail("Исходный аккаунт не соответствует утверждённому состоянию");
  if (!target || target.id !== IDENTITY_CORRECTION.targetPlayerId || target.displayName !== "PlaYa_btw" || target.isBlocked || target.mergedIntoPlayerId || !target.telegramId) fail("Целевой основной аккаунт не соответствует утверждённому состоянию");
  if (state.finalTournament?.tournamentId !== IDENTITY_CORRECTION.finalTournamentId) fail("Не найдена регистрация в утверждённом финале");
  if (state.squadRows.length !== 5 || new Set(state.squadRows.map(row => row.playerId)).size !== 5) fail("В сборной должно быть ровно пять уникальных участников");
  if (state.squadRows.some(row => row.playerId === IDENTITY_CORRECTION.targetPlayerId)) fail("Целевой аккаунт уже есть в сборной");
  if (!state.sourceSquad || state.sourceSquad.playerId !== IDENTITY_CORRECTION.sourcePlayerId || state.sourceSquad.source !== "final_top3" || state.sourceSquad.slot !== 1) fail("Исходная запись сборной не соответствует ожидаемой");
  if (state.targetInvitations.length) fail("Для целевого аккаунта уже существует приглашение в этот отбор");
  if (state.sourceInvitations.length !== 1 || state.sourceInvitations[0].status !== "accepted") fail("Не найдено ровно одно принятое приглашение исходного аккаунта");
  if (state.targetRegistrations.length) fail("Целевой аккаунт уже зарегистрирован в финале");
  if (state.sourceRegistrations.length !== 1 || !["registered", "attended"].includes(state.sourceRegistrations[0].status)) fail("Не найдена единственная активная регистрация исходного аккаунта");
  if (state.targetAttendance.length) fail("Для целевого аккаунта уже есть запись прихода");
  if (state.sourceAttendance.length !== 1 || !state.sourceAttendance[0].arrived) fail("Не найдена запись прихода исходного аккаунта");
  const outcome = event.finalOutcome;
  if (!outcome.survivorIds.includes(IDENTITY_CORRECTION.sourcePlayerId) || outcome.survivorIds.includes(IDENTITY_CORRECTION.targetPlayerId) || !outcome.arrivedIds.includes(IDENTITY_CORRECTION.sourcePlayerId) || outcome.arrivedIds.includes(IDENTITY_CORRECTION.targetPlayerId) || outcome.eliminations.some(row => row.playerId === IDENTITY_CORRECTION.sourcePlayerId || row.playerId === IDENTITY_CORRECTION.targetPlayerId)) fail("Frozen final outcome не соответствует точечной замене identity");
  if (actorId && actorId.length < 1) fail("Не определён администратор", 401);
}

async function immutableSnapshots(tx: Executor) {
  const ids = [IDENTITY_CORRECTION.sourcePlayerId, IDENTITY_CORRECTION.targetPlayerId];
  return {
    results: await tx.select().from(results).where(inArray(results.playerId, ids)),
    achievements: await tx.select().from(playerAchievements).where(inArray(playerAchievements.playerId, ids)),
  };
}

function sameRows(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function playerSummary(player: NonNullable<CorrectionState["sourcePlayer"]>) {
  return { id: player.id, displayName: player.displayName, username: player.username, hasEmail: player.email !== null, hasTelegram: player.telegramId !== null, isBlocked: player.isBlocked, merged: player.mergedIntoPlayerId !== null };
}

export async function previewCompletedIdentityCorrection(expectedVersion?: number) {
  if (process.env.DATABASE_PROVIDER !== "postgres") fail("Коррекция требует PostgreSQL", 503);
  return db.transaction(async tx => {
    const state = await readState(tx);
    validateState(state, undefined, expectedVersion);
    return {
      event: { id: state.event.id, status: state.event.status, version: state.event.version, finalTournamentId: state.event.finalTournamentId },
      sourcePlayer: playerSummary(state.sourcePlayer!),
      targetPlayer: playerSummary(state.targetPlayer!),
      affected: { squadMemberId: state.sourceSquad!.id, invitationId: state.sourceInvitations[0].id, registrationId: state.sourceRegistrations[0].id, attendancePlayerId: state.sourceAttendance[0].playerId, outcomeFields: ["survivorIds", "arrivedIds", "eliminations[].playerId"] },
      replacement: { from: IDENTITY_CORRECTION.sourcePlayerId, to: IDENTITY_CORRECTION.targetPlayerId },
      expectedPostflight: { squadMembers: 5, completedStatus: true, resultsCreated: 0, ratingUnchanged: true, achievementsUnchanged: true },
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function applyCompletedIdentityCorrection(actorId: string, expectedVersion: number, reason: string) {
  if (process.env.DATABASE_PROVIDER !== "postgres") fail("Коррекция требует PostgreSQL", 503);
  if (reason.trim().length < 10 || reason.trim().length > 500) fail("Укажите причину коррекции от 10 до 500 символов", 400);
  return db.transaction(async tx => {
    const [actor] = await tx.select({ id: players.id, role: players.role, isBlocked: players.isBlocked, mergedIntoPlayerId: players.mergedIntoPlayerId }).from(players).where(eq(players.id, actorId)).for("update");
    if (!actor || actor.role !== "admin" || actor.isBlocked || actor.mergedIntoPlayerId) fail("Только действующий Super Admin может выполнить коррекцию", 403);
    const state = await readState(tx);
    validateState(state, actorId, expectedVersion);
    const snapshots = await immutableSnapshots(tx);
    await tx.execute(sql`select set_config('app.qualification_identity_repair_scope', ${scope()}, true)`);
    await tx.update(squad).set({ playerId: IDENTITY_CORRECTION.targetPlayerId }).where(eq(squad.id, IDENTITY_CORRECTION.squadMemberId));
    await tx.update(invites).set({ playerId: IDENTITY_CORRECTION.targetPlayerId }).where(eq(invites.id, state.sourceInvitations[0].id));
    await tx.update(registrations).set({ playerId: IDENTITY_CORRECTION.targetPlayerId }).where(eq(registrations.id, state.sourceRegistrations[0].id));
    await tx.update(tournamentAttendance).set({ playerId: IDENTITY_CORRECTION.targetPlayerId }).where(and(eq(tournamentAttendance.tournamentId, IDENTITY_CORRECTION.finalTournamentId), eq(tournamentAttendance.playerId, IDENTITY_CORRECTION.sourcePlayerId)));
    await tx.update(events).set({ finalOutcome: sql`public.qualification_identity_repair_outcome(${events.finalOutcome}, ${IDENTITY_CORRECTION.sourcePlayerId}::uuid, ${IDENTITY_CORRECTION.targetPlayerId}::uuid)`, version: expectedVersion + 1, updatedAt: new Date() }).where(and(eq(events.id, IDENTITY_CORRECTION.eventId), eq(events.version, expectedVersion)));
    await tx.insert(audit).values({ eventId: IDENTITY_CORRECTION.eventId, actorId, action: "completed_identity_correction", detail: { oldPlayerId: IDENTITY_CORRECTION.sourcePlayerId, newPlayerId: IDENTITY_CORRECTION.targetPlayerId, qualificationEventId: IDENTITY_CORRECTION.eventId, finalTournamentId: IDENTITY_CORRECTION.finalTournamentId, squadMemberId: IDENTITY_CORRECTION.squadMemberId, reason: reason.trim(), expectedVersion } });
    const after = await readState(tx);
    if (after.event.status !== "completed" || after.event.version !== expectedVersion + 1 || after.squadRows.length !== 5 || new Set(after.squadRows.map(row => row.playerId)).size !== 5 || after.squadRows.some(row => row.playerId === IDENTITY_CORRECTION.sourcePlayerId) || !after.squadRows.some(row => row.playerId === IDENTITY_CORRECTION.targetPlayerId)) fail("Postflight identity проверки не пройдены");
    const afterSnapshots = await immutableSnapshots(tx);
    if (!sameRows(snapshots.results, afterSnapshots.results) || !sameRows(snapshots.achievements, afterSnapshots.achievements)) fail("Sporting results или achievements изменились во время коррекции");
    return { ok: true, eventId: IDENTITY_CORRECTION.eventId, version: expectedVersion + 1, oldPlayerId: IDENTITY_CORRECTION.sourcePlayerId, newPlayerId: IDENTITY_CORRECTION.targetPlayerId };
  }, { isolationLevel: "serializable" });
}
