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
    const timers: number[] = [];
    let cleanupInsetsListener: (() => void) | undefined;

    const hasInsetValues = (inset?: TelegramWebAppInset) =>
      Boolean(
        inset &&
          [inset.top, inset.bottom, inset.left, inset.right].some(
            (value) => typeof value === "number"
          )
      );

    const debugLog = (stage: string, webApp: TelegramWebApp | null) => {
      if (typeof document === "undefined") {
        return;
      }

      const rootStyle = getComputedStyle(document.documentElement);

      console.log("[telegram-shell]", {
        stage,
        pathname,
        isTelegramMiniApp: isTelegramMiniAppContext(),
        hasWebApp: Boolean(webApp),
        version: (webApp as TelegramWebApp & { version?: string } | null)?.version,
        platform: (webApp as TelegramWebApp & { platform?: string } | null)?.platform,
        viewportHeight:
          (webApp as TelegramWebApp & { viewportHeight?: number } | null)?.viewportHeight,
        viewportStableHeight:
          (webApp as TelegramWebApp & { viewportStableHeight?: number } | null)
            ?.viewportStableHeight,
        safeAreaInset: webApp?.safeAreaInset,
        contentSafeAreaInset: webApp?.contentSafeAreaInset,
        cssSafeAreaTop: rootStyle.getPropertyValue("--tg-safe-area-top").trim(),
        cssContentSafeAreaTop: rootStyle
          .getPropertyValue("--tg-content-safe-area-top")
          .trim(),
        cssAppTopOffset: rootStyle.getPropertyValue("--app-top-offset").trim(),
      });
    };

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

    const syncTopOffset = (webApp: TelegramWebApp | null) => {
      if (typeof document === "undefined") {
        return;
      }

      const rootStyle = document.documentElement.style;

      if (!isTelegramMiniAppContext()) {
        rootStyle.setProperty("--tg-safe-area-top", "0px");
        rootStyle.setProperty("--tg-content-safe-area-top", "0px");
        rootStyle.setProperty("--app-top-offset", "0px");
        return;
      }

      const safeTop = webApp?.safeAreaInset?.top ?? 0;
      const contentTop = webApp?.contentSafeAreaInset?.top ?? 0;
      const platform =
        (webApp as TelegramWebApp & { platform?: string } | null)?.platform ?? "";
      const fallbackTopOffset = platform === "ios" ? 56 : 48;
      const resolvedTopOffset =
        safeTop > 0 || contentTop > 0
          ? Math.max(safeTop, contentTop)
          : fallbackTopOffset;

      rootStyle.setProperty("--tg-safe-area-top", `${safeTop}px`);
      rootStyle.setProperty("--tg-content-safe-area-top", `${contentTop}px`);
      rootStyle.setProperty("--app-top-offset", `${resolvedTopOffset}px`);
    };

    const syncSafeAreaInsets = (webApp: TelegramWebApp | null) => {
      if (!webApp) {
        return;
      }

      applyInsetVariables("safe-area-inset", webApp.safeAreaInset);
      applyInsetVariables("content-safe-area-inset", webApp.contentSafeAreaInset);
      syncTopOffset(webApp);
      debugLog("syncSafeAreaInsets", webApp);

      const onSafeAreaChanged = () => {
        applyInsetVariables("safe-area-inset", webApp.safeAreaInset);
        applyInsetVariables("content-safe-area-inset", webApp.contentSafeAreaInset);
        syncTopOffset(webApp);
        debugLog("safeAreaChanged", webApp);
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
        debugLog("initWebApp", webApp);

        // Telegram can populate safe-area values slightly after route changes.
        [0, 100, 300].forEach((delay) => {
          const timer = window.setTimeout(() => {
            if (!cancelled) {
              syncSafeAreaInsets(webApp);
              debugLog(`delayedSync:${delay}`, webApp);
            }
          }, delay);
          timers.push(timer);
        });
      } catch (error) {
        console.error("Telegram app shell init error:", error);
      }
    };

    syncTopOffset(getTelegramWebApp());
    debugLog("effectStart", getTelegramWebApp());
    void initWebApp();

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      cleanupInsetsListener?.();
    };
  }, [pathname]);

  return null;
}
