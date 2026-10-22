import { NextResponse } from "next/server";
import {
  getTournamentById,
  getTournamentNotificationRecipientsByAudience,
  type TournamentNotificationAudience,
} from "@/features/tournaments";
import {
  computeBroadcastFingerprint,
  findExistingBroadcast,
  runTournamentBroadcast,
  type BroadcastExistingOutcome,
  type BroadcastPayload,
} from "@/features/tournament-notification-broadcast";
import { isUuid } from "@/lib/uuid";

type NotifyError = {
  player_id: string;
  telegram_id: number | null;
  display_name: string;
  error: string;
};

function normalizeTelegramError(errorText: string) {
  const lowered = errorText.toLowerCase();

  if (lowered.includes("bot was blocked by the user")) {
    return "bot was blocked by user";
  }

  if (lowered.includes("chat not found")) {
    return "chat not found";
  }

  if (lowered.includes("user is deactivated")) {
    return "user is deactivated";
  }

  return errorText;
}

// A repeat of an already-claimed broadcastId: never sends anything.
function existingBroadcastResponse(
  outcome: BroadcastExistingOutcome,
  broadcastId: string,
  tournamentTitle: string
) {
  if (outcome.kind === "fingerprint_mismatch") {
    return NextResponse.json(
      {
        error:
          "Этот broadcastId уже использован для другой рассылки. Повторная отправка отклонена.",
        code: "broadcast_id_conflict",
      },
      { status: 409 }
    );
  }

  if (outcome.kind === "failed") {
    return NextResponse.json(
      {
        error:
          "Эта рассылка была прервана ошибкой сервера и повторно не отправляется: часть получателей могла её уже получить. Проверьте вручную.",
        code: "broadcast_failed",
        broadcastId,
      },
      { status: 409 }
    );
  }

  const row = outcome.row;
  const summary = {
    broadcastId,
    status: row.status,
    duplicate: outcome.kind,
    tournamentTitle,
    audience: row.audience,
    testMode: row.test_mode,
    totalRecipients: row.total_recipients,
  };

  if (outcome.kind === "already_completed") {
    return NextResponse.json({
      ok: true,
      ...summary,
      successCount: row.success_count,
      failedCount: row.failed_count,
      skippedCount: row.skipped_count,
      errors: row.errors,
    });
  }

  // already_processing: answered immediately, without waiting for the
  // original request's send loop. 202 = accepted, still in progress.
  return NextResponse.json(
    {
      ok: false,
      ...summary,
      successCount: 0,
      failedCount: 0,
      skippedCount: row.skipped_count,
      errors: [] as NotifyError[],
    },
    { status: 202 }
  );
}

export async function POST(request: Request) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      return NextResponse.json(
        {
          error: "TELEGRAM_BOT_TOKEN is not configured",
        },
        { status: 500 }
      );
    }

    const body = (await request.json()) as {
      tournamentId?: string;
      message?: string;
      audience?: TournamentNotificationAudience;
      dryRun?: boolean;
      testMode?: boolean;
      testTelegramId?: number | string;
      broadcastId?: unknown;
    };

    const tournamentId = body.tournamentId?.trim();
    const message = body.message?.trim();
    const audience = body.audience === "access" ? "access" : "registered";
    const dryRun = body.dryRun === true;
    const testMode = body.testMode === true;
    const testTelegramId =
      typeof body.testTelegramId === "number"
        ? body.testTelegramId
        : typeof body.testTelegramId === "string" && body.testTelegramId.trim()
          ? Number(body.testTelegramId.trim())
          : null;

    if (!tournamentId) {
      return NextResponse.json(
        { error: "Tournament ID is required" },
        { status: 400 }
      );
    }

    if (!message) {
      return NextResponse.json(
        { error: "Message text is required" },
        { status: 400 }
      );
    }

    if (testMode && (!testTelegramId || Number.isNaN(testTelegramId))) {
      return NextResponse.json(
        { error: "testTelegramId is required when testMode is enabled" },
        { status: 400 }
      );
    }

    // Every real send (mass send AND Test Send) must carry a client-generated
    // broadcastId. Fail closed: no id, no send.
    const broadcastId =
      typeof body.broadcastId === "string" ? body.broadcastId.trim() : null;

    if (!dryRun && !isUuid(broadcastId)) {
      return NextResponse.json(
        {
          error: "broadcastId (UUID) is required for a real send",
          code: "broadcast_id_required",
        },
        { status: 400 }
      );
    }

    const payload: BroadcastPayload = {
      tournamentId,
      audience,
      message,
      testMode,
      testTelegramId: testMode ? testTelegramId : null,
    };

    const tournament = await getTournamentById(tournamentId);

    if (!dryRun) {
      // Fast path for a repeat of a known broadcastId (no recipient lookup,
      // no send). The atomic claim below still arbitrates true races.
      const existing = await findExistingBroadcast(
        broadcastId!,
        computeBroadcastFingerprint(payload)
      );
      if (existing) {
        return existingBroadcastResponse(existing, broadcastId!, tournament.title);
      }
    }

    const recipients = await getTournamentNotificationRecipientsByAudience({
      tournamentId,
      tournamentKind: tournament.kind,
      audience,
    });

    const eligibleRecipients = recipients.filter(
      (recipient) => typeof recipient.telegram_id === "number"
    );

    const finalRecipients = testMode
      ? eligibleRecipients.filter(
          (recipient) => recipient.telegram_id === testTelegramId
        )
      : eligibleRecipients;

    if (testMode && finalRecipients.length === 0) {
      return NextResponse.json(
        { error: "Test recipient was not found in the selected audience" },
        { status: 404 }
      );
    }

    if (dryRun) {
      // Dry run: no side effect, no durable broadcast row.
      return NextResponse.json({
        ok: true,
        dryRun: true,
        tournamentTitle: tournament.title,
        audience,
        testMode,
        totalRecipients: finalRecipients.length,
        successCount: 0,
        failedCount: 0,
        skippedCount: recipients.length - finalRecipients.length,
        errors: [] as NotifyError[],
      });
    }

    // Race arbiter: atomic claim on broadcast_id BEFORE the first
    // sendMessage. Only the claimant runs the loop.
    const outcome = await runTournamentBroadcast({
      broadcastId: broadcastId!,
      payload,
      recipients: finalRecipients,
      skippedCount: recipients.length - finalRecipients.length,
      send: async (recipient) => {
        try {
          const response = await fetch(
            `https://api.telegram.org/bot${token}/sendMessage`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                chat_id: recipient.telegram_id,
                text: message,
              }),
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            return { ok: false, error: normalizeTelegramError(errorText) };
          }

          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof Error ? error.message : "unknown telegram error",
          };
        }
      },
    });

    if (outcome.kind !== "sent") {
      return existingBroadcastResponse(outcome, broadcastId!, tournament.title);
    }

    return NextResponse.json({
      ok: true,
      broadcastId,
      status: "completed",
      tournamentTitle: tournament.title,
      audience,
      testMode,
      ...outcome.result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to send notifications",
      },
      { status: 500 }
    );
  }
}
