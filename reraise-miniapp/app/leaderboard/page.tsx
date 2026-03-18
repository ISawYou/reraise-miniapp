"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import { getActiveSeason, getSeasonLeaderboard } from "@/features/tournaments";
import { getTelegramUser } from "@/lib/telegram";

type LeaderboardRow = {
  player_id: string;
  username: string | null;
  display_name: string;
  rating: number;
};

export default function LeaderboardPage() {
  const [seasonTitle, setSeasonTitle] = useState("");
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);
  const [currentPlayerPhotoUrl, setCurrentPlayerPhotoUrl] = useState<string | null>(
    null
  );

  useEffect(() => {
    async function loadLeaderboard() {
      try {
        const telegramUser = getTelegramUser();

        if (telegramUser) {
          const ensuredViewer = await ensurePlayerFromTelegramUser(telegramUser);
          setCurrentPlayerId(ensuredViewer.id);
          setCurrentPlayerPhotoUrl(
            (telegramUser as { photo_url?: string }).photo_url ?? null
          );
        }

        const activeSeason = await getActiveSeason();
        setSeasonTitle(
          typeof activeSeason.number === "number"
            ? `Сезон ${activeSeason.number}`
            : "Активный сезон"
        );

        const leaderboard = await getSeasonLeaderboard(activeSeason.id);
        setRows(leaderboard);
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
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto max-w-md">
        <Link
          href="/"
          className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
        >
          ← Назад
        </Link>

        <h1 className="text-2xl font-bold">Рейтинг</h1>
        <p className="mt-2 text-sm text-white/70">{seasonTitle}</p>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5">
          <div className="grid grid-cols-[48px_1fr_90px] gap-3 border-b border-white/10 px-4 py-3 text-xs uppercase tracking-wide text-white/50">
            <div>#</div>
            <div>Игрок</div>
            <div className="text-right">Очки</div>
          </div>

          {rows.length === 0 ? (
            <div className="px-4 py-6 text-sm text-white/60">Пока нет рейтинга</div>
          ) : (
            rows.map((row, index) => (
              <Link
                key={row.player_id}
                href={`/players/${row.player_id}`}
                className="grid grid-cols-[48px_1fr_90px] gap-3 border-b border-white/10 px-4 py-4 last:border-b-0"
              >
                <div className="text-sm font-semibold text-white/80">{index + 1}</div>

                <div className="flex items-center gap-3">
                  {row.player_id === currentPlayerId && currentPlayerPhotoUrl ? (
                    <img
                      src={currentPlayerPhotoUrl}
                      alt={row.display_name}
                      className="h-10 w-10 rounded-full border border-white/10 object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-semibold text-white/80">
                      {(row.display_name.trim()[0] ?? "?").toUpperCase()}
                    </div>
                  )}

                  <p className="text-sm font-medium text-white">{row.display_name}</p>
                </div>

                <div className="text-right text-sm font-semibold text-white/80">
                  {row.rating}
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
