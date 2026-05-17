import { NextResponse } from "next/server";
import {
  getTournamentById,
  getTournamentNotificationRecipientsByAudience,
  type TournamentNotificationAudience,
} from "@/features/tournaments";

export async function POST(request: Request) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      return NextResponse.json(
        { error: "TELEGRAM_BOT_TOKEN is not configured" },
        { status: 500 }
      );
    }

    const body = (await request.json()) as {
      tournamentId?: string;
      message?: string;
      audience?: TournamentNotificationAudience;
    };

    const tournamentId = body.tournamentId?.trim();
    const message = body.message?.trim();
    const audience = body.audience === "access" ? "access" : "registered";

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

    const tournament = await getTournamentById(tournamentId);
    const recipients = await getTournamentNotificationRecipientsByAudience({
      tournamentId,
      tournamentKind: tournament.kind,
      audience,
    });

    let successCount = 0;
    let failedCount = 0;

    for (const recipient of recipients) {
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
          failedCount += 1;
          continue;
        }

        successCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      tournamentTitle: tournament.title,
      totalRecipients: recipients.length,
      successCount,
      failedCount,
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
