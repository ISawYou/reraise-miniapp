import { createHash } from "node:crypto";
import { tournamentNotificationBroadcastRepository } from "@/lib/repositories";
import type {
  TournamentNotificationBroadcastError,
  TournamentNotificationBroadcastRow,
} from "@/lib/repositories";

// Broadcast idempotency for POST /api/admin/tournaments/notify (real sends:
// mass send and Test Send; a dry run never reaches this module).
//
// Incident 2026-10-21/22: the client auto-retried the mass-send POST after
// nginx's 60s 504 while the first request's send loop kept running, and the
// server re-sent the whole broadcast. Invariant enforced here: for a given
// client-generated broadcastId the Telegram send loop runs AT MOST ONCE,
// ever -- regardless of concurrent or later repeats of the same request.
//
// Policy:
//   - claim = one atomic INSERT ... ON CONFLICT (broadcast_id) DO NOTHING
//     (repository), done BEFORE the first sendMessage;
//   - lost the claim / row already exists:
//       processing -> "already_processing" (fast, no send, no waiting);
//       completed  -> "already_completed" with the stored result, no send;
//       failed     -> "failed" (manual review), no send;
//     and in every case a different payload fingerprint -> mismatch (409);
//   - a crash mid-loop leaves the row 'processing' forever; an unexpected
//     error inside the loop marks it 'failed'. Neither is ever re-sent under
//     the same broadcastId: an ambiguous failure biases toward "possibly
//     missed", never "definitely duplicated".
//   - idempotency is keyed on broadcastId only, NEVER on message content.

export type BroadcastAudience = "registered" | "access";

export type BroadcastPayload = {
  tournamentId: string;
  audience: BroadcastAudience;
  message: string;
  testMode: boolean;
  testTelegramId: number | null;
};

export type BroadcastRecipient = {
  player_id: string;
  telegram_id: number | null;
  display_name: string;
};

export type BroadcastSendOutcome = { ok: true } | { ok: false; error: string };

export type BroadcastResult = {
  totalRecipients: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  errors: TournamentNotificationBroadcastError[];
};

export type BroadcastExistingOutcome =
  | { kind: "already_processing"; row: TournamentNotificationBroadcastRow }
  | { kind: "already_completed"; row: TournamentNotificationBroadcastRow }
  | { kind: "failed"; row: TournamentNotificationBroadcastRow }
  | { kind: "fingerprint_mismatch" };

export type BroadcastRunOutcome = { kind: "sent"; result: BroadcastResult } | BroadcastExistingOutcome;

const LOG_PREFIX = "[notify-broadcast]";

