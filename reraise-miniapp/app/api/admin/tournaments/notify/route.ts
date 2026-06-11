import { NextResponse } from "next/server";
import {
  getTournamentById,
  getTournamentNotificationRecipientsByAudience,
  type TournamentNotificationAudience,
} from "@/features/tournaments";

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

    const tournament = await getTournamentById(tournamentId);
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

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = recipients.length - finalRecipients.length;
    const errors: NotifyError[] = [];

    for (const recipient of finalRecipients) {
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
              text: `Турнир: ${tournament.title}\n\n${message}`,
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          failedCount += 1;
          errors.push({
            player_id: recipient.player_id,
            telegram_id: recipient.telegram_id,
            display_name: recipient.display_name,
            error: normalizeTelegramError(errorText),
          });
          continue;
        }

        successCount += 1;
      } catch (error) {
        failedCount += 1;
        errors.push({
          player_id: recipient.player_id,
          telegram_id: recipient.telegram_id,
          display_name: recipient.display_name,
          error:
            error instanceof Error ? error.message : "unknown telegram error",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      tournamentTitle: tournament.title,
      audience,
      testMode,
      totalRecipients: finalRecipients.length,
      successCount,
      failedCount,
      skippedCount,
      errors,
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
