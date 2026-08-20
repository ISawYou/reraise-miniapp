"use client";

import { useEffect, useState } from "react";
import type { AcademyProgressPayload } from "@/features/academy";

export function useAcademyProgress() {
  const [data, setData] = useState<AcademyProgressPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadProgress() {
      setError(null);
      try {
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
