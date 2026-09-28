import "server-only";

// Best-effort Telegram bot notifications for Teams v1 invitation/request
// events (app/api/telegram/webhook/route.ts's own sendMessage +
// app/api/admin/tournaments/notify/route.ts's fetch/inline-keyboard shape
// are the two existing precedents this mirrors -- same endpoint, same
// `web_app` inline-button pattern for opening the Mini App at a specific
// path, same "never throw" discipline).
//
// NEVER throws. A DB write that already succeeded must never be rolled
// back or invalidated because Telegram is unreachable, the bot was
// blocked, the chat wasn't found, or TELEGRAM_BOT_TOKEN isn't configured
// in this environment -- every caller in features/teams.ts fires this
// AFTER its own transaction has committed, and treats the returned
// boolean as informational only, never as a reason to fail the mutation
// that already succeeded.
const WEB_APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.re-raise.ru/";

function buildWebAppUrl(path: string): string {
  try {
    return new URL(path, WEB_APP_URL).toString();
  } catch {
    return WEB_APP_URL;
  }
}

// Categorical only -- never logs the message text or any player-identifying
// detail beyond what the caller already put in its own log line; Telegram's
// raw error body can echo back request content, so it's reduced to one of
// a few known categories before ever reaching the server log.
function categorizeTelegramError(errorText: string): string {
  const lowered = errorText.toLowerCase();
  if (lowered.includes("bot was blocked by the user")) return "bot blocked by user";
  if (lowered.includes("chat not found")) return "chat not found";
  if (lowered.includes("user is deactivated")) return "user deactivated";
  if (lowered.includes("timed out") || lowered.includes("timeout")) return "timeout";
  return "telegram api error";
}

export type TelegramNotificationParams = {
  telegramId: number;
  text: string;
  // Inline "Открыть..." button opening the Mini App at this path (e.g.
  // "/teams?tab=my-team"). Omitted entirely if not given -- plain text
  // message, same as the webhook's own support-session replies.
  buttonText?: string;
  path?: string;
};

// Returns true on a confirmed send, false on any best-effort failure
// (including "not configured") -- callers use this only for their own
// tests/logging, never to decide whether the surrounding mutation
// succeeded.
export async function sendTeamsTelegramNotification(params: TelegramNotificationParams): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("[teams] Telegram notification skipped -- TELEGRAM_BOT_TOKEN not configured");
    return false;
  }

  const body: Record<string, unknown> = { chat_id: params.telegramId, text: params.text };
  if (params.buttonText) {
    body.reply_markup = {
      inline_keyboard: [[{ text: params.buttonText, web_app: { url: buildWebAppUrl(params.path ?? "/") } }]],
    };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.warn("[teams] Telegram notification failed (best-effort, non-fatal):", categorizeTelegramError(errorText));
      return false;
    }

    return true;
  } catch (error) {
    console.warn(
      "[teams] Telegram notification failed (best-effort, non-fatal):",
      error instanceof Error ? error.name : "unknown error"
    );
    return false;
  }
}
