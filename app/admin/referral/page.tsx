"use client";

import { BackButton } from "@/components/ui/back-button";
import { useEffect, useMemo, useState } from "react";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchAdminJson } from "@/lib/client-request";
import { getPlayerAvatarFallback, getPlayerAvatarUrl } from "@/lib/player-avatar";
import { isStaff } from "@/lib/roles";
import type { Player } from "@/types/domain";

function getVisibleName(player: Player) {
  return player.admin_display_name?.trim() || player.display_name;
}

// Simplified referral model: "Игрок привёл N друзей" -- an ordinary
// operator may view/increase/decrease/correct referral_count. The old
// free-reentry balance and Yandex review bonus controls are deliberately
// removed from this page for everyone (not just operator) -- that business
// logic is deprecated, not deleted: players.free_reentries_balance and
// players.yandex_review_bonus_claimed keep their historical values in the
// database, just unused by this flow. See features/admin.ts's
// setPlayerReferralCount.
export default function AdminReferralPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadPlayers() {
    const payload = await fetchAdminJson<{ players: Player[] }>("/api/admin/referral");
    setPlayers(payload.players);
  }

  useEffect(() => {
    async function loadPage() {
      try {
        const ensuredPlayer = await resolveCurrentPlayer();
        setPlayer(ensuredPlayer);

        if (isStaff(ensuredPlayer?.role)) {
          await loadPlayers();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка загрузки реферальных данных");
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

  async function setReferralCount(targetPlayer: Player, nextCount: number) {
    if (nextCount < 0) return;
    setProcessingId(targetPlayer.id);
    setError(null);
    try {
      const payload = await fetchAdminJson<{ player: Player }>(
        `/api/admin/referral/${targetPlayer.id}/count`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ referralCount: nextCount }),
        }
      );
      setPlayers((prev) => prev.map((p) => (p.id === targetPlayer.id ? payload.player : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка обновления");
    } finally {
      setProcessingId(null);
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

  if (!isStaff(player?.role)) {
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
        <p className="mt-2 text-sm text-white/70">Игрок привёл N друзей.</p>

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
              const isProcessing = processingId === targetPlayer.id;

              return (
                <div
                  key={targetPlayer.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
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
                        <p className="mt-0.5 text-xs text-white/45">@{targetPlayer.username}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setReferralCount(targetPlayer, referralCount - 1)}
                      disabled={isProcessing || referralCount === 0}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-sm text-white disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="min-w-[2rem] text-center text-sm font-semibold text-white">
                      {isProcessing ? "…" : referralCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => setReferralCount(targetPlayer, referralCount + 1)}
                      disabled={isProcessing}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-sm text-white disabled:opacity-40"
                    >
                      +
                    </button>
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
