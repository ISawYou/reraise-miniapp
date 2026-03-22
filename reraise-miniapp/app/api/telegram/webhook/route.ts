import { NextResponse } from "next/server";

const WEB_APP_URL = "https://reraise-miniapp.vercel.app";

type TelegramWebhookUpdate = {
  message?: {
    text?: string;
    chat?: {
      id: number;
    };
  };
};

export async function POST(request: Request) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "TELEGRAM_BOT_TOKEN is not configured" },
        { status: 500 }
      );
    }

    const update = (await request.json()) as TelegramWebhookUpdate;
    const message = update.message;
    const chatId = message?.chat?.id;
    const text = message?.text?.trim();

    if (chatId && text === "/start") {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: "Открыть приложение можно по кнопке ниже.",
          reply_markup: {
            keyboard: [
              [
                {
                  text: "Открыть приложение",
                  web_app: {
                    url: WEB_APP_URL,
                  },
                },
              ],
            ],
            resize_keyboard: true,
          },
        }),
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid webhook payload" },
      { status: 400 }
    );
  }
}
