"use client";

import { BackButton } from "@/components/ui/back-button";
import { useEffect, useMemo, useState } from "react";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchAdminJson } from "@/lib/client-request";
import { getPlayerAvatarFallback, getPlayerAvatarUrl } from "@/lib/player-avatar";
import type { Player } from "@/types/domain";

function getVisibleName(player: Player) {
  return player.admin_display_name?.trim() || player.display_name;
}

export default function AdminReferralPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingKey, setProcessingKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadPlayers() {
    const payload = await fetchAdminJson<{ players: Player[] }>(
      "/api/admin/referral"
    );
    setPlayers(payload.players);
  }

  useEffect(() => {
    async function loadPage() {
      try {
        const ensuredPlayer = await resolveCurrentPlayer();
        setPlayer(ensuredPlayer);

        if (ensuredPlayer.role === "admin") {
          await loadPlayers();
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Ошибка загрузки реферальных данных"
        );
      } finally {
        setAccessChecked(true);
        setLoading(false);
      }
    }

    loadPage();
  }, []);

  const filteredPlayers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const sorted = [...players].sort((a, b) =>
      getVisibleName(a).localeCompare(getVisibleName(b), "ru")
    );
    if (!query) return sorted;
    return sorted.filter((p) => {
      const name = getVisibleName(p).toLowerCase();
      const username = (p.username ?? "").toLowerCase();
      return name.includes(query) || username.includes(query);
    });
  }, [players, searchQuery]);

  async function handleAction(
    targetPlayer: Player,
    action: string,
    value?: boolean
  ) {
    const key = `${action}-${targetPlayer.id}`;
    try {
      setProcessingKey(key);
      setMessage(null);
      setError(null);

      const payload = await fetchAdminJson<{ player: Player }>(
        `/api/admin/referral/${targetPlayer.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, value }),
        }
      );

      setPlayers((prev) =>
        prev.map((p) => (p.id === targetPlayer.id ? payload.player : p))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка обновления");
    } finally {
      setProcessingKey(null);
    }
  }

  if (!accessChecked || loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-4xl">
          <p className="text-sm text-white/70">Загружаем реферальную программу...</p>
        </div>
      </main>
    );
  }

  if (player?.role !== "admin") {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-4xl">
          <BackButton href="/admin" className="mb-4" />
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h1 className="text-xl font-semibold">Доступ запрещён</h1>
            <p className="mt-2 text-sm text-white/70">
              Эта страница доступна только администратору.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto max-w-4xl">
        <BackButton href="/admin" className="mb-4" />

        <h1 className="text-2xl font-bold">Реферальная программа</h1>
        <p className="mt-2 text-sm text-white/70">
          Рефералы, бесплатные re-entry и бонус за отзыв на Яндекс.
        </p>

        {message ? (
          <div className="mt-4 rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-200">
            {message}
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Поиск по имени или @username"
          className="mt-6 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
        />

        <div className="mt-4 space-y-3">
          {filteredPlayers.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              Игроки не найдены.
            </div>
          ) : (
            filteredPlayers.map((targetPlayer) => {
              const avatarUrl = getPlayerAvatarUrl(targetPlayer);
              const avatarFallback = getPlayerAvatarFallback(targetPlayer);
              const referralCount = targetPlayer.referral_count ?? 0;
              const freeReentries = targetPlayer.free_reentries_balance ?? 0;
              const yandexClaimed = targetPlayer.yandex_review_bonus_claimed ?? false;

              const isAnyProcessing = processingKey?.endsWith(`-${targetPlayer.id}`) ?? false;

              return (
                <div
                  key={targetPlayer.id}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex items-center gap-3">
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt={targetPlayer.display_name}
                        className="h-10 w-10 shrink-0 rounded-full border border-white/10 object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-semibold text-white/80">
                        {avatarFallback}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {getVisibleName(targetPlayer)}
                      </p>
                      {targetPlayer.username ? (
                        <p className="mt-0.5 text-xs text-white/45">
                          @{targetPlayer.username}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/[0.06] pt-3">
                    <div className="flex flex-col gap-2">
                      <p className="text-xs text-white/50">Рефералы</p>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleAction(targetPlayer, "decrement_referral")}
                          disabled={isAnyProcessing || referralCount === 0}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-sm text-white disabled:opacity-40"
                        >
                          −
                        </button>
                        <span className="min-w-[1.25rem] text-center text-sm font-semibold text-white">
                          {processingKey === `decrement_referral-${targetPlayer.id}` ||
                          processingKey === `increment_referral-${targetPlayer.id}`
                            ? "…"
                            : referralCount}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAction(targetPlayer, "increment_referral")}
                          disabled={isAnyProcessing}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-sm text-white disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <p className="text-xs text-white/50">re-entry</p>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleAction(targetPlayer, "decrement_free_reentries")}
                          disabled={isAnyProcessing || freeReentries === 0}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-sm text-white disabled:opacity-40"
                        >
                          −
                        </button>
                        <span className="min-w-[1.25rem] text-center text-sm font-semibold text-white">
                          {processingKey === `decrement_free_reentries-${targetPlayer.id}` ||
                          processingKey === `increment_free_reentries-${targetPlayer.id}`
                            ? "…"
                            : freeReentries}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAction(targetPlayer, "increment_free_reentries")}
                          disabled={isAnyProcessing}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-sm text-white disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <p className="text-xs text-white/50">Отзыв на Яндекс</p>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={yandexClaimed}
                        disabled={isAnyProcessing}
                        onClick={() =>
                          handleAction(targetPlayer, "set_yandex_review", !yandexClaimed)
                        }
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-40 ${
                          yandexClaimed ? "bg-yellow-500" : "bg-white/20"
                        }`}
                      >
                        <span
                          className={`my-0.5 inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                            yandexClaimed ? "translate-x-5" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}
