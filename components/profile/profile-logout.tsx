"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { invalidateCurrentPlayerCache } from "@/lib/current-player";

export function ProfileLogout({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!enabled) return null;

  async function logout() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Не удалось выйти из аккаунта.");
      }

      invalidateCurrentPlayerCache();
      router.replace("/login");
      router.refresh();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Не удалось выйти из аккаунта.");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="logout-open"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="mt-3 min-h-11 rounded-full border border-white/10 px-4 py-2 text-sm text-white/60 transition-colors hover:border-white/20 hover:text-white/85"
      >
        Выйти
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-title"
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#101612] p-5 shadow-2xl"
          >
            <h2 id="logout-title" className="text-lg font-semibold">Выйти из аккаунта?</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/60">Вы сможете снова войти через Telegram или email.</p>
            {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="min-h-11 flex-1 rounded-full border border-white/10 px-4 py-2 text-sm text-white/75 disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                type="button"
                data-testid="logout-confirm"
                disabled={busy}
                onClick={() => void logout()}
                className="min-h-11 flex-1 rounded-full bg-[#d5b867] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
              >
                {busy ? "Выходим..." : "Выйти"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
