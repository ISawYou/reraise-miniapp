import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { players, results, registrations, tournaments, tournamentAttendance, tournamentPlayerEliminations, tournamentOperations, qualificationEvents as events, qualificationInvitations as invites, qualificationSquad as squad, playerAchievements } from "@/lib/db/schema";

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

async function readState(tx: Executor) {
  const [event] = await tx.select().from(events).where(eq(events.id, IDENTITY_CORRECTION.eventId));
  if (!event) fail("Квалификационное событие не найдено", 404);
  if (event.finalTournamentId !== IDENTITY_CORRECTION.finalTournamentId) fail("Финал события не совпадает с утверждённым финалом");
  const [finalTournament] = await tx.select().from(tournaments).where(eq(tournaments.id, IDENTITY_CORRECTION.finalTournamentId));
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
  const invitationRows = await tx.select().from(invites).where(eq(invites.eventId, IDENTITY_CORRECTION.eventId));
  const registrationRows = await tx.select().from(registrations).where(eq(registrations.tournamentId, IDENTITY_CORRECTION.finalTournamentId));
  const attendanceRows = await tx.select().from(tournamentAttendance).where(eq(tournamentAttendance.tournamentId, IDENTITY_CORRECTION.finalTournamentId));
  return { event, finalTournament, sourcePlayer, targetPlayer, squadRows, sourceSquad, sourceInvitations, targetInvitations, sourceRegistrations, targetRegistrations, sourceAttendance, targetAttendance, invitationRows, registrationRows, attendanceRows };
}

function validateState(state: CorrectionState, actorId?: string, expectedVersion?: number) {
  const { event, sourcePlayer: source, targetPlayer: target } = state;
  if (event.status !== "completed" || !event.squadConfirmedAt || !event.finalOutcome) fail("Событие не находится в подтверждённом completed-состоянии");
  if (event.version !== (expectedVersion ?? 39)) fail(`Версия события изменилась: ожидается ${expectedVersion ?? 39}, фактически ${event.version}`);
  if (!source || source.id !== IDENTITY_CORRECTION.sourcePlayerId || source.displayName !== "PlaYa_btw" || source.isBlocked || source.mergedIntoPlayerId) fail("Исходный аккаунт не соответствует утверждённому состоянию");
  if (!target || target.id !== IDENTITY_CORRECTION.targetPlayerId || target.displayName !== "PlaYa_btw" || target.isBlocked || target.mergedIntoPlayerId || !target.telegramId) fail("Целевой основной аккаунт не соответствует утверждённому состоянию");
  if (state.finalTournament?.id !== IDENTITY_CORRECTION.finalTournamentId) fail("Утверждённый финал не найден");
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
    results: await tx.select().from(results).where(eq(results.tournamentId, IDENTITY_CORRECTION.finalTournamentId)),
    eliminations: await tx.select().from(tournamentPlayerEliminations).where(eq(tournamentPlayerEliminations.tournamentId, IDENTITY_CORRECTION.finalTournamentId)),
    operations: await tx.select().from(tournamentOperations).where(eq(tournamentOperations.tournamentId, IDENTITY_CORRECTION.finalTournamentId)),
    players: await tx.select().from(players).where(inArray(players.id, ids)),
    achievements: await tx.select().from(playerAchievements).where(inArray(playerAchievements.playerId, ids)),
  };
}

