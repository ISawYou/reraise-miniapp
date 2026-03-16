"use client";

import { useEffect } from "react";
import { getTelegramWebApp } from "@/lib/telegram";

export function TelegramAppShell() {
  useEffect(() => {
    const webApp = getTelegramWebApp();

    if (!webApp) {
      return;
    }

    try {
      webApp.ready?.();
      webApp.expand?.();

      const maybeWebApp = webApp as any;

      if (typeof maybeWebApp.requestFullscreen === "function") {
        maybeWebApp.requestFullscreen();
      }

      if (typeof maybeWebApp.disableVerticalSwipes === "function") {
        maybeWebApp.disableVerticalSwipes();
      }

      if (typeof maybeWebApp.setBackgroundColor === "function") {
        maybeWebApp.setBackgroundColor("#000000");
      }

      if (typeof maybeWebApp.setHeaderColor === "function") {
        maybeWebApp.setHeaderColor("#000000");
      }
    } catch (error) {
      console.error("Telegram app shell init error:", error);
    }
  }, []);

  return null;
}