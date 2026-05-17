"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import { deleteTournament } from "@/features/tournaments";
import { fetchAdminJson } from "@/lib/client-request";
import { getTelegramUser } from "@/lib/telegram";
import type { Player, Tournament } from "@/types/domain";

function formatDateTimeWithoutSeconds(date: string) {
  return new Date(date).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTournamentKindLabel(kind: Tournament["kind"]) {
  if (kind === "paid") return "Платный";
  if (kind === "cash") return "Кэш";
  return "Бесплатный";
}

export default function AdminTournamentsPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadTournaments() {
    const payload = await fetchAdminJson<{ tournaments: Tournament[] }>(
      "/api/admin/tournaments"
    );
    setTournaments(payload.tournaments);
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
        setError(err instanceof Error ? err.message : "Ошибка загрузки турниров");
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
      setError(err instanceof Error ? err.message : "Ошибка удаления турнира");
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
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/admin"
          className="mb-6 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
        >
          ← Назад
        </Link>

        <h1 className="text-2xl font-bold tracking-tight">Модерация турниров</h1>
        <p className="mt-1 text-sm text-white/50">
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
          <div className="mt-6 rounded-2xl border border-white/[0.07] bg-white/4 p-5 text-sm text-white/50">
            Пока нет открытых турниров
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {tournaments.map((tournament) => (
              <div
                key={tournament.id}
                className="rounded-2xl border border-white/[0.07] bg-white/4 p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-base font-semibold tracking-tight">{tournament.title}</p>
                  <span className="rounded-full border border-white/8 bg-white/6 px-2.5 py-0.5 text-[11px] font-medium text-white/50">
                    {getTournamentKindLabel(tournament.kind)}
                  </span>
                </div>

                <p className="mt-2.5 text-[13px] text-white/45">
                  {formatDateTimeWithoutSeconds(tournament.start_at)}
                </p>

                <p className="mt-1 text-[13px] text-white/45">
                  Место: {tournament.location ?? "Не указано"}
                </p>

                <p className="mt-1 text-[13px] text-white/45">
                  Лимит игроков: {tournament.max_players}
                </p>

                <div className="mt-4 border-t border-white/6 pt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Link
                    href={`/tournaments/${tournament.id}`}
                    className="rounded-xl border border-white/8 px-3 py-2.5 text-center text-[13px] font-medium text-white/60 active:bg-white/5 transition-colors"
                  >
                    Открыть турнир
                  </Link>

                  <Link
                    href={`/admin/tournaments/${tournament.id}/edit`}
                    className="rounded-xl border border-amber-500/25 bg-amber-500/8 px-3 py-2.5 text-center text-[13px] font-medium text-amber-300/80 active:bg-amber-500/15 transition-colors"
                  >
                    Редактировать
                  </Link>

                  <Link
                    href={`/admin/results/${tournament.id}`}
                    className="rounded-xl bg-yellow-500 px-3 py-2.5 text-center text-[13px] font-semibold text-black active:bg-yellow-400 transition-colors"
                  >
                    {tournament.google_sheet_tab_name
                      ? "Внести данные"
                      : "Создать таблицу"}
                  </Link>

                  <button
                    type="button"
                    onClick={() =>
                      handleDeleteTournament(tournament.id, tournament.title)
                    }
                    disabled={actionLoading}
                    className="rounded-xl bg-red-600/90 px-3 py-2.5 text-center text-[13px] font-semibold text-white disabled:opacity-60 active:bg-red-500 transition-colors"
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
