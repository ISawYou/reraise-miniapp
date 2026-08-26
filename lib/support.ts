import { getTelegramWebApp } from "@/lib/telegram";

// Single source of truth for "how does the app open a support chat" --
// previously duplicated inline in app/page.tsx's openTelegramDestination()
// call site. Anything that needs a support entry point (the home screen
// button, the blocked-account screen) should call this instead of building
// its own Telegram deep link.
export const SUPPORT_TELEGRAM_URL = "https://t.me/ReRaise_Poker_Bot?start=support";
const SUPPORT_TELEGRAM_FALLBACK_URL =
  "tg://resolve?domain=ReRaise_Poker_Bot&start=support";

export function openSupportChat(): void {
  const webApp = getTelegramWebApp();

  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(SUPPORT_TELEGRAM_URL);
    return;
  }

  window.location.href = SUPPORT_TELEGRAM_FALLBACK_URL;
}