// Deterministic, server-side. The message itself is hashed, never stored.
export function computeBroadcastFingerprint(payload: BroadcastPayload): string {
  const canonical = JSON.stringify([
    "v1",
    payload.tournamentId,
    payload.audience,
    payload.message,
    payload.testMode,
    payload.testMode ? payload.testTelegramId : null,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function classifyExistingBroadcast(
  row: TournamentNotificationBroadcastRow,
  fingerprint: string
): BroadcastExistingOutcome {
  if (row.payload_fingerprint !== fingerprint) {
    return { kind: "fingerprint_mismatch" };
  }
  if (row.status === "completed") {
    return { kind: "already_completed", row };
  }
  if (row.status === "failed") {
    return { kind: "failed", row };
  }
  return { kind: "already_processing", row };
}

function logDuplicate(broadcastId: string, outcome: BroadcastExistingOutcome) {
  console.info(`${LOG_PREFIX} duplicate`, {
    broadcastId,
    state: outcome.kind === "fingerprint_mismatch" ? "fingerprint_mismatch" : outcome.row.status,
  });
}

// Cheap pre-check so a repeat of an already-known broadcastId is answered
// immediately (before any recipient lookup). NOT the race arbiter -- that is
// claim() inside runTournamentBroadcast.
export async function findExistingBroadcast(
  broadcastId: string,
  fingerprint: string
): Promise<BroadcastExistingOutcome | null> {
  const row = await tournamentNotificationBroadcastRepository.findByBroadcastId(broadcastId);
  if (!row) {
    return null;
  }
  const outcome = classifyExistingBroadcast(row, fingerprint);
  logDuplicate(broadcastId, outcome);
  return outcome;
}

export async function runTournamentBroadcast(input: {
  broadcastId: string;
  payload: BroadcastPayload;
  recipients: BroadcastRecipient[];
  skippedCount: number;
  send: (recipient: BroadcastRecipient & { telegram_id: number }) => Promise<BroadcastSendOutcome>;
}): Promise<BroadcastRunOutcome> {
  const { broadcastId, payload, recipients } = input;
  const fingerprint = computeBroadcastFingerprint(payload);

  const claim = await tournamentNotificationBroadcastRepository.claim({
    broadcast_id: broadcastId,
    payload_fingerprint: fingerprint,
    tournament_id: payload.tournamentId,
    audience: payload.audience,
    test_mode: payload.testMode,
    total_recipients: recipients.length,
    skipped_count: input.skippedCount,
  });

  if (!claim.claimed) {
    const outcome = classifyExistingBroadcast(claim.existing, fingerprint);
    logDuplicate(broadcastId, outcome);
    return outcome;
  }

  const startedAt = Date.now();
  console.info(`${LOG_PREFIX} start`, {
    broadcastId,
    tournamentId: payload.tournamentId,
    audience: payload.audience,
    testMode: payload.testMode,
    recipientCount: recipients.length,
  });

  let successCount = 0;
  let failedCount = 0;
  let skippedCount = input.skippedCount;
  const errors: TournamentNotificationBroadcastError[] = [];
  const counts = () => ({
    success_count: successCount,
    failed_count: failedCount,
    skipped_count: skippedCount,
    errors,
  });

  try {
    for (const recipient of recipients) {
      if (typeof recipient.telegram_id !== "number") {
        skippedCount += 1;
        errors.push({
          player_id: recipient.player_id,
          telegram_id: null,
          display_name: recipient.display_name,
          error: "missing telegram_id",
        });
        continue;
      }

      const outcome = await input.send({ ...recipient, telegram_id: recipient.telegram_id });

      if (outcome.ok) {
        successCount += 1;
      } else {
        failedCount += 1;
        errors.push({
          player_id: recipient.player_id,
          telegram_id: recipient.telegram_id,
          display_name: recipient.display_name,
          error: outcome.error,
        });
      }
    }
  } catch (error) {
    // Unexpected failure mid-loop: some recipients may already have the
    // message. Record what we know and leave the batch NOT completed;
    // a repeat of this broadcastId will not re-send (manual review).
    console.error(`${LOG_PREFIX} failed`, {
      broadcastId,
      successCount,
      failedCount,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    try {
      await tournamentNotificationBroadcastRepository.markFailed(broadcastId, counts());
    } catch {
      // Row stays 'processing' -- still never re-sent.
      console.error(`${LOG_PREFIX} mark_failed_error`, { broadcastId });
    }
    throw error;
  }

  const durationMs = Date.now() - startedAt;

  try {
    await tournamentNotificationBroadcastRepository.markCompleted(broadcastId, counts());
  } catch {
    // The loop really did finish, so the live result below is truthful; the
    // row just stays 'processing' (repeats get already_processing, no resend).
    console.error(`${LOG_PREFIX} mark_completed_error`, { broadcastId });
  }

  console.info(`${LOG_PREFIX} complete`, {
    broadcastId,
    successCount,
    failedCount,
    skippedCount,
    durationMs,
  });

  return {
    kind: "sent",
    result: {
      totalRecipients: recipients.length,
      successCount,
      failedCount,
      skippedCount,
      errors,
    },
  };
}
