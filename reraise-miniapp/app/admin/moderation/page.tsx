"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  approveNickname,
  ensurePlayerFromTelegramUser,
  getPendingNicknames,
  rejectNickname,
} from "@/features/auth";
import { getTelegramUser } from "@/lib/telegram";
import type { Player } from "@/types/domain";

export default function AdminModerationPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [pendingPlayers, setPendingPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingPlayerId, setProcessingPlayerId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadModerationData() {
    const nextPendingPlayers = await getPendingNicknames();
    setPendingPlayers(nextPendingPlayers);
  }

  useEffect(() => {
    async function loadPage() {
      try {
        const telegramUser = getTelegramUser();

        if (!telegramUser) {
          return;
        }

        const ensuredPlayer = await ensurePlayerFromTelegramUser(telegramUser);
        setPlayer(ensuredPlayer);

        if (ensuredPlayer.role === "admin") {
          await loadModerationData();
        }
      } catch (err) {
        const nextMessage =
          err instanceof Error ? err.message : "Ошибка загрузки модерации";
        setError(nextMessage);
      } finally {
        setAccessChecked(true);
        setLoading(false);
      }
    }

    loadPage();
  }, []);

  async function handleApprove(playerId: string) {
    try {
      setProcessingPlayerId(playerId);
      setMessage(null);
      setError(null);

      await approveNickname(playerId);
      await loadModerationData();

      setMessage("Ник одобрен");
    } catch (err) {
      const nextMessage =
        err instanceof Error ? err.message : "Ошибка одобрения ника";
      setError(nextMessage);
    } finally {
      setProcessingPlayerId(null);
    }
  }

  async function handleReject(playerId: string) {
    try {
      setProcessingPlayerId(playerId);
      setMessage(null);
      setError(null);

      await rejectNickname(playerId);
      await loadModerationData();

      setMessage("Ник отклонён");
    } catch (err) {
      const nextMessage =
        err instanceof Error ? err.message : "Ошибка отклонения ника";
      setError(nextMessage);
    } finally {
      setProcessingPlayerId(null);
    }
  }

  if (!accessChecked || loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Загружаем модерацию ников...</p>
        </div>
      </main>
    );
  }

  if (player?.role !== "admin") {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/admin"
            className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
          >
            ← Назад
          </Link>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h1 className="text-xl font-semibold">Доступ запрещен</h1>
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
      <div className="mx-auto max-w-3xl">
        <Link
          href="/admin"
          className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
        >
          ← Назад
        </Link>

        <h1 className="text-2xl font-bold">Модерация ников</h1>
        <p className="mt-2 text-sm text-white/70">
          Заявки игроков на изменение display name
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

        {pendingPlayers.length === 0 ? (
          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            Сейчас нет ников на модерации.
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {pendingPlayers.map((pendingPlayer) => {
              const isProcessing = processingPlayerId === pendingPlayer.id;

              return (
                <div
                  key={pendingPlayer.id}
                  className="rounded-xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="space-y-2">
                    <p className="text-lg font-semibold">
                      {pendingPlayer.username
                        ? `@${pendingPlayer.username}`
                        : pendingPlayer.display_name}
                    </p>
                    <p className="text-sm text-white/60">
                      Telegram ID: {pendingPlayer.telegram_id}
                    </p>
                    <p className="text-sm text-white/60">
                      Текущий ник: {pendingPlayer.display_name}
                    </p>
                    <p className="text-sm text-yellow-300">
                      Новый ник: {pendingPlayer.pending_display_name}
                    </p>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => handleApprove(pendingPlayer.id)}
                      disabled={isProcessing}
                      className="rounded-lg bg-yellow-500 px-3 py-2 text-sm font-semibold text-black disabled:opacity-60"
                    >
                      {isProcessing ? "Обрабатываем..." : "Одобрить"}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleReject(pendingPlayer.id)}
                      disabled={isProcessing}
                      className="rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {isProcessing ? "Обрабатываем..." : "Отклонить"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