function sameRows(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function assertOneAffected(rows: unknown[], label: string) { if (rows.length !== 1) fail(`Postflight: ${label}: ожидалась ровно одна изменённая строка, получено ${rows.length}`); }
function replacementFor(operation: "apply" | "reverse") { return operation === "apply" ? { from: IDENTITY_CORRECTION.sourcePlayerId, to: IDENTITY_CORRECTION.targetPlayerId } : { from: IDENTITY_CORRECTION.targetPlayerId, to: IDENTITY_CORRECTION.sourcePlayerId }; }
function normalizeRows(rows: Array<{ playerId: string }>, operation: "apply" | "reverse") { const { from, to } = replacementFor(operation); return rows.map(row => ({ ...row, playerId: row.playerId === from ? to : row.playerId })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); }
function expectedOutcome(value: NonNullable<CorrectionState["event"]["finalOutcome"]>, operation: "apply" | "reverse") { const { from, to } = replacementFor(operation); return { ...value, survivorIds: value.survivorIds.map(id => id === from ? to : id), arrivedIds: value.arrivedIds.map(id => id === from ? to : id), eliminations: value.eliminations.map(row => ({ ...row, playerId: row.playerId === from ? to : row.playerId })) }; }
function permitRow(value: unknown) { const row = (value as Array<{ permit_id: string; audit_id: string }>)[0]; if (!row?.permit_id || !row.audit_id) fail("DB permit не создан", 503); return row; }

function assertPostflight(before: CorrectionState, after: CorrectionState, operation: "apply" | "reverse", expectedVersion: number, snapshots: Awaited<ReturnType<typeof immutableSnapshots>>, afterSnapshots: Awaited<ReturnType<typeof immutableSnapshots>>) {
  const { from, to } = replacementFor(operation);
  if (after.event.status !== "completed" || after.event.version !== expectedVersion + 1 || after.event.finalTournamentId !== IDENTITY_CORRECTION.finalTournamentId) fail("Postflight: финал должен остаться completed и версия должна увеличиться ровно на 1");
  if (after.squadRows.length !== 5 || new Set(after.squadRows.map(row => row.playerId)).size !== 5 || after.squadRows.some(row => row.playerId === from) || !after.squadRows.some(row => row.playerId === to)) fail("Postflight: squad identity не соответствует точечной замене");
  if (!sameRows(normalizeRows(before.squadRows, operation), normalizeRows(after.squadRows, operation))) fail("Postflight: squad изменён не только по player_id");
  if (!sameRows(normalizeRows(before.invitationRows, operation), normalizeRows(after.invitationRows, operation))) fail("Postflight: invitations изменены не только по player_id");
  if (!sameRows(normalizeRows(before.registrationRows, operation), normalizeRows(after.registrationRows, operation))) fail("Postflight: registrations изменены не только по player_id");
  if (!sameRows(normalizeRows(before.attendanceRows, operation), normalizeRows(after.attendanceRows, operation))) fail("Postflight: attendance изменён не только по player_id");
  if (!sameRows(expectedOutcome(before.event.finalOutcome!, operation), after.event.finalOutcome)) fail("Postflight: frozen final outcome не соответствует точечной замене");
  const beforeEvent = { ...before.event, finalOutcome: undefined, version: undefined, updatedAt: undefined };
  const afterEvent = { ...after.event, finalOutcome: undefined, version: undefined, updatedAt: undefined };
  if (!sameRows(beforeEvent, afterEvent)) fail("Postflight: изменены поля события вне identity correction");
  if (!sameRows(snapshots.results, afterSnapshots.results) || !sameRows(snapshots.eliminations, afterSnapshots.eliminations) || !sameRows(snapshots.operations, afterSnapshots.operations) || !sameRows(snapshots.players, afterSnapshots.players) || !sameRows(snapshots.achievements, afterSnapshots.achievements)) fail("Postflight: спортивные данные, timestamps, роли, rating или achievements изменились");
}
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
    const permit = permitRow(await tx.execute(sql`SELECT * FROM public.qualification_identity_repair_begin(${actorId}::uuid, ${expectedVersion}, ${reason.trim()})`));
    assertOneAffected(await tx.execute(sql`UPDATE public.qualification_squad_members SET player_id=${IDENTITY_CORRECTION.targetPlayerId}::uuid WHERE id=${state.sourceSquad!.id}::uuid RETURNING id`), "squad");
    assertOneAffected(await tx.execute(sql`UPDATE public.qualification_invitations SET player_id=${IDENTITY_CORRECTION.targetPlayerId}::uuid WHERE id=${state.sourceInvitations[0].id}::uuid RETURNING id`), "invitation");
    assertOneAffected(await tx.execute(sql`UPDATE public.registrations SET player_id=${IDENTITY_CORRECTION.targetPlayerId}::uuid WHERE id=${state.sourceRegistrations[0].id}::uuid RETURNING id`), "registration");
    assertOneAffected(await tx.execute(sql`UPDATE public.tournament_attendance SET player_id=${IDENTITY_CORRECTION.targetPlayerId}::uuid WHERE tournament_id=${IDENTITY_CORRECTION.finalTournamentId}::uuid AND player_id=${IDENTITY_CORRECTION.sourcePlayerId}::uuid RETURNING player_id`), "attendance");
    assertOneAffected(await tx.update(events).set({ finalOutcome: sql`public.qualification_identity_repair_outcome(${events.finalOutcome}, ${IDENTITY_CORRECTION.sourcePlayerId}::uuid, ${IDENTITY_CORRECTION.targetPlayerId}::uuid)`, version: expectedVersion + 1, updatedAt: new Date() }).where(and(eq(events.id, IDENTITY_CORRECTION.eventId), eq(events.version, expectedVersion))).returning({ id: events.id }), "final outcome");
    const after = await readState(tx);
    const afterSnapshots = await immutableSnapshots(tx);
    assertPostflight(state, after, "apply", expectedVersion, snapshots, afterSnapshots);
    await tx.execute(sql`SELECT public.qualification_identity_repair_finish(${permit.permit_id}::uuid)`);
    return { ok: true, auditId: permit.audit_id, eventId: IDENTITY_CORRECTION.eventId, version: expectedVersion + 1, oldPlayerId: IDENTITY_CORRECTION.sourcePlayerId, newPlayerId: IDENTITY_CORRECTION.targetPlayerId };
  }, { isolationLevel: "serializable" });
}

