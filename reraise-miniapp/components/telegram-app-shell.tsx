"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  getTelegramWebApp,
  isTelegramMiniAppContext,
  loadTelegramWebAppScript,
} from "@/lib/telegram";

export function TelegramAppShell() {
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    const syncTopOffset = () => {
      if (typeof document === "undefined") {
        return;
      }

      const rootStyle = document.documentElement.style;
      const webApp = getTelegramWebApp();
      const isTelegramMiniApp = isTelegramMiniAppContext();

      if (!isTelegramMiniApp) {
        rootStyle.setProperty("--app-top-offset", "0px");
        return;
      }

      const platform =
        (webApp as { platform?: string } | null)?.platform ??
        (/iPhone|iPad|iPod/i.test(window.navigator.userAgent) ? "ios" : "");

      rootStyle.setProperty(
        "--app-top-offset",
        platform === "ios" ? "96px" : "80px"
      );
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
        syncTopOffset();
      } catch (error) {
        console.error("Telegram app shell init error:", error);
      }
    };

    syncTopOffset();
    void initWebApp();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return null;
}
