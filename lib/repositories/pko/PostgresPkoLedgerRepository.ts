import "server-only";

import { asc, and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { players, registrations, tournaments, tournamentPkoEvents, tournamentAttendance, tournamentRebuyState } from "@/lib/db/schema";
import {
  parsePkoEvent,
  replayPkoEvents,
  type PkoEvent,
  type PkoSnapshot,
} from "@/lib/progressive-knockout-core";

export class PkoLedgerError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "PkoLedgerError";
  }
}

export type PkoLedgerRead = {
  revision: number;
  events: PkoEvent[];
  snapshot: PkoSnapshot;
  duplicate?: boolean;
};

/**
 * Transactional PKO event ledger.
 *
 * Every writer locks the same tournament row FOR UPDATE, so a pair of staff
 * devices cannot race a KO / re-entry / winner payout. The sequence is dense,
 * server-assigned and the client must pass expectedRevision for every write.
 * Same eventId + same normalized payload is idempotent, not awarded twice.
 *
 * PKO completion independently revalidates and freezes ledger totals
 * under the same tournament row lock before writing results.
 */
export class PostgresPkoLedgerRepository {
  private assertPkoTournament(t: { tournamentType: string; sourceMode: string; status: string; ratingFormulaVersion: string } | undefined) {
    if (!t) throw new PkoLedgerError("Турнир не найден", 404);
    if (t.tournamentType !== "progressive_knockout") throw new PkoLedgerError("PKO доступен только в турнире Progressive Knockout", 409);
    if (t.sourceMode !== "POSTGRESQL") throw new PkoLedgerError("Для PKO необходим PostgreSQL", 409);
    if (t.ratingFormulaVersion !== "v2") throw new PkoLedgerError("PKO требует Rating Engine v2", 409);
  }

  private fromRows(rows: readonly { sequence: number; eventId: string; eventData: PkoEvent }[]): PkoLedgerRead {
    for (const [index, row] of rows.entries()) {
      if (row.sequence !== index + 1 || row.eventId !== row.eventData.eventId) {
        throw new PkoLedgerError("История PKO повреждена: несогласованная последовательность", 500);
      }
    }
    const events = rows.map(row => parsePkoEvent(row.eventData));
    return { revision: events.length, events, snapshot: replayPkoEvents(events) };
  }

