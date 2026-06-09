"use client";

import { useEffect } from "react";
import type { TelegramWebApp, TelegramWebAppInset } from "@/lib/telegram";
import {
  getTelegramWebApp,
  isTelegramMiniAppContext,
  loadTelegramWebAppScript,
} from "@/lib/telegram";

export function TelegramAppShell() {
  // Empty deps: TelegramAppShell lives in layout.tsx and never unmounts during
  // SPA navigation. Running on every pathname change was wrong — it repeatedly
  // called requestFullscreen(), which temporarily zeroed contentSafeAreaInset.top
  // before safeAreaChanged could restore it, leaving --app-top-offset at half
  // the correct value on every page transition.
  //
  // The safeAreaChanged / contentSafeAreaChanged listeners (set up once below)
  // handle all real changes. CSS variables on document.documentElement.style
  // persist across routes.
  useEffect(() => {
    let cancelled = false;
    let cleanupInsetsListener: (() => void) | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const applyInsetVariables = (
      prefix: "safe-area-inset" | "content-safe-area-inset",
      inset?: TelegramWebAppInset
    ) => {
      if (typeof document === "undefined") return;
      const rootStyle = document.documentElement.style;
      rootStyle.setProperty(`--tg-${prefix}-top`, `${inset?.top ?? 0}px`);
      rootStyle.setProperty(`--tg-${prefix}-bottom`, `${inset?.bottom ?? 0}px`);
      rootStyle.setProperty(`--tg-${prefix}-left`, `${inset?.left ?? 0}px`);
      rootStyle.setProperty(`--tg-${prefix}-right`, `${inset?.right ?? 0}px`);
    };

    // In fullscreen Telegram Mini App two layers sit above the WebView:
    //   safeAreaInset.top        = system status bar  (e.g. 47px iPhone)
    //   contentSafeAreaInset.top = Telegram close bar (e.g. 44-48px)
    //
    // The correct top offset is their SUM.
    //
    // RACE CONDITION: Telegram fires safeAreaChanged and contentSafeAreaChanged
    // as two separate events. Reading both fields immediately in the first event
    // gives a wrong partial sum (e.g. 47+0=47 before contentSafeAreaChanged fires).
    // The debounce below collapses both events into a single recompute after
    // 30 ms so we always see the settled values from both events.
    const computeAndApplyOffset = (webApp: TelegramWebApp) => {
      if (typeof document === "undefined" || !isTelegramMiniAppContext()) {
        document?.documentElement.style.setProperty("--app-top-offset", "0px");
        return;
      }

      const safeTop = webApp.safeAreaInset?.top ?? 0;
      const contentTop = webApp.contentSafeAreaInset?.top ?? 0;
      const total = safeTop + contentTop;

      const wa = webApp as TelegramWebApp & {
        platform?: string;
        version?: string;
        viewportHeight?: number;
        viewportStableHeight?: number;
      };

      console.log("[telegram-shell]", {
        pathname: typeof window !== "undefined" ? window.location.pathname : "",
        platform: wa.platform,
        version: wa.version,
        safeAreaInset: webApp.safeAreaInset,
        contentSafeAreaInset: webApp.contentSafeAreaInset,
        safeTop,
        contentTop,
        total,
        viewportHeight: wa.viewportHeight,
        viewportStableHeight: wa.viewportStableHeight,
        usingFallback: total === 0,
        cssVar: document.documentElement.style.getPropertyValue("--app-top-offset"),
      });

      if (total > 0) {
        document.documentElement.style.setProperty("--app-top-offset", `${total}px`);
        applyInsetVariables("safe-area-inset", webApp.safeAreaInset);
        applyInsetVariables("content-safe-area-inset", webApp.contentSafeAreaInset);
        return;
      }

      // Fallback: real values not available yet (before first safeAreaChanged
      // fires after requestFullscreen, or on older Telegram without the API).
      // For iOS in fullscreen: status bar (~47px) + close bar (~44px) ≈ 90px.
      // For Android: ~56px. safeAreaChanged will correct this once it fires.
      const platform =
        wa.platform ??
        (/iPhone|iPad|iPod/i.test(window.navigator.userAgent) ? "ios" : "");
      document.documentElement.style.setProperty(
        "--app-top-offset",
        platform === "ios" ? "90px" : "56px"
      );
    };

    const scheduledSync = (webApp: TelegramWebApp) => {
      if (cancelled) return;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      // 30 ms gives both safeAreaChanged and contentSafeAreaChanged time to
      // arrive before we read the final values from the webApp object.
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (!cancelled) computeAndApplyOffset(webApp);
      }, 30);
    };

    const initWebApp = async () => {
      let webApp = getTelegramWebApp();

      if (!webApp && isTelegramMiniAppContext()) {
        webApp = await loadTelegramWebAppScript(2500);
      }

      if (!webApp || cancelled) return;

      try {
        webApp.ready?.();
        webApp.expand?.();
        webApp.requestFullscreen?.();
        webApp.disableVerticalSwipes?.();
        webApp.setBackgroundColor?.("#000000");
        webApp.setHeaderColor?.("#000000");

        // Initial read — values may be 0 before safeAreaChanged fires.
        computeAndApplyOffset(webApp);

        // Both events are listened to because Telegram fires them separately.
        // scheduledSync debounces so we recompute only after both have settled.
        const onSafeAreaChanged = () => scheduledSync(webApp!);
        const onContentSafeAreaChanged = () => scheduledSync(webApp!);

        if (typeof webApp.onEvent === "function") {
          webApp.onEvent("safeAreaChanged", onSafeAreaChanged);
          webApp.onEvent("contentSafeAreaChanged", onContentSafeAreaChanged);

          cleanupInsetsListener = () => {
            if (debounceTimer !== null) {
              clearTimeout(debounceTimer);
              debounceTimer = null;
            }
            if (typeof webApp!.offEvent === "function") {
              webApp!.offEvent("safeAreaChanged", onSafeAreaChanged);
              webApp!.offEvent("contentSafeAreaChanged", onContentSafeAreaChanged);
            }
          };
        }
      } catch (error) {
        console.error("Telegram app shell init error:", error);
      }
    };

    // Immediate best-effort offset before async initWebApp runs.
    const earlyWebApp = getTelegramWebApp();
    if (earlyWebApp && isTelegramMiniAppContext()) {
      computeAndApplyOffset(earlyWebApp);
    }

    void initWebApp();

    return () => {
      cancelled = true;
      cleanupInsetsListener?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
