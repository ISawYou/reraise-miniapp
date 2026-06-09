"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { TelegramWebApp, TelegramWebAppInset } from "@/lib/telegram";
import {
  getTelegramWebApp,
  isTelegramMiniAppContext,
  loadTelegramWebAppScript,
} from "@/lib/telegram";

export function TelegramAppShell() {
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    let cleanupInsetsListener: (() => void) | undefined;

    const hasInsetValues = (inset?: TelegramWebAppInset) =>
      Boolean(
        inset &&
          [inset.top, inset.bottom, inset.left, inset.right].some(
            (value) => typeof value === "number"
          )
      );

    const applyInsetVariables = (
      prefix: "safe-area-inset" | "content-safe-area-inset",
      inset?: TelegramWebAppInset
    ) => {
      if (typeof document === "undefined" || !hasInsetValues(inset)) {
        return;
      }

      const nextInset = inset as TelegramWebAppInset;
      const rootStyle = document.documentElement.style;

      if (typeof nextInset.top === "number") {
        rootStyle.setProperty(`--tg-${prefix}-top`, `${nextInset.top}px`);
      }
      if (typeof nextInset.bottom === "number") {
        rootStyle.setProperty(`--tg-${prefix}-bottom`, `${nextInset.bottom}px`);
      }
      if (typeof nextInset.left === "number") {
        rootStyle.setProperty(`--tg-${prefix}-left`, `${nextInset.left}px`);
      }
      if (typeof nextInset.right === "number") {
        rootStyle.setProperty(`--tg-${prefix}-right`, `${nextInset.right}px`);
      }
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

    const initWebApp = async () => {
      let webApp = getTelegramWebApp();

      if (!webApp && isTelegramMiniAppContext()) {
        webApp = await loadTelegramWebAppScript(2500);
      }

      if (!webApp) {
        return;
      }

      try {
        if (cancelled) {
          return;
        }

        webApp.ready?.();
        webApp.expand?.();
        webApp.requestFullscreen?.();
        webApp.disableVerticalSwipes?.();
        webApp.setBackgroundColor?.("#000000");
        webApp.setHeaderColor?.("#000000");

        syncSafeAreaInsets(webApp);

        // Telegram can populate safe-area values slightly after route changes.
        [0, 100, 300].forEach((delay) => {
          window.setTimeout(() => {
            if (!cancelled) {
              syncSafeAreaInsets(webApp);
            }
          }, delay);
        });
      } catch (error) {
        console.error("Telegram app shell init error:", error);
      }
    };

    void initWebApp();

    return () => {
      cancelled = true;
      cleanupInsetsListener?.();
    };
  }, [pathname]);

  return null;
}
