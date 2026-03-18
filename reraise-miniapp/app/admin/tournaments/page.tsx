"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import { deleteTournament, getOpenTournaments } from "@/features/tournaments";
import { getTelegramUser } from "@/lib/telegram";
import type { Player, Tournament } from "@/types/domain";

export default function AdminTournamentsPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadTournaments() {
    const nextTournaments = await getOpenTournaments();
    setTournaments(nextTournaments);
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
          await loadTournaments();
        }
      } catch (err) {
        const nextMessage =
          err instanceof Error ? err.message : "Ошибка загрузки турниров";
        setError(nextMessage);
      } finally {
        setAccessChecked(true);
        setLoading(false);
      }
    }

    loadPage();
  }, []);

  async function handleDeleteTournament(
    tournamentId: string,
    tournamentTitle: string
  ) {
    const isConfirmed = window.confirm(
      `Вы точно хотите удалить турнир "${tournamentTitle}"?`
    );

    if (!isConfirmed) {
      return;
    }

    try {
      setActionLoading(true);
      setMessage(null);
      setError(null);

      await deleteTournament(tournamentId);
      await loadTournaments();

      setMessage(`Турнир "${tournamentTitle}" удален`);
    } catch (err) {
      const nextMessage =
        err instanceof Error ? err.message : "Ошибка удаления турнира";
      setError(nextMessage);
    } finally {
      setActionLoading(false);
    }
  }

  if (!accessChecked || loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Загружаем турниры...</p>
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

        <h1 className="text-2xl font-bold">Модерация турниров</h1>
        <p className="mt-2 text-sm text-white/70">
          Управление открытыми турнирами
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

        {tournaments.length === 0 ? (
          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            Пока нет открытых турниров
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {tournaments.map((tournament) => (
              <div
                key={tournament.id}
                className="rounded-xl border border-white/10 bg-white/5 p-4"
              >
                <p className="text-lg font-semibold">{tournament.title}</p>

                <p className="mt-2 text-sm text-white/60">
                  {new Date(tournament.start_at).toLocaleString("ru-RU")}
                </p>

                <p className="mt-1 text-sm text-white/60">
                  Место: {tournament.location ?? "Не указано"}
                </p>

                <p className="mt-1 text-sm text-white/60">
                  Лимит игроков: {tournament.max_players}
                </p>

                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Link
                    href={`/tournaments/${tournament.id}`}
                    className="rounded-lg border border-white/10 px-3 py-2 text-center text-sm text-white/80"
                  >
                    Открыть турнир
                  </Link>

                  <Link
                    href={`/admin/tournaments/${tournament.id}/edit`}
                    className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-center text-sm font-semibold text-yellow-300"
                  >
                    Редактировать
                  </Link>

                  <Link
                    href={`/admin/results/${tournament.id}`}
                    className="rounded-lg bg-yellow-500 px-3 py-2 text-center text-sm font-semibold text-black"
                  >
                    Внести результаты
                  </Link>

                  <button
                    type="button"
                    onClick={() =>
                      handleDeleteTournament(tournament.id, tournament.title)
                    }
                    disabled={actionLoading}
                    className="rounded-lg bg-red-600 px-3 py-2 text-center text-sm font-semibold text-white disabled:opacity-60"
                  >
                    Удалить турнир
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