  async read(tournamentId: string): Promise<PkoLedgerRead> {
    const [t] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId));
    this.assertPkoTournament(t);
    const rows = await db.select({
      sequence: tournamentPkoEvents.sequence,
      eventId: tournamentPkoEvents.eventId,
      eventData: tournamentPkoEvents.eventData,
    }).from(tournamentPkoEvents).where(eq(tournamentPkoEvents.tournamentId, tournamentId))
      .orderBy(asc(tournamentPkoEvents.sequence));
    return this.fromRows(rows);
  }

  async append(input: {
    tournamentId: string;
    actorId: string;
    expectedRevision: number;
    event: unknown;
  }): Promise<PkoLedgerRead> {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision > 2147483646) {
      throw new PkoLedgerError("Некорректная версия журнала PKO", 400);
    }
    const event = parsePkoEvent(input.event);
    return db.transaction(async tx => {
      // This lock is the single writer serialization boundary for the tournament.
      const [t] = await tx.select().from(tournaments)
        .where(eq(tournaments.id, input.tournamentId)).for("update");
      this.assertPkoTournament(t);
      if (t!.status === "completed" || t!.status === "draft") {
        throw new PkoLedgerError("В турнире с этим статусом нельзя менять PKO", 409);
      }

      const [actor] = await tx.select().from(players)
        .where(eq(players.id, input.actorId)).for("share");
      if (!actor || !["admin", "operator"].includes(actor.role) || actor.isBlocked || actor.mergedIntoPlayerId) {
        throw new PkoLedgerError("Недостаточно прав на изменение PKO", 403);
      }

      const rows = await tx.select({
        sequence: tournamentPkoEvents.sequence,
        eventId: tournamentPkoEvents.eventId,
        eventData: tournamentPkoEvents.eventData,
      }).from(tournamentPkoEvents)
        .where(eq(tournamentPkoEvents.tournamentId, input.tournamentId))
        .orderBy(asc(tournamentPkoEvents.sequence));
      const current = this.fromRows(rows);

      const matching = current.events.find(existing => existing.eventId === event.eventId);
      if (matching) {
        if (JSON.stringify(matching) !== JSON.stringify(event)) {
          throw new PkoLedgerError("eventId уже использован с другим содержимым", 409);
        }
        return { ...current, duplicate: true };
      }
      if (current.revision !== input.expectedRevision) {
        throw new PkoLedgerError("PKO изменился в другой вкладке; обновите данные", 409);
      }
      if (current.snapshot.finished && event.kind !== "void_finish") throw new PkoLedgerError("PKO уже завершён", 409);

      if (event.kind === "entry") {
        // Re-entry must refer to the real registered player, never an
        // arbitrary account created by the client. Replay enforces at most
        // one active entry per player.
        const [registration] = await tx.select({ status: registrations.status }).from(registrations)
          .where(and(eq(registrations.tournamentId, input.tournamentId), eq(registrations.playerId, event.playerId)));
        if (!registration || !["registered", "attended"].includes(registration.status)) {
          throw new PkoLedgerError("Игрок не зарегистрирован в турнире", 409);
        }
        const [attendance] = await tx.select({ arrived: tournamentAttendance.arrived })
          .from(tournamentAttendance).where(and(
            eq(tournamentAttendance.tournamentId, input.tournamentId),
            eq(tournamentAttendance.playerId, event.playerId),
          ));
        if (!attendance?.arrived) throw new PkoLedgerError("Сначала отметьте игрока как «Пришёл»", 409);
        const [state] = await tx.select({ rebuys: tournamentRebuyState.rebuys, addons: tournamentRebuyState.addons })
          .from(tournamentRebuyState).where(and(
            eq(tournamentRebuyState.tournamentId, input.tournamentId),
            eq(tournamentRebuyState.playerId, event.playerId),
          )).for("update");
        const recordedEntries = current.snapshot.entries.filter(e => e.playerId === event.playerId).length;
        if ((state?.rebuys ?? 0) !== recordedEntries) throw new PkoLedgerError("Количество входов расходится с журналом PKO", 409);
      }

      // All points/conservation/share rules validate BEFORE touching storage.
      const next = replayPkoEvents([...current.events, event]);
      await tx.insert(tournamentPkoEvents).values({
        tournamentId: input.tournamentId,
        sequence: current.revision + 1,
        eventId: event.eventId,
        eventData: event,
        actorId: input.actorId,
      });
      if (event.kind === "entry") {
        // A PKO entry and its ordinary total-entries counter are one atomic
        // fact. No separate manual re-buy edit or two-step UI race.
        const totalEntries = next.entries.filter(e => e.playerId === event.playerId).length;
        await tx.insert(tournamentRebuyState).values({
          tournamentId: input.tournamentId, playerId: event.playerId, rebuys: totalEntries, addons: 0,
        }).onConflictDoUpdate({
          target: [tournamentRebuyState.tournamentId, tournamentRebuyState.playerId],
          set: { rebuys: totalEntries, updatedAt: new Date() },
        });
      }
      return { revision: current.revision + 1, events: [...current.events, event], snapshot: next };
    });
  }

  /** Allow Add-on corrections without ever editing ledger-owned entry counts. */
  async updateAddons(input: {
    tournamentId: string; playerId: string; actorId: string;
    expectedEntries: number; addons: number;
  }): Promise<{ rebuys: number; addons: number }> {
    if (![input.expectedEntries, input.addons].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647)) {
      throw new PkoLedgerError("Некорректные входы или Add-on", 400);
    }
    return db.transaction(async tx => {
      const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, input.tournamentId)).for("update");
      this.assertPkoTournament(t);
      if (t!.status === "completed" || t!.status === "draft") throw new PkoLedgerError("Турнир не редактируется", 409);
      const [actor] = await tx.select().from(players).where(eq(players.id, input.actorId)).for("share");
      if (!actor || !["admin", "operator"].includes(actor.role) || actor.isBlocked || actor.mergedIntoPlayerId) {
        throw new PkoLedgerError("Недостаточно прав", 403);
      }
      const [registration] = await tx.select({ status: registrations.status }).from(registrations).where(and(
        eq(registrations.tournamentId, input.tournamentId), eq(registrations.playerId, input.playerId),
      ));
      if (!registration || !["registered", "attended"].includes(registration.status)) throw new PkoLedgerError("Игрок не зарегистрирован", 409);
      const eventRows = await tx.select({ eventData: tournamentPkoEvents.eventData }).from(tournamentPkoEvents)
        .where(eq(tournamentPkoEvents.tournamentId, input.tournamentId)).orderBy(asc(tournamentPkoEvents.sequence));
      const snapshot = replayPkoEvents(eventRows.map(x => x.eventData));
      const totalEntries = snapshot.entries.filter(entry => entry.playerId === input.playerId).length;
      if (input.expectedEntries !== totalEntries) throw new PkoLedgerError("Входы изменились в PKO — обновите страницу", 409);
      const [current] = await tx.select({ rebuys: tournamentRebuyState.rebuys }).from(tournamentRebuyState)
        .where(and(eq(tournamentRebuyState.tournamentId, input.tournamentId), eq(tournamentRebuyState.playerId, input.playerId)))
        .for("update");
      if ((current?.rebuys ?? 0) !== totalEntries) throw new PkoLedgerError("Счётчик входов расходится с журналом", 409);
      await tx.insert(tournamentRebuyState).values({
        tournamentId: input.tournamentId, playerId: input.playerId, rebuys: totalEntries, addons: input.addons,
      }).onConflictDoUpdate({
        target: [tournamentRebuyState.tournamentId, tournamentRebuyState.playerId],
        set: { addons: input.addons, updatedAt: new Date() },
      });
      return { rebuys: totalEntries, addons: input.addons };
    });
  }

}

export const pkoLedgerRepository = new PostgresPkoLedgerRepository();
