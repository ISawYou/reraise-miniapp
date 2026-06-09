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

    // Derives --app-top-offset from actual Telegram safe area values.
    // Falls back to platform-based estimate only when Telegram hasn't reported
    // values yet (before the first safeAreaChanged fires after requestFullscreen).
    const syncTopOffset = (webApp: TelegramWebApp | null) => {
      if (typeof document === "undefined") {
        return;
      }

      const rootStyle = document.documentElement.style;

      if (!isTelegramMiniAppContext()) {
        rootStyle.setProperty("--app-top-offset", "0px");
        return;
      }

      const safeTop = webApp?.safeAreaInset?.top ?? 0;
      const contentTop = webApp?.contentSafeAreaInset?.top ?? 0;

      if (safeTop > 0 || contentTop > 0) {
        rootStyle.setProperty(
          "--app-top-offset",
          `${Math.max(safeTop, contentTop)}px`
        );
        return;
      }

      // Fallback until Telegram fires safeAreaChanged after requestFullscreen().
      // Using conservative estimates (status bar only, not Telegram header).
      const platform =
        (webApp as { platform?: string } | null)?.platform ??
        (/iPhone|iPad|iPod/i.test(window.navigator.userAgent) ? "ios" : "");

      rootStyle.setProperty(
        "--app-top-offset",
        platform === "ios" ? "44px" : "28px"
      );
    };

    const syncSafeAreaInsets = (webApp: TelegramWebApp | null) => {
      if (!webApp) {
        return;
      }

      applyInsetVariables("safe-area-inset", webApp.safeAreaInset);
      applyInsetVariables("content-safe-area-inset", webApp.contentSafeAreaInset);
      syncTopOffset(webApp);
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

        // Re-sync after requestFullscreen() completes — Telegram fires these
        // events once the viewport stabilises with real inset values.
        const onSafeAreaChanged = () => {
          if (!cancelled) {
            syncSafeAreaInsets(webApp!);
          }
        };

        if (typeof webApp.onEvent === "function") {
          webApp.onEvent("safeAreaChanged", onSafeAreaChanged);
          webApp.onEvent("contentSafeAreaChanged", onSafeAreaChanged);

          cleanupInsetsListener = () => {
            if (typeof webApp!.offEvent === "function") {
              webApp!.offEvent("safeAreaChanged", onSafeAreaChanged);
              webApp!.offEvent("contentSafeAreaChanged", onSafeAreaChanged);
            }
          };
        }
      } catch (error) {
        console.error("Telegram app shell init error:", error);
      }
    };

    syncTopOffset(getTelegramWebApp());
    void initWebApp();

    return () => {
      cancelled = true;
      cleanupInsetsListener?.();
    };
  }, [pathname]);

  return null;
}
