"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { normalizeInternalReturnTo } from "@/lib/auth-redirect";
import { getTelegramInitData, isTelegramMiniAppContext } from "@/lib/telegram";

type AcademyAuthGateProps = {
  children: ReactNode;
};

export function AcademyAuthGate({ children }: AcademyAuthGateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function confirmSession() {
      setError(null);

      try {
        const sessionResponse = await fetch("/api/auth/me", {
          credentials: "include",
          cache: "no-store",
        });

        if (sessionResponse.ok) {
          if (!cancelled) setAuthenticated(true);
          return;
        }

        if (sessionResponse.status !== 401 && sessionResponse.status !== 404) {
          throw new Error("Не удалось проверить авторизацию");
        }

        if (isTelegramMiniAppContext()) {
          const initData = await getTelegramInitData();
          if (!initData) {
            throw new Error(
              "Не удалось подтвердить Telegram-сессию. Закройте и откройте приложение заново.",
            );
          }

          const telegramResponse = await fetch(
            "/api/auth/telegram/mini-app-session",
            {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ initData }),
            },
          );

          if (!telegramResponse.ok) {
            throw new Error(
              "Не удалось подтвердить Telegram-сессию. Закройте и откройте приложение заново.",
            );
          }

          if (!cancelled) setAuthenticated(true);
          return;
        }

        const currentPath = normalizeInternalReturnTo(
          `${pathname}${window.location.search}`,
          "/academy",
        );
        router.replace(`/login?returnTo=${encodeURIComponent(currentPath)}`);
      } catch (sessionError) {
        if (!cancelled) {
          setError(
            sessionError instanceof Error
              ? sessionError.message
              : "Не удалось проверить авторизацию",
          );
        }
      }
    }

    void confirmSession();
    return () => {
      cancelled = true;
    };
  }, [pathname, retryKey, router]);

  if (authenticated) return children;

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#09100d,#070707)] px-4 py-6 pb-28 text-white">
      <div className="mx-auto flex min-h-[65vh] max-w-md items-center justify-center">
        {error ? (
          <div className="w-full rounded-[22px] border border-white/10 bg-white/[0.045] p-5 text-center">
            <p className="text-sm leading-6 text-white/65">{error}</p>
            <button
              type="button"
              onClick={() => setRetryKey((key) => key + 1)}
              className="mt-4 rounded-xl bg-[#d7b55a] px-5 py-3 text-sm font-semibold text-[#11120f]"
            >
              Повторить
            </button>
          </div>
        ) : (
          <p className="text-sm text-white/45">Проверяем авторизацию...</p>
        )}
      </div>
    </main>
  );
}
