/**
 * Pure PKO accounting. No database, ratings or tournament completion writes.
 * A durable, permission-checked transactional ledger must call this logic.
 * Split KO recipients/shares are always explicit administrator inputs:
 * this module deliberately does NOT invent a side-pot or odd-unit tie-break.
 */
export const PKO_STARTING_BOUNTY = 6;

export type PkoEntry = {
  entryId: string;
  playerId: string;
  bounty: number;
  earnedKoPoints: number;
  winnerBountyPoints: number;
  status: "active" | "eliminated" | "winner";
};

export type PkoEvent =
  | { eventId: string; kind: "entry"; entryId: string; playerId: string }
  | { eventId: string; kind: "knockout"; eliminatedEntryId: string; shares: readonly { recipientEntryId: string; points: number }[] }
  | { eventId: string; kind: "finish"; winnerEntryId: string }
  | { eventId: string; kind: "void_knockout"; targetEventId: string };

export type PkoPlayerTotals = {
  playerId: string;
  earnedKoPoints: number;
  winnerBountyPoints: number;
  totalPkoRatingPoints: number;
  entryCount: number;
};

export type PkoSnapshot = {
  entries: PkoEntry[];
  players: PkoPlayerTotals[];
  totalBountyCreated: number;
  distributedRatingPoints: number;
  outstandingBounty: number;
  finished: boolean;
  voidedKnockoutIds: string[];
};

export class PkoAccountingError extends Error {
  constructor(message: string) { super(message); this.name = "PkoAccountingError"; }
}

function nonemptyId(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) throw new PkoAccountingError(`${label} is required`);
}
function safePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new PkoAccountingError(`${label} must be a positive safe integer`);
}
function safeSum(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new PkoAccountingError("PKO points integer overflow");
  return sum;
}

export function splitPkoBounty(share: number): { earnedPoints: number; growingBounty: number } {
  safePositiveInteger(share, "Bounty share");
  const earnedPoints = Math.floor(share / 2);
  return { earnedPoints, growingBounty: share - earnedPoints };
}

/**
 * Replays the immutable event stream from scratch. A void is accepted only
 * when all subsequent ledger events still form a valid, conserved history.
 * All writes/audit/idempotency/permissions belong to the caller's DB txn.
 */
export function replayPkoEvents(events: readonly PkoEvent[]): PkoSnapshot {
  const seen = new Map<string, PkoEvent>();
  const voided = new Set<string>();

  for (const event of events) {
    nonemptyId(event.eventId, "eventId");
    if (seen.has(event.eventId)) throw new PkoAccountingError(`Duplicate eventId: ${event.eventId}`);
    if (event.kind === "void_knockout") {
      nonemptyId(event.targetEventId, "targetEventId");
      const target = seen.get(event.targetEventId);
      if (!target || target.kind !== "knockout") throw new PkoAccountingError("Can void only an earlier knockout event");
      if (voided.has(event.targetEventId)) throw new PkoAccountingError("Knockout already voided");
      voided.add(event.targetEventId);
    }
    seen.set(event.eventId, event);
  }

  const entries = new Map<string, PkoEntry>();
  let created = 0;
  let finished = false;

  for (const event of events) {
    if (finished) throw new PkoAccountingError("No events allowed after tournament finish");
    if (event.kind === "void_knockout") continue;
    if (event.kind === "knockout" && voided.has(event.eventId)) continue;

    if (event.kind === "entry") {
      nonemptyId(event.entryId, "entryId");
      nonemptyId(event.playerId, "playerId");
      if (entries.has(event.entryId)) throw new PkoAccountingError(`Entry already exists: ${event.entryId}`);
      if ([...entries.values()].some(x => x.playerId === event.playerId && x.status === "active")) {
        throw new PkoAccountingError("Player already has an active entry");
      }
      entries.set(event.entryId, {
        entryId: event.entryId, playerId: event.playerId,
        bounty: PKO_STARTING_BOUNTY, earnedKoPoints: 0, winnerBountyPoints: 0, status: "active",
      });
      created = safeSum(created, PKO_STARTING_BOUNTY);
      continue;
    }

    if (event.kind === "knockout") {
      nonemptyId(event.eliminatedEntryId, "eliminatedEntryId");
      const eliminated = entries.get(event.eliminatedEntryId);
      if (!eliminated || eliminated.status !== "active") throw new PkoAccountingError("Eliminated entry is not active");
      if (!Array.isArray(event.shares) || event.shares.length === 0) throw new PkoAccountingError("Explicit KO shares required");
      const recipients = new Set<string>();
      let shareTotal = 0;
      for (const share of event.shares) {
        nonemptyId(share.recipientEntryId, "recipientEntryId");
        safePositiveInteger(share.points, "KO share");
        if (share.recipientEntryId === eliminated.entryId || recipients.has(share.recipientEntryId)) {
          throw new PkoAccountingError("Duplicate or self-recipient KO share");
        }
        const recipient = entries.get(share.recipientEntryId);
        if (!recipient || recipient.status !== "active") throw new PkoAccountingError("KO recipient is not active");
        recipients.add(share.recipientEntryId);
        shareTotal = safeSum(shareTotal, share.points);
      }
      if (shareTotal !== eliminated.bounty) throw new PkoAccountingError("KO shares must exactly equal eliminated bounty");
      for (const share of event.shares) {
        const recipient = entries.get(share.recipientEntryId)!;
        const split = splitPkoBounty(share.points);
        recipient.earnedKoPoints = safeSum(recipient.earnedKoPoints, split.earnedPoints);
        recipient.bounty = safeSum(recipient.bounty, split.growingBounty);
      }
      eliminated.bounty = 0;
      eliminated.status = "eliminated";
      continue;
    }

    if (event.kind === "finish") {
      nonemptyId(event.winnerEntryId, "winnerEntryId");
      const active = [...entries.values()].filter(x => x.status === "active");
      if (active.length !== 1 || active[0].entryId !== event.winnerEntryId) {
        throw new PkoAccountingError("Finish requires exactly one surviving entry");
      }
      const winner = active[0];
      winner.winnerBountyPoints = safeSum(winner.winnerBountyPoints, winner.bounty);
      winner.bounty = 0;
      winner.status = "winner";
      finished = true;
    }
  }

  const all = [...entries.values()];
  const byPlayer = new Map<string, PkoPlayerTotals>();
  let outstandingBounty = 0;
  let distributedRatingPoints = 0;
  for (const entry of all) {
    outstandingBounty = safeSum(outstandingBounty, entry.bounty);
    distributedRatingPoints = safeSum(distributedRatingPoints, safeSum(entry.earnedKoPoints, entry.winnerBountyPoints));
    const prev = byPlayer.get(entry.playerId) ?? { playerId: entry.playerId, earnedKoPoints: 0, winnerBountyPoints: 0, totalPkoRatingPoints: 0, entryCount: 0 };
    prev.earnedKoPoints = safeSum(prev.earnedKoPoints, entry.earnedKoPoints);
    prev.winnerBountyPoints = safeSum(prev.winnerBountyPoints, entry.winnerBountyPoints);
    prev.totalPkoRatingPoints = safeSum(prev.earnedKoPoints, prev.winnerBountyPoints);
    prev.entryCount += 1;
    byPlayer.set(entry.playerId, prev);
  }
  if (safeSum(distributedRatingPoints, outstandingBounty) !== created) throw new PkoAccountingError("PKO bounty conservation violated");
  return {
    entries: all, players: [...byPlayer.values()], totalBountyCreated: created,
    distributedRatingPoints, outstandingBounty, finished,
    voidedKnockoutIds: [...voided],
  };
}
/** Parse an untrusted staff API payload. The replay engine accepts typed events;
 * this parser is the mandatory JSON boundary so unknown kinds/keys cannot
 * silently become no-op ledger records. */
