"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AcademyAccessProvider } from "@/components/academy/academy-access-context";
import {
  ACADEMY_ACCESS_COPY,
  ACADEMY_ACCESS_ENDPOINT,
  isAcademyAccessTier,
  type AcademyAccessView,
} from "@/config/academy/access-copy";
import { normalizeInternalReturnTo } from "@/lib/auth-redirect";
import { getTelegramInitData, isTelegramMiniAppContext } from "@/lib/telegram";

type AcademyAuthGateProps = {
  children: ReactNode;
};

const ACCESS_ERROR = "Не удалось проверить доступ к Академии";

/** `GET /api/academy/access` → the server-resolved tier (never cached: freshness on every Academy navigation). */
async function fetchAcademyAccess(): Promise<AcademyAccessView> {
  const response = await fetch(ACADEMY_ACCESS_ENDPOINT, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(ACCESS_ERROR);
  const payload = await response.json() as { access?: unknown; season?: { id?: unknown; title?: unknown } | null };
  if (!isAcademyAccessTier(payload.access)) throw new Error(ACCESS_ERROR);
  const season = payload.season && typeof payload.season.id === "string" && typeof payload.season.title === "string"
    ? { id: payload.season.id, title: payload.season.title }
    : null;
  return { access: payload.access, season };
}

/**
 * Authentication is unchanged (canonical web session; a Telegram Mini App
 * restores a missing cookie; an unauthenticated web visitor goes to login).
 * ONE added step after authentication: resolve the Academy access tier from
 * the server and provide it to the Academy UI (lock states / membership CTA).
 * It is re-checked on every Academy navigation, so a player marked "Пришёл"
 * unlocks without logging out. Pages and APIs enforce access on the server
 * independently; after restoring a Telegram cookie the server-rendered page
 * is refreshed so it is re-rendered for the now-authenticated player.
 */
export function AcademyAuthGate({ children }: AcademyAuthGateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);
  const [access, setAccess] = useState<AcademyAccessView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function resolveAccess() {
      const view = await fetchAcademyAccess();
      if (!cancelled) setAccess(view);
    }

    async function confirmSession() {
      setError(null);

      try {
        const sessionResponse = await fetch("/api/auth/me", {
          credentials: "include",
          cache: "no-store",
        });

        if (sessionResponse.ok) {
          if (!cancelled) setAuthenticated(true);
          await resolveAccess();
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
          // The page was server-rendered before the cookie existed: re-render it for this player.
          router.refresh();
          await resolveAccess();
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

  // Once known, the tier stays provided while a navigation re-check runs (no flash);
  // a failed re-check keeps the last server answer (the server enforces anyway).
  if (authenticated && access) {
    return <AcademyAccessProvider value={access}>{children}</AcademyAccessProvider>;
  }

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
          <p className="text-sm text-white/45">
            {authenticated ? ACADEMY_ACCESS_COPY.checking : "Проверяем авторизацию..."}
          </p>
        )}
      </div>
    </main>
  );
}