function validateReversalState(state: CorrectionState, expectedVersion: number) {
  if (state.event.status !== "completed" || !state.event.squadConfirmedAt || !state.event.finalOutcome || state.event.version !== expectedVersion) fail("Событие не соответствует безопасному reversal");
  if (state.finalTournament?.id !== IDENTITY_CORRECTION.finalTournamentId) fail("Утверждённый финал не найден");
  if (state.squadRows.length !== 5 || new Set(state.squadRows.map(row => row.playerId)).size !== 5 || state.squadRows.some(row => row.playerId === IDENTITY_CORRECTION.sourcePlayerId) || !state.squadRows.some(row => row.playerId === IDENTITY_CORRECTION.targetPlayerId)) fail("Текущий squad не соответствует reversal");
  if (state.sourceInvitations.length || state.targetInvitations.length !== 1 || state.targetInvitations[0].status !== "accepted") fail("Текущие invitations не соответствуют reversal");
  if (state.sourceRegistrations.length || state.targetRegistrations.length !== 1 || !["registered", "attended"].includes(state.targetRegistrations[0].status)) fail("Текущие registrations не соответствуют reversal");
  if (state.sourceAttendance.length || state.targetAttendance.length !== 1 || !state.targetAttendance[0].arrived) fail("Текущий attendance не соответствует reversal");
  if (!state.event.finalOutcome.survivorIds.includes(IDENTITY_CORRECTION.targetPlayerId) || state.event.finalOutcome.survivorIds.includes(IDENTITY_CORRECTION.sourcePlayerId) || !state.event.finalOutcome.arrivedIds.includes(IDENTITY_CORRECTION.targetPlayerId) || state.event.finalOutcome.arrivedIds.includes(IDENTITY_CORRECTION.sourcePlayerId)) fail("Frozen outcome не соответствует reversal");
}

export async function reverseCompletedIdentityCorrection(actorId: string, originalAuditId: string, expectedVersion: number, reason: string) {
  if (process.env.DATABASE_PROVIDER !== "postgres") fail("Коррекция требует PostgreSQL", 503);
  if (reason.trim().length < 10 || reason.trim().length > 500) fail("Укажите причину reversal от 10 до 500 символов", 400);
  return db.transaction(async tx => {
    const [actor] = await tx.select({ id: players.id, role: players.role, isBlocked: players.isBlocked, mergedIntoPlayerId: players.mergedIntoPlayerId }).from(players).where(eq(players.id, actorId)).for("update");
    if (!actor || actor.role !== "admin" || actor.isBlocked || actor.mergedIntoPlayerId) fail("Только действующий Super Admin может выполнить reversal", 403);
    const state = await readState(tx);
    validateReversalState(state, expectedVersion);
    const snapshots = await immutableSnapshots(tx);
    const permit = permitRow(await tx.execute(sql`SELECT * FROM public.qualification_identity_repair_begin_reversal(${actorId}::uuid, ${originalAuditId}::uuid, ${expectedVersion}, ${reason.trim()})`));
    assertOneAffected(await tx.execute(sql`UPDATE public.qualification_squad_members SET player_id=${IDENTITY_CORRECTION.sourcePlayerId}::uuid WHERE id=${state.squadRows.find(row => row.playerId === IDENTITY_CORRECTION.targetPlayerId)!.id}::uuid RETURNING id`), "squad reversal");
    assertOneAffected(await tx.execute(sql`UPDATE public.qualification_invitations SET player_id=${IDENTITY_CORRECTION.sourcePlayerId}::uuid WHERE id=${state.targetInvitations[0].id}::uuid RETURNING id`), "invitation reversal");
    assertOneAffected(await tx.execute(sql`UPDATE public.registrations SET player_id=${IDENTITY_CORRECTION.sourcePlayerId}::uuid WHERE id=${state.targetRegistrations[0].id}::uuid RETURNING id`), "registration reversal");
    assertOneAffected(await tx.execute(sql`UPDATE public.tournament_attendance SET player_id=${IDENTITY_CORRECTION.sourcePlayerId}::uuid WHERE tournament_id=${IDENTITY_CORRECTION.finalTournamentId}::uuid AND player_id=${IDENTITY_CORRECTION.targetPlayerId}::uuid RETURNING player_id`), "attendance reversal");
    assertOneAffected(await tx.update(events).set({ finalOutcome: sql`public.qualification_identity_repair_outcome(${events.finalOutcome}, ${IDENTITY_CORRECTION.targetPlayerId}::uuid, ${IDENTITY_CORRECTION.sourcePlayerId}::uuid)`, version: expectedVersion + 1, updatedAt: new Date() }).where(and(eq(events.id, IDENTITY_CORRECTION.eventId), eq(events.version, expectedVersion))).returning({ id: events.id }), "final outcome reversal");
    const after = await readState(tx);
    const afterSnapshots = await immutableSnapshots(tx);
    assertPostflight(state, after, "reverse", expectedVersion, snapshots, afterSnapshots);
    await tx.execute(sql`SELECT public.qualification_identity_repair_finish(${permit.permit_id}::uuid)`);
    return { ok: true, auditId: permit.audit_id, originalAuditId, eventId: IDENTITY_CORRECTION.eventId, version: expectedVersion + 1, oldPlayerId: IDENTITY_CORRECTION.targetPlayerId, newPlayerId: IDENTITY_CORRECTION.sourcePlayerId };
  }, { isolationLevel: "serializable" });
}
