"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ensurePlayerFromTelegramUser, getPlayerById } from "@/features/auth";
import {
  getPlayedTournamentsCount,
  getPlayerRating,
  getPlayerTournamentHistory,
} from "@/features/tournaments";
import { getTelegramUser } from "@/lib/telegram";
import type { Player, Tournament, TournamentResult } from "@/types/domain";

type HistoryItem = {
  tournament: Tournament;
  result: TournamentResult;
};

export default function PlayerProfilePage() {
  const params = useParams<{ id: string }>();
  const playerId = params?.id;

  const [viewerId, setViewerId] = useState<string | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [rating, setRating] = useState(0);
  const [playedCount, setPlayedCount] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadPage() {
      try {
        if (!playerId) {
          throw new Error("Player id not found");
        }

        const telegramUser = getTelegramUser();

        if (telegramUser) {
          const ensuredViewer = await ensurePlayerFromTelegramUser(telegramUser);
          setViewerId(ensuredViewer.id);
        }

        const [playerData, playerRating, tournamentsCount, playerHistory] =
          await Promise.all([
            getPlayerById(playerId),
            getPlayerRating(playerId),
            getPlayedTournamentsCount(playerId),
            getPlayerTournamentHistory(playerId),
          ]);

        if (!playerData) {
          throw new Error("Player not found");
        }

        setPlayer(playerData);
        setRating(playerRating);
        setPlayedCount(tournamentsCount);
        setHistory(playerHistory);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Ошибка загрузки профиля"
        );
      } finally {
        setLoading(false);
      }
    }

    loadPage();
  }, [playerId]);

  const isOwnProfile = viewerId === player?.id;

  if (loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Загружаем профиль игрока...</p>
        </div>
      </main>
    );
  }

  if (error || !player) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/"
            className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
          >
            ← Назад
          </Link>

          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error ?? "Профиль игрока не найден"}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
        >
          ← Назад
        </Link>

        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{player.display_name}</h1>
          {isOwnProfile ? (
            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70"
              title="Скоро здесь будет изменение ника"
            >
              ✎
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-white/70">
          {player.username ? `@${player.username}` : "Без username"}
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-white/60">Рейтинг</p>
            <p className="mt-2 text-2xl font-semibold">{rating}</p>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-white/60">Сыграно турниров</p>
            <p className="mt-2 text-2xl font-semibold">{playedCount}</p>
          </div>
        </div>

        <section className="mt-8">
          <h2 className="text-xl font-semibold">История турниров</h2>

          {history.length === 0 ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              Пока нет сыгранных турниров
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {history.map((item) => (
                <div
                  key={`${item.tournament.id}-${item.result.player_id}`}
                  className="rounded-xl border border-white/10 bg-white/5 p-4"
                >
                  <p className="text-lg font-semibold">{item.tournament.title}</p>
                  <p className="mt-1 text-sm text-white/60">
                    {new Date(item.tournament.start_at).toLocaleString("ru-RU")}
                  </p>

                  <div className="mt-3 grid grid-cols-3 gap-3 text-sm text-white/80">
                    <div>Место: {item.result.place}</div>
                    <div>Нокауты: {item.result.knockouts}</div>
                    <div>Очки: {item.result.rating_points}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
