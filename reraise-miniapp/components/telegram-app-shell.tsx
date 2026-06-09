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
    //
    // In fullscreen Telegram Mini App the WebView covers the entire screen.
    // Two Telegram layers sit on top:
    //   safeAreaInset.top       = system safe area (status bar, e.g. 47px iPhone)
    //   contentSafeAreaInset.top = Telegram floating bar (close button, ~44-48px)
    //
    // The correct offset is their SUM — not max. Math.max was the previous bug.
    //
    // When both are 0 (before the first safeAreaChanged fires after
    // requestFullscreen, or on older Telegram that doesn't report these values),
    // fall back to a platform estimate. safeAreaChanged will correct it.
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
      const total = safeTop + contentTop;

      if (process.env.NODE_ENV !== "production") {
        const wa = webApp as (TelegramWebApp & {
          platform?: string;
          version?: string;
          viewportHeight?: number;
          viewportStableHeight?: number;
        }) | null;
        console.log("[telegram-shell] syncTopOffset", {
          pathname,
          isTelegramMiniApp: true,
          platform: wa?.platform,
          version: wa?.version,
          safeAreaInset: webApp?.safeAreaInset,
          contentSafeAreaInset: webApp?.contentSafeAreaInset,
          safeTop,
          contentTop,
          total,
          viewportHeight: wa?.viewportHeight,
          viewportStableHeight: wa?.viewportStableHeight,
          usingFallback: total === 0,
        });
      }

      if (total > 0) {
        rootStyle.setProperty("--app-top-offset", `${total}px`);
        return;
      }

      // Fallback: Telegram hasn't reported real values yet.
      // For iOS in fullscreen: status bar (~47px) + floating bar (~44px) ≈ 90px.
      // For Android: varies, ~56px is a reasonable minimum.
      const platform =
        (webApp as { platform?: string } | null)?.platform ??
        (/iPhone|iPad|iPod/i.test(window.navigator.userAgent) ? "ios" : "");

      rootStyle.setProperty(
        "--app-top-offset",
        platform === "ios" ? "90px" : "56px"
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
