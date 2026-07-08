import type { TelegramLogin } from "@/lib/telegram";

let telegramWidgetPromise: Promise<TelegramLogin | null> | null = null;

function getTelegramLogin(): TelegramLogin | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.Telegram?.Login ?? null;
}

export async function loadTelegramLoginWidget(
  timeoutMs = 2500
): Promise<TelegramLogin | null> {
  const existingLogin = getTelegramLogin();

  if (existingLogin) {
    return existingLogin;
  }

  if (!telegramWidgetPromise) {
    telegramWidgetPromise = new Promise<TelegramLogin | null>((resolve) => {
      if (typeof window === "undefined" || typeof document === "undefined") {
        resolve(null);
        return;
      }

      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[src="https://telegram.org/js/telegram-widget.js?22"]'
      );

      const finish = () => {
        resolve(getTelegramLogin());
      };

      const timer = window.setTimeout(finish, timeoutMs);

      const cleanup = () => {
        window.clearTimeout(timer);
        existingScript?.removeEventListener("load", handleLoad);
        existingScript?.removeEventListener("error", handleError);
        injectedScript?.removeEventListener("load", handleLoad);
        injectedScript?.removeEventListener("error", handleError);
      };

      const handleLoad = () => {
        cleanup();
        finish();
      };

      const handleError = () => {
        cleanup();
        resolve(null);
      };

      const injectedScript = existingScript ?? document.createElement("script");

      injectedScript.async = true;
      injectedScript.src = "https://telegram.org/js/telegram-widget.js?22";
      injectedScript.addEventListener("load", handleLoad, { once: true });
      injectedScript.addEventListener("error", handleError, { once: true });

      if (!existingScript) {
        document.body.appendChild(injectedScript);
      }
    }).finally(() => {
      telegramWidgetPromise = null;
    });
  }

  return telegramWidgetPromise;
}
