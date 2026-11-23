import type { RatingPointsV2Result } from "@/features/rating-v2";
import {
  PkoAccountingError,
  replayPkoEvents,
  type PkoEvent,
  type PkoSnapshot,
} from "@/lib/progressive-knockout-core";

export type PkoCompletionPlayer = {
  player_id: string;
  place: number;
  arrived: boolean | null | undefined;
  entries: number;
};

export type PkoCompletionAllocation = {
  winnerPlayerId: string;
  perPlayer: ReadonlyMap<string, { points: number; soloKnockouts: number; entries: number }>;
  snapshot: PkoSnapshot;
};

/**
 * The PKO ledger, not a manually edited KO counter, is the only authority
 * for PKO rating. Every physical entry must match the free-tournament total
 * entries field. A shared KO is awarded by explicit points, never by an
 * inferred winner-of-main-pot tie-break.
 */
export function validatePkoCompletion(
  rows: readonly PkoCompletionPlayer[],
  events: readonly PkoEvent[],
): PkoCompletionAllocation {
  const snapshot = replayPkoEvents(events);
  if (!snapshot.finished || snapshot.outstandingBounty !== 0 ||
      snapshot.distributedRatingPoints !== snapshot.totalBountyCreated) {
    throw new PkoAccountingError("PKO: сначала завершите журнал и начислите остаток баунти победителю");
  }
  const winners = snapshot.entries.filter(entry => entry.status === "winner");
  if (winners.length !== 1) throw new PkoAccountingError("PKO: должен быть ровно один победитель");
  const winner = winners[0].playerId;
  const byId = new Map<string, PkoCompletionPlayer>();
  for (const row of rows) {
    if (byId.has(row.player_id)) throw new PkoAccountingError("PKO: повторяющийся игрок в результатах");
    byId.set(row.player_id, row);
  }
  if (byId.size !== rows.length || !byId.get(winner) || byId.get(winner)?.place !== 1) {
    throw new PkoAccountingError("PKO: первое место должно принадлежать победителю журнала");
  }
  const soloCounts = new Map<string, number>();
  const entryOwner = new Map(snapshot.entries.map(entry => [entry.entryId, entry.playerId]));
  for (const event of events) {
    if (event.kind !== "knockout" || snapshot.voidedKnockoutIds.includes(event.eventId)) continue;
    // Only an unambiguous sole KO recipient is represented in the legacy
    // numeric KO count. Explicitly split KO shares live in the event ledger.
    if (event.shares.length === 1) {
      const playerId = entryOwner.get(event.shares[0].recipientEntryId);
      if (!playerId) throw new PkoAccountingError("PKO: неизвестный получатель нокаута");
      soloCounts.set(playerId, (soloCounts.get(playerId) ?? 0) + 1);
    }
  }
  const perPlayer = new Map<string, { points: number; soloKnockouts: number; entries: number }>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.entries) || row.entries < 0) {
      throw new PkoAccountingError("PKO: некорректное количество входов");
    }
    const ledger = snapshot.players.find(p => p.playerId === row.player_id);
    const count = ledger?.entryCount ?? 0;
    if (row.arrived && (count === 0 || row.entries !== count)) {
      throw new PkoAccountingError("PKO: число входов в журнале не совпадает с карточкой игрока " + row.player_id);
    }
    if (!row.arrived && (count !== 0 || row.entries !== 0)) {
      throw new PkoAccountingError("PKO: у отсутствующего игрока не должно быть входов");
    }
    perPlayer.set(row.player_id, {
      points: ledger?.totalPkoRatingPoints ?? 0,
      soloKnockouts: soloCounts.get(row.player_id) ?? 0,
      entries: count,
    });
  }
  if (snapshot.players.some(player => !byId.has(player.playerId))) {
    throw new PkoAccountingError("PKO: журнал содержит игрока вне официального состава");
  }
  return { winnerPlayerId: winner, snapshot, perPlayer };
}

export function addPkoRatingPoints(
  base: readonly RatingPointsV2Result[],
  allocation: PkoCompletionAllocation,
): RatingPointsV2Result[] {
  return base.map(result => {
    const award = allocation.perPlayer.get(result.player_id);
    if (!award) throw new PkoAccountingError("PKO: нет игрока для начисления рейтинга");
    return {
      ...result,
      knockout_points: result.knockout_points + award.points,
      rating_points: result.rating_points + award.points,
    };
  });
}
