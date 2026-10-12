"use client";

import { useEffect, useState } from "react";
import type { AcademyProgressResponse } from "@/features/academy";
import { getTelegramInitData, isTelegramMiniAppContext } from "@/lib/telegram";

/**
 * One in-flight progress request shared by every component that mounts at the
 * same time (e.g. "Новичкам" renders Step 1 and Step 2 progress): concurrent
 * callers reuse it instead of each fetching. Cleared once it settles, so a
 * later mount or a retry always fetches fresh data.
 */
let inflight: Promise<AcademyProgressResponse> | null = null;

async function fetchAcademyProgress(): Promise<AcademyProgressResponse> {
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
  const payload = await response.json() as AcademyProgressResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Не удалось загрузить прогресс");
  return payload;
}

export function loadAcademyProgressShared(): Promise<AcademyProgressResponse> {
  if (!inflight) {
    inflight = fetchAcademyProgress().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export function useAcademyProgress() {
  const [data, setData] = useState<AcademyProgressResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadProgress() {
      setError(null);
      try {
        const payload = await loadAcademyProgressShared();
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
