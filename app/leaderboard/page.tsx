"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getLeaderboardPlaceTone } from "@/lib/leaderboard-display";
import { logEvent } from "@/lib/activity-client";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { getPlayerAvatarFallback, getPlayerAvatarUrl } from "@/lib/player-avatar";

type LeaderboardRow = {
  player_id: string;
  username: string | null;
  display_name: string;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
  rating: number;
};

export default function LeaderboardPage() {
  const [seasonTitle, setSeasonTitle] = useState("");
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    logEvent("rating_opened");

    async function loadLeaderboard() {
      try {
        const currentPlayer = await resolveCurrentPlayer().catch(() => null);
        setCurrentPlayerId(currentPlayer?.id ?? null);

        const response = await fetch("/api/leaderboard");
        if (!response.ok) throw new Error("Ошибка загрузки рейтинга");
        const data = (await response.json()) as {
          season: { id: string; title: string };
          leaderboard: LeaderboardRow[];
        };
        setSeasonTitle(data.season.title?.trim() || "Активный сезон");
        setRows(data.leaderboard);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Ошибка загрузки рейтинга";
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    loadLeaderboard();
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-md">
          <p className="text-sm text-white/70">Загружаем рейтинг...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-md">
          <Link
            href="/"
            className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
          >
            ← Назад
          </Link>

          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-md">
        <Link
          href="/"
          className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
        >
          ← Назад
        </Link>

        <div className="mb-6 flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">Рейтинг</h1>
            <p className="mt-2 text-sm text-white/70">{seasonTitle}</p>
          </div>

          <Link
            href="/faq?tab=rating-rules"
            className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/80 sm:px-4"
          >
            <span className="sm:hidden">Регламент</span>
            <span className="hidden sm:inline">Регламент рейтинга</span>
          </Link>
        </div>

        <div className="mb-3 inline-flex rounded-full border border-[#8fa8ff]/20 bg-[#667eea]/10 px-3 py-1.5 text-xs font-medium text-[#bdc9ff]">
          ТОП-9 → Финал месяца
        </div>
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
          <div className="grid grid-cols-[36px_minmax(0,1fr)_64px] gap-2 border-b border-white/10 px-3 py-3 text-xs uppercase tracking-wide text-white/50 sm:grid-cols-[48px_minmax(0,1fr)_90px] sm:gap-3 sm:px-4">
            <div>#</div>
            <div>Игрок</div>
            <div className="text-right">Очки</div>
          </div>

          {rows.length === 0 ? (
            <div className="px-4 py-6 text-sm text-white/60">Пока нет рейтинга</div>
          ) : (
            rows.map((row, index) => {
              const tone = getLeaderboardPlaceTone(index + 1, row.player_id === currentPlayerId);
              const toneClass = tone === "current" ? "border-[#d7b55a]/30 bg-[#d7b55a]/[0.10] ring-1 ring-inset ring-[#d7b55a]/20"
                : tone === "gold" ? "border-[#d7b55a]/20 bg-[#d7b55a]/[0.07]"
                : tone === "silver" ? "border-slate-300/15 bg-slate-300/[0.05]"
                : tone === "bronze" ? "border-orange-300/15 bg-orange-400/[0.045]"
                : tone === "finalist" ? "border-[#8fa8ff]/10 bg-[#667eea]/[0.045]"
                : "border-white/10";
              return (
              <Link
                key={row.player_id}
                href={`/players/${row.player_id}`}
                className={`grid grid-cols-[36px_minmax(0,1fr)_64px] gap-2 border-b px-3 py-4 last:border-b-0 sm:grid-cols-[48px_minmax(0,1fr)_90px] sm:gap-3 sm:px-4 ${toneClass}`}
              >
                <div
                  className={`text-sm font-semibold ${
                    row.player_id === currentPlayerId ? "text-[#f0d38a]" : "text-white/80"
                  }`}
                >
                  {index + 1}
                </div>

                <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                  {getPlayerAvatarUrl(row) ? (
                    <img
                      src={getPlayerAvatarUrl(row) ?? ""}
                      alt={row.display_name}
                      className="h-10 w-10 shrink-0 rounded-full border border-white/10 object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-semibold text-white/80">
                      {getPlayerAvatarFallback(row)}
                    </div>
                  )}

                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">
                      {row.display_name}
                    </p>
                    {row.player_id === currentPlayerId ? (
                      <p className="mt-1 text-xs text-[#f0d38a]">Это вы</p>
                    ) : null}
                  </div>
                </div>

                <div
                  className={`text-right text-sm font-semibold ${
                    row.player_id === currentPlayerId ? "text-[#f0d38a]" : "text-white/80"
                  } shrink-0`}
                >
                  {row.rating}
                </div>
              </Link>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}
