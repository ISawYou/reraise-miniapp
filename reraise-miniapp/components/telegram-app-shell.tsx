"use client";

import { useEffect } from "react";
import type { TelegramWebApp, TelegramWebAppInset } from "@/lib/telegram";
import { getTelegramWebApp } from "@/lib/telegram";

export function TelegramAppShell() {
  useEffect(() => {
    let attempts = 0;
    let cleanupInsetsListener: (() => void) | undefined;

    const applyInsetVariables = (
      prefix: "safe-area-inset" | "content-safe-area-inset",
      inset?: TelegramWebAppInset
    ) => {
      if (typeof document === "undefined") {
        return;
      }

      const rootStyle = document.documentElement.style;

      rootStyle.setProperty(`--tg-${prefix}-top`, `${inset?.top ?? 0}px`);
      rootStyle.setProperty(`--tg-${prefix}-bottom`, `${inset?.bottom ?? 0}px`);
      rootStyle.setProperty(`--tg-${prefix}-left`, `${inset?.left ?? 0}px`);
      rootStyle.setProperty(`--tg-${prefix}-right`, `${inset?.right ?? 0}px`);
    };

    const syncSafeAreaInsets = (webApp: TelegramWebApp | null) => {
      if (!webApp) {
        return;
      }

      applyInsetVariables("safe-area-inset", webApp.safeAreaInset);
      applyInsetVariables("content-safe-area-inset", webApp.contentSafeAreaInset);

      const onSafeAreaChanged = () => {
        applyInsetVariables("safe-area-inset", webApp.safeAreaInset);
        applyInsetVariables("content-safe-area-inset", webApp.contentSafeAreaInset);
      };

      if (typeof webApp.onEvent === "function") {
        webApp.onEvent("safeAreaChanged", onSafeAreaChanged);
        webApp.onEvent("contentSafeAreaChanged", onSafeAreaChanged);

        cleanupInsetsListener = () => {
          if (typeof webApp.offEvent === "function") {
            webApp.offEvent("safeAreaChanged", onSafeAreaChanged);
            webApp.offEvent("contentSafeAreaChanged", onSafeAreaChanged);
          }
        };
      }
    };

    const initWebApp = () => {
      const webApp = getTelegramWebApp();

      if (!webApp) {
        if (attempts < 10) {
          attempts += 1;
          window.setTimeout(initWebApp, 150);
        }

        return;
      }

      try {
        webApp.ready?.();
        webApp.expand?.();
        webApp.requestFullscreen?.();
        webApp.disableVerticalSwipes?.();
        webApp.setBackgroundColor?.("#000000");
        webApp.setHeaderColor?.("#000000");

        syncSafeAreaInsets(webApp);
      } catch (error) {
        console.error("Telegram app shell init error:", error);
      }
    };

    initWebApp();

    return () => {
      cleanupInsetsListener?.();
    };
  }, []);

  return null;
}
