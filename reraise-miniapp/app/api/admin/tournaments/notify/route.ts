import { NextResponse } from "next/server";
import { getTournamentById } from "@/features/tournaments";

export async function POST(request: Request) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const notificationsChatId = process.env.TOURNAMENT_NOTIFICATIONS_CHAT_ID;

    if (!token || !notificationsChatId) {
      return NextResponse.json(
        {
          error:
            "TELEGRAM_BOT_TOKEN or TOURNAMENT_NOTIFICATIONS_CHAT_ID is not configured",
        },
        { status: 500 }
      );
    }

    const body = (await request.json()) as {
      tournamentId?: string;
      message?: string;
    };

    const tournamentId = body.tournamentId?.trim();
    const message = body.message?.trim();

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

    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: notificationsChatId,
          text: `Турнир: ${tournament.title}\n\n${message}`,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Telegram sendMessage failed: ${errorText}`);
    }

    return NextResponse.json({
      ok: true,
      tournamentTitle: tournament.title,
      destinationChatId: notificationsChatId,
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