export function parsePkoEvent(raw: unknown): PkoEvent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PkoAccountingError("PKO event must be an object");
  const obj = raw as Record<string, unknown>;
  const id = (value: unknown, label: string): string => {
    if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > 128) {
      throw new PkoAccountingError(`${label} must be a nonempty ID (max 128 characters)`);
    }
    return value;
  };
  const only = (keys: readonly string[]) => {
    if (Object.keys(obj).some(key => !keys.includes(key))) throw new PkoAccountingError("Unexpected PKO event field");
  };
  const eventId = id(obj.eventId, "eventId");
  switch (obj.kind) {
    case "entry":
      only(["kind", "eventId", "entryId", "playerId"]);
      return { kind: "entry", eventId, entryId: id(obj.entryId, "entryId"), playerId: id(obj.playerId, "playerId") };
    case "knockout": {
      only(["kind", "eventId", "eliminatedEntryId", "shares"]);
      if (!Array.isArray(obj.shares) || obj.shares.length < 1 || obj.shares.length > 100) {
        throw new PkoAccountingError("PKO knockout requires 1..100 explicit recipient shares");
      }
      const shares = obj.shares.map((rawShare: unknown) => {
        if (!rawShare || typeof rawShare !== "object" || Array.isArray(rawShare)) throw new PkoAccountingError("Invalid PKO share");
        const share = rawShare as Record<string, unknown>;
        if (Object.keys(share).some(key => !["recipientEntryId", "points"].includes(key))) throw new PkoAccountingError("Unexpected PKO share field");
        if (!Number.isSafeInteger(share.points) || (share.points as number) <= 0) throw new PkoAccountingError("Invalid PKO share points");
        return { recipientEntryId: id(share.recipientEntryId, "recipientEntryId"), points: share.points as number };
      });
      return { kind: "knockout", eventId, eliminatedEntryId: id(obj.eliminatedEntryId, "eliminatedEntryId"), shares };
    }
    case "void_knockout":
      only(["kind", "eventId", "targetEventId"]);
      return { kind: "void_knockout", eventId, targetEventId: id(obj.targetEventId, "targetEventId") };
    case "finish":
      only(["kind", "eventId", "winnerEntryId"]);
      return { kind: "finish", eventId, winnerEntryId: id(obj.winnerEntryId, "winnerEntryId") };
    default:
      throw new PkoAccountingError("Unknown PKO event kind");
  }
}
