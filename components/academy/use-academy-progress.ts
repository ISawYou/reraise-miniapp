"use client";

import { useEffect, useState } from "react";
import type { AcademyProgressPayload } from "@/features/academy";
import { getTelegramInitData, isTelegramMiniAppContext } from "@/lib/telegram";

export function useAcademyProgress() {
  const [data, setData] = useState<AcademyProgressPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadProgress() {
      setError(null);
      try {
        if (isTelegramMiniAppContext()) {
          const initData = await getTelegramInitData();
          if (!initData) {
            throw new Error("Не удалось подтвердить Telegram-сессию");
          }

          const sessionResponse = await fetch("/api/auth/telegram/mini-app-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initData }),
            credentials: "include",
          });

          if (!sessionResponse.ok) {
            throw new Error("Не удалось подтвердить Telegram-сессию");
          }
        }

        const response = await fetch("/api/academy/progress", {
          credentials: "include",
          cache: "no-store",
        });
        const payload = await response.json() as AcademyProgressPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Не удалось загрузить прогресс");
        if (!cancelled) setData(payload);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить прогресс");
        }
      }
    }

    void loadProgress();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return {
    data,
    error,
    retry: () => setReloadKey((key) => key + 1),
  };
}
